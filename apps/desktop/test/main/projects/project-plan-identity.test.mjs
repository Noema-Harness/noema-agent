import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { SocialProjectStore } from '../../../src/main/projects/social-project-store.mjs';
import { SocialChatService } from '../../../src/main/chat/social-chat-service.mjs';
import { createSocialTestStore } from '../../../test-support/social-team.mjs';

async function waitFor(predicate, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('等待超时。');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function makeService({ store, projects, diagnostics, provider }) {
  return new SocialChatService({
    store,
    projectStore: projects,
    getProjectSessionContext: (roomId, agentId) =>
      projects.getProjectSessionContext(roomId, agentId),
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test-model',
    getRootState: async () => ({
      connected: true,
      selectedModel: 'test-model',
    }),
    recordDiagnosticEvent: (event) => diagnostics.push(event),
    provider,
  });
}

test('member plan submission, reviewer delivery and approval share durable identity', async () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  const reviewerId = store.createAgent({
    name: '研究核验员',
    headline: '核验',
    description: '独立核验。',
    projectWork: true,
  }).members[0].id;
  const projects = new SocialProjectStore({ db, socialChatStore: store });
  const project = projects.createProject({
    title: '真实成员计划链',
    brief: '从成员会话提交，再由指定核验人验收。',
    agentIds: ['noema', 'engineering-partner', reviewerId],
  });
  projects.plans.onChange = null;
  projects.plans.replace({
    projectId: project.id,
    expectedRevision: 0,
    reason: '建立一项必须由指定成员提交和核验的工作。',
    plan: {
      objective: '验证成员会话到评审的可追踪链路。',
      items: [
        {
          id: 'trace-work',
          title: '追踪链路样本',
          ownerAgentId: 'engineering-partner',
          reviewerIds: [reviewerId],
          acceptance: '提交来源与核验意见可追溯。',
          dependsOn: [],
          status: 'pending',
          evidence: '',
          blocker: '',
        },
      ],
    },
  });
  assert.deepEqual(projects.plans.get(project.id).items[0].reviewerIds, [
    reviewerId,
  ]);
  const sourceTime = new Date().toISOString();
  db.prepare(`INSERT INTO social_messages
    (id,room_id,turn_id,role,agent_id,content,status,runtime,created_at,updated_at)
    VALUES ('trace-source',?,'trace-source','assistant','engineering-partner',?,'complete','local',?,?)`).run(
    project.groupRoomId,
    '成员会话产生的可核验结果。',
    sourceTime,
    sourceTime,
  );

  const diagnostics = [];
  const provider = {
    async *streamChat(input) {
      const planTool = input.tools.find(
        (tool) => tool.function.name === 'manage_project_plan',
      );
      const hasToolResult = input.messages.some(
        (message) =>
          message.role === 'tool' && message.name === 'manage_project_plan',
      );
      const isPlanReview = input.messages.some(
        (message) =>
          message.role === 'user' &&
          String(message.content).includes('"kind":"plan_review"'),
      );
      const isOwner = input.messages.some(
        (message) =>
          message.role === 'user' &&
          String(message.content).includes('完成这项样本并提交来源。'),
      );
      if (isPlanReview && !hasToolResult) {
        const plan = projects.plans.get(project.id);
        input.onToolCalls?.([
          {
            id: 'review-trace',
            type: 'function',
            function: {
              name: 'manage_project_plan',
              arguments: JSON.stringify({
                operation: 'update_item',
                expected_revision: plan.revision,
                item_id: 'trace-work',
                status: 'submitted',
                review_decision: 'approve',
                review_reason: '来源和结果一致。',
                reason: '指定核验人完成独立核验。',
              }),
            },
          },
        ]);
        return;
      }
      if (isOwner && !hasToolResult) {
        assert.equal(
          'project_id' in planTool.function.parameters.properties,
          false,
        );
        input.onToolCalls?.([
          {
            id: 'submit-trace',
            type: 'function',
            function: {
              name: 'manage_project_plan',
              arguments: JSON.stringify({
                operation: 'update_item',
                expected_revision: 1,
                item_id: 'trace-work',
                status: 'submitted',
                evidence: '成员已完成样本并关联实际结果。',
                evidence_sources: [
                  { kind: 'message', messageId: 'trace-source' },
                ],
                reason: '负责人提交真实成果。',
              }),
            },
          },
        ]);
        return;
      }
      if (isPlanReview) {
        yield '已核对来源并完成独立核验。';
        return;
      }
      yield '样本已提交，等待指定核验人。';
    },
  };
  const service = makeService({ store, projects, diagnostics, provider });
  try {
    const ownerSession = projects.getProjectSession(
      project.id,
      'engineering-partner',
    );
    const turn = service.sendMessage({
      roomId: ownerSession.room.room.id,
      agentId: 'engineering-partner',
      text: '完成这项样本并提交来源。',
    });
    await service.active.get(ownerSession.room.room.id)?.done;

    await service.drainProjectGroupInbox(project.groupRoomId);
    await waitFor(
      () => projects.plans.get(project.id).items[0].status === 'done',
    );
    const plan = projects.plans.get(project.id);
    assert.equal(plan.items[0].submittedByAgentId, 'engineering-partner');
    assert.equal(plan.items[0].submissionRevision, 2);
    assert.match(plan.items[0].evidence, /成员已完成样本/u);
    assert.equal(plan.items[0].evidenceReview.actorId, reviewerId);

    const submissionEvent = diagnostics.find(
      (event) =>
        event.module === 'social.plan' &&
        event.operation === 'plan.update_item' &&
        event.status === 'completed' &&
        event.details?.itemId === 'trace-work',
    );
    assert.ok(submissionEvent);
    assert.equal(submissionEvent.executionId, turn.turnId);
    assert.equal(submissionEvent.details.projectId, project.id);
    assert.equal(submissionEvent.details.submissionRevision, 2);
    assert.equal(submissionEvent.details.reviewerIds, reviewerId);

    const reviewEvent = diagnostics.find(
      (event) =>
        event.module === 'social.plan' &&
        event.operation === 'plan.update_item' &&
        event.details?.itemId === 'trace-work' &&
        event.details?.reviewerIds === reviewerId &&
        event.status === 'completed' &&
        event !== submissionEvent,
    );
    assert.ok(reviewEvent);
    const outboxEvent = diagnostics.find(
      (event) =>
        event.module === 'social.outbox' &&
        event.operation === 'outbox.claim' &&
        event.details?.itemId === 'trace-work',
    );
    assert.ok(outboxEvent);
    assert.equal(outboxEvent.details.projectId, project.id);
    assert.equal(outboxEvent.details.memberAgentId, reviewerId);
    assert.equal(outboxEvent.details.submissionRevision, 2);

    const reopened = new SocialProjectStore({
      db,
      socialChatStore: store,
    });
    assert.equal(reopened.plans.get(project.id).items[0].status, 'done');
    assert.equal(
      reopened
        .getProject(project.id)
        .members.find((member) => member.agentId === reviewerId).status,
      'active',
    );
  } finally {
    await service.shutdown();
    db.close();
  }
});
