import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectGrowthBatchScheduler } from '../../../src/main/chat/project-growth-batch-scheduler.mjs';

function makeHarness({
  sessionStatus = 'active',
  memberCount = 1,
  runDelayMs = 0,
} = {}) {
  const batch = {
    id: 'batch-1',
    projectId: 'project-1',
    planRevision: 3,
    status: 'running',
    members: Array.from({ length: memberCount }, (_, index) => ({
      agentId: `agent-${index + 1}`,
      agentName: `研究员 ${index + 1}`,
      sessionRoomId: `room-${index + 1}`,
      status: 'pending',
    })),
  };
  const project = {
    id: 'project-1',
    title: '价格追踪器',
    groupRoomId: 'group-1',
  };
  const events = [];
  const runs = [];
  const failures = [];
  const claims = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  let turnSequence = 0;
  const projectStore = {
    listRunningProjectGrowthBatches: () => [batch],
    listUnfinalizedCompletedProjectGrowthBatches: () => [],
    getProjectGrowthBatch: () => batch,
    getProject: () => project,
    claimNextProjectGrowthMember: () => {
      const member = batch.members.find((item) => item.status === 'pending');
      if (!member) return null;
      member.status = 'running';
      claims.push(member.agentId);
      return member;
    },
    bindProjectGrowthTurn: (_batchId, agentId, turnId) => {
      batch.members.find((item) => item.agentId === agentId).turnId = turnId;
    },
    failProjectGrowthMember: (_batchId, agentId, failure) => {
      const member = batch.members.find((item) => item.agentId === agentId);
      member.status = failure.status;
      failures.push(failure);
    },
  };
  const store = {
    beginTurn: () => ({ turnId: `turn-${++turnSequence}` }),
  };
  const scheduler = new ProjectGrowthBatchScheduler({
    store,
    projectStore,
    isShuttingDown: () => false,
    isPaused: () => false,
    hasActiveRoom: () => false,
    hasStreamingReply: () => false,
    requireReadyModel: () => ({ id: 'test-model' }),
    getProjectSessionContext: () => ({ status: sessionStatus }),
    startRun: async (run) => {
      runs.push(run);
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      try {
        if (runDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, runDelayMs));
        }
        const member = batch.members.find(
          (item) => item.agentId === run.agentId,
        );
        member.status = 'completed';
      } finally {
        inFlight -= 1;
      }
    },
    emit: (event) => events.push(event),
    formatError: (error) => error.message,
  });
  return {
    batch,
    events,
    failures,
    claims,
    runs,
    scheduler,
    maxConcurrent: () => maxConcurrent,
  };
}

test('drain starts one planned growth turn and records the evidence link', async () => {
  const { batch, events, failures, claims, runs, scheduler } = makeHarness();

  await scheduler.drain(batch.id);

  assert.deepEqual(claims, ['agent-1']);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].turnId, 'turn-1');
  assert.equal(runs[0].isProjectGrowthTurn, true);
  assert.equal(runs[0].projectGrowthBatchId, batch.id);
  assert.match(runs[0].text, /价格追踪器/);
  assert.match(runs[0].text, /第 3 版/);
  assert.equal(batch.members[0].status, 'completed');
  assert.equal(batch.members[0].turnId, 'turn-1');
  assert.deepEqual(failures, []);
  assert.ok(events.some((event) => event.type === 'project-updated'));
});

test('drain reviews a multi-member batch sequentially with evidence per member', async () => {
  const { batch, events, failures, claims, runs, scheduler, maxConcurrent } =
    makeHarness({ memberCount: 4, runDelayMs: 10 });

  await scheduler.drain(batch.id);

  assert.deepEqual(claims, ['agent-1', 'agent-2', 'agent-3', 'agent-4']);
  assert.equal(runs.length, 4);
  assert.equal(maxConcurrent(), 1);
  assert.deepEqual(
    batch.members.map((member) => member.status),
    ['completed', 'completed', 'completed', 'completed'],
  );
  assert.equal(new Set(batch.members.map((member) => member.turnId)).size, 4);
  assert.ok(
    runs.every(
      (run) =>
        run.isProjectGrowthTurn &&
        run.text.includes('价格追踪器') &&
        run.text.includes('第 3 版'),
    ),
  );
  assert.deepEqual(failures, []);
  assert.equal(
    events.filter((event) => event.type === 'project-updated').length,
    4,
  );
});

test('drain fails the member when its project session is unavailable', async () => {
  const { batch, failures, runs, scheduler } = makeHarness({
    sessionStatus: 'archived',
  });

  await scheduler.drain(batch.id);

  assert.equal(runs.length, 0);
  assert.equal(batch.members[0].status, 'failed');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, 'project_session_unavailable');
});

test('schedulePending ignores batches without a pending member', () => {
  const { batch, scheduler } = makeHarness();
  batch.members[0].status = 'completed';
  scheduler.schedule = () => {
    throw new Error('should not schedule');
  };

  scheduler.schedulePending();
});
