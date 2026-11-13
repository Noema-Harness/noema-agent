import { randomUUID } from 'node:crypto';
import { SOCIAL_SCHEMA_VERSION } from '../../../src/main/chat/social-chat-schema.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SocialChatStore } from '../../../src/main/chat/social-chat-store.mjs';
import { SocialProjectStore } from '../../../src/main/projects/social-project-store.mjs';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { createSocialTestStore } from '../../../test-support/social-team.mjs';
import { acceptAllProjectWorkItems } from '../../../test-support/project-plan-fixtures.mjs';

function makeStores() {
  const db = new Database(':memory:');
  new RootStore(db);
  const socialChatStore = new SocialChatStore(db);
  const socialProjectStore = new SocialProjectStore({ db, socialChatStore });
  return { db, socialChatStore, socialProjectStore };
}

function createMember(socialChatStore, name = '研究员') {
  const room = socialChatStore.createAgent({
    name,
    headline: '资料研究',
    description: '核对项目资料与来源。',
  });
  return { agentId: room.members[0].id, roomId: room.room.id };
}

function createProject(stores, member, extra = {}) {
  return stores.socialProjectStore.createProject({
    id: 'project-price-watch',
    title: '价格追踪器',
    brief: '追踪各平台模型价格并注明来源与变更时间。',
    agentIds: ['noema', member.agentId],
    ...extra,
  });
}

function acceptLegacyStage(stores, projectId) {
  const plan = acceptAllProjectWorkItems(
    stores.socialProjectStore.plans,
    projectId,
  );
  return stores.socialProjectStore.plans.updatePhase({
    projectId,
    expectedRevision: plan.revision,
    phaseId: 'legacy-stage',
    actorAgentId: 'noema',
    status: 'done',
    evidence: '阶段成果与退出条件已核验。',
    reason: '更新兼容旧计划的显式阶段验收。',
  });
}

test('a project creates one shared room and separate hidden member sessions', () => {
  const stores = makeStores();
  const member = createMember(stores.socialChatStore);
  try {
    const originTurn = stores.socialChatStore.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '请组建价格追踪项目。',
      model: 'test-model',
    });
    stores.socialChatStore.completeReply(originTurn.assistantMessageId);
    const project = createProject(stores, member, {
      sourceMessageId: originTurn.userMessageId,
    });

    assert.equal(project.status, 'active');
    assert.equal(project.sourceMessageId, originTurn.userMessageId);
    assert.deepEqual(
      project.group.members.map((agent) => agent.id),
      ['noema', member.agentId],
    );
    assert.equal(project.members.length, 1);
    const session = stores.socialProjectStore.getProjectSession(
      project.id,
      member.agentId,
    );
    assert.equal(session.project.brief, project.brief);
    assert.deepEqual(
      session.room.members.map((agent) => agent.id),
      [member.agentId],
    );
    assert.deepEqual(session.room.messages, []);
    assert.notEqual(session.room.room.id, member.roomId);
    // A project session is also a one-member direct room; its age must not
    // make it the resident room.
    stores.db
      .prepare('UPDATE social_rooms SET created_at = ? WHERE id = ?')
      .run('0001-01-01T00:00:00.000Z', session.room.room.id);
    assert.equal(
      stores.socialChatStore.getAgentResidentRoomId(member.agentId),
      member.roomId,
    );
    assert.ok(
      stores.socialChatStore
        .listRooms()
        .some((room) => room.id === project.groupRoomId),
    );
    assert.ok(
      !stores.socialChatStore
        .listRooms()
        .some((room) => room.id === session.room.room.id),
    );
    assert.equal(
      stores.socialProjectStore.listProjects({ includeArchived: false }).length,
      1,
    );
    stores.socialProjectStore.setAwaitingUser(project.id, true);
    assert.throws(
      () => stores.socialProjectStore.archiveProject(project.id),
      /等待用户反馈/,
    );
    stores.socialProjectStore.setAwaitingUser(project.id, false);
  } finally {
    stores.db.close();
  }
});

test('project workspace binding is durable and cannot change during active project work', () => {
  const stores = makeStores();
  const member = createMember(stores.socialChatStore);
  stores.socialChatStore.setAgentProjectWork(member.agentId, true);
  try {
    const project = createProject(stores, member);
    const original = {
      version: 1,
      canonicalPath: 'C:\\work\\project-a',
      device: '7',
      fileIndex: '42',
    };
    const replacement = {
      ...original,
      canonicalPath: 'C:\\work\\project-b',
      fileIndex: '43',
    };
    assert.equal(
      stores.socialProjectStore.getWorkspaceBinding(project.id),
      null,
    );
    stores.socialProjectStore.bindWorkspace({
      projectId: project.id,
      workspacePath: original.canonicalPath,
      identity: original,
      expectUnbound: true,
    });
    assert.equal(
      stores.socialProjectStore.getWorkspaceBinding(project.id).identity
        .fileIndex,
      '42',
    );
    assert.throws(
      () =>
        stores.socialProjectStore.bindWorkspace({
          projectId: project.id,
          workspacePath: replacement.canonicalPath,
          identity: replacement,
          expectUnbound: true,
        }),
      /绑定已在等待期间变化/u,
    );

    const session = stores.socialProjectStore.getProjectSession(
      project.id,
      member.agentId,
    );
    stores.socialChatStore.createSocialWorkTask({
      id: 'active-project-workspace-task',
      roomId: session.room.room.id,
      agentId: member.agentId,
      workspacePath: original.canonicalPath,
      workspaceKey: 'v1:7:42',
      workspaceIdentity: original,
      taskPrompt: '继续项目工作。',
      model: 'test-model',
    });
    assert.throws(
      () =>
        stores.socialProjectStore.bindWorkspace({
          projectId: project.id,
          workspacePath: replacement.canonicalPath,
          identity: replacement,
          expectedIdentity: original,
        }),
      /仍有工作正在运行/u,
    );

    stores.db
      .prepare(`
        UPDATE social_work_tasks
        SET status = 'completed', phase = 'completed', completed_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        new Date().toISOString(),
        new Date().toISOString(),
        'active-project-workspace-task',
      );
    stores.socialProjectStore.bindWorkspace({
      projectId: project.id,
      workspacePath: replacement.canonicalPath,
      identity: replacement,
      expectedIdentity: original,
    });
    assert.equal(
      stores.socialProjectStore.getWorkspaceBinding(project.id).workspacePath,
      replacement.canonicalPath,
    );
  } finally {
    stores.db.close();
  }
});

test('project growth is keyed to accepted plan revisions and settles each member once', () => {
  const stores = makeStores();
  const first = createMember(stores.socialChatStore, '研究员');
  const second = createMember(stores.socialChatStore, '审阅员');
  try {
    const project = createProject(stores, first);
    stores.socialProjectStore.addProjectMember(project.id, second.agentId);
    stores.socialProjectStore.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      actorAgentId: 'noema',
      reason: '项目成果已核验。',
      plan: {
        stage: '交付',
        objective: '形成可追溯的价格追踪方案。',
        items: [
          {
            id: 'deliver',
            title: '提交核验后的结果',
            ownerAgentId: first.agentId,
            acceptance: '有来源且可复核。',
            dependsOn: [],
            status: 'pending',
            evidence: '结果与来源已核对。',
            blocker: '',
          },
        ],
      },
    });

    acceptLegacyStage(stores, project.id);
    const batch = stores.socialProjectStore.createProjectGrowthBatch(
      project.id,
    );
    assert.equal(batch.status, 'running');
    assert.equal(
      batch.planRevision,
      stores.socialProjectStore.plans.get(project.id).revision,
    );
    assert.throws(
      () => stores.socialProjectStore.archiveProject(project.id),
      /成员经历整理尚未全部完成/u,
    );
    assert.deepEqual(
      new Set(batch.members.map((member) => member.agentId)),
      new Set([first.agentId, second.agentId]),
    );
    assert.equal(
      stores.socialProjectStore.createProjectGrowthBatch(project.id).id,
      batch.id,
      'retrying the same accepted plan revision must not create another batch',
    );

    const firstClaim = stores.socialProjectStore.claimNextProjectGrowthMember(
      batch.id,
    );
    assert.equal(firstClaim.agentId, batch.members[0].agentId);
    stores.socialProjectStore.bindProjectGrowthTurn(
      batch.id,
      firstClaim.agentId,
      'growth-turn-first',
    );
    let state = stores.socialProjectStore.finishProjectGrowthMember(
      batch.id,
      firstClaim.agentId,
      { status: 'no_change', brief: '本次没有形成新的可复用方法。' },
    );
    assert.equal(state.status, 'running');
    const secondClaim = stores.socialProjectStore.claimNextProjectGrowthMember(
      batch.id,
    );
    assert.equal(secondClaim.agentId, batch.members[1].agentId);
    state = stores.socialProjectStore.finishProjectGrowthMember(
      batch.id,
      secondClaim.agentId,
      { status: 'completed', brief: '本次核验方法已记录为经历。' },
    );
    assert.equal(state.status, 'completed');
    assert.deepEqual(
      state.members.map((member) => member.status),
      ['no_change', 'completed'],
    );
    const firstBriefs = stores.socialProjectStore.getPendingProjectGrowthBriefs(
      firstClaim.agentId,
    );
    assert.equal(firstBriefs.length, 1);
    assert.equal(firstBriefs[0].text, '本次没有形成新的可复用方法。');
    assert.equal(
      stores.socialProjectStore.markProjectGrowthBriefsSeen(
        firstClaim.agentId,
        [batch.id],
      ),
      1,
    );
    assert.deepEqual(
      stores.socialProjectStore.getPendingProjectGrowthBriefs(
        firstClaim.agentId,
      ),
      [],
    );
    assert.equal(
      stores.socialProjectStore.getPendingProjectGrowthBriefs(
        secondClaim.agentId,
      ).length,
      1,
      'one member reading a brief must not mark another member’s brief as seen',
    );
    assert.equal(
      stores.socialProjectStore.createProjectGrowthBatch(project.id).id,
      batch.id,
      'a completed revision cannot replay completed member reviews',
    );
  } finally {
    stores.db.close();
  }
});

test('completed growth archives the project once and survives a later restore', () => {
  const stores = makeStores();
  const member = createMember(stores.socialChatStore, '复盘成员');
  try {
    const project = createProject(stores, member);
    stores.socialProjectStore.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      actorAgentId: 'noema',
      reason: '已验收交付。',
      plan: {
        stage: '交付',
        objective: '完成并归档项目。',
        items: [
          {
            id: 'done',
            title: '完成交付',
            ownerAgentId: member.agentId,
            acceptance: '交付已核验。',
            dependsOn: [],
            status: 'pending',
            evidence: '验收记录已保存。',
            blocker: '',
          },
        ],
      },
    });
    acceptLegacyStage(stores, project.id);
    const batch = stores.socialProjectStore.createProjectGrowthBatch(
      project.id,
    );
    const claimed = stores.socialProjectStore.claimNextProjectGrowthMember(
      batch.id,
    );
    stores.socialProjectStore.bindProjectGrowthTurn(
      batch.id,
      member.agentId,
      'archive-growth-turn',
    );
    stores.socialProjectStore.finishProjectGrowthMember(
      batch.id,
      member.agentId,
      {
        status: 'no_change',
        brief: '本次复盘没有产生需要固化的变化。',
      },
    );

    const finalized =
      stores.socialProjectStore.archiveCompletedProjectGrowthBatch(batch.id);
    assert.equal(finalized.archived, true);
    assert.equal(finalized.project.status, 'archived');
    assert.ok(finalized.project.archivedAt);
    assert.ok(finalized.project.growthBatch.finalizedAt);
    assert.equal(
      stores.socialProjectStore.listUnfinalizedCompletedProjectGrowthBatches()
        .length,
      0,
    );
    assert.equal(
      stores.socialProjectStore.archiveCompletedProjectGrowthBatch(batch.id)
        .archived,
      false,
      'reconciliation must be idempotent',
    );

    const restored = stores.socialProjectStore.restoreProject(project.id);
    assert.equal(restored.status, 'active');
    assert.equal(restored.groupRoomId, project.groupRoomId);
    assert.equal(
      stores.socialProjectStore.getProjectSession(project.id, member.agentId)
        .room.room.id,
      claimed.sessionRoomId,
    );
    assert.equal(
      stores.socialProjectStore.listUnfinalizedCompletedProjectGrowthBatches()
        .length,
      0,
      'a restored project must not be re-archived from an old completion event',
    );
  } finally {
    stores.db.close();
  }
});

test('growth cannot start before the shared plan is accepted or while project work is active', () => {
  const stores = makeStores();
  const member = createMember(stores.socialChatStore);
  try {
    const project = createProject(stores, member);
    assert.throws(
      () => stores.socialProjectStore.createProjectGrowthBatch(project.id),
      /尚无可验收的共享计划/,
    );
    stores.socialProjectStore.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      actorAgentId: 'noema',
      reason: '建立交付计划。',
      plan: {
        stage: '交付',
        objective: '完成并核验结果。',
        items: [
          {
            id: 'deliver',
            title: '完成交付',
            ownerAgentId: member.agentId,
            acceptance: '结果可复核。',
            dependsOn: [],
            status: 'pending',
            evidence: '',
            blocker: '',
          },
        ],
      },
    });
    assert.throws(
      () => stores.socialProjectStore.createProjectGrowthBatch(project.id),
      /仍有未验收或阻塞事项/,
    );
    stores.socialProjectStore.plans.replace({
      projectId: project.id,
      expectedRevision: 1,
      actorAgentId: 'noema',
      reason: '接受已核验交付。',
      plan: {
        stage: '交付',
        objective: '完成并核验结果。',
        items: [
          {
            id: 'deliver',
            title: '完成交付',
            ownerAgentId: member.agentId,
            acceptance: '结果可复核。',
            dependsOn: [],
            status: 'pending',
            evidence: '已核对结果。',
            blocker: '',
          },
        ],
      },
    });
    acceptLegacyStage(stores, project.id);
    const turn = stores.socialChatStore.beginTurn({
      roomId: project.groupRoomId,
      agentId: 'noema',
      text: '还有回复正在生成。',
      model: 'test-model',
    });
    assert.throws(
      () => stores.socialProjectStore.createProjectGrowthBatch(project.id),
      /仍有对话、待处理群消息或执行在进行/,
    );
    stores.socialChatStore.interruptReply(turn.assistantMessageId);
  } finally {
    stores.db.close();
  }
});

test('growth recovery preserves settled members and marks an in-flight member interrupted', () => {
  const stores = makeStores();
  const first = createMember(stores.socialChatStore, '研究员');
  const second = createMember(stores.socialChatStore, '审阅员');
  try {
    const project = createProject(stores, first);
    stores.socialProjectStore.addProjectMember(project.id, second.agentId);
    stores.socialProjectStore.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      actorAgentId: 'noema',
      reason: '交付已验证。',
      plan: {
        stage: '交付',
        objective: '记录成员的真实项目经历。',
        items: [
          {
            id: 'deliver',
            title: '交付已验证结果',
            ownerAgentId: first.agentId,
            acceptance: '可复核。',
            dependsOn: [],
            status: 'pending',
            evidence: '已检查结果。',
            blocker: '',
          },
        ],
      },
    });
    acceptLegacyStage(stores, project.id);
    const batch = stores.socialProjectStore.createProjectGrowthBatch(
      project.id,
    );
    const firstGrowth = stores.socialProjectStore.claimNextProjectGrowthMember(
      batch.id,
    );
    const firstTurn = stores.socialChatStore.beginTurn({
      roomId: firstGrowth.sessionRoomId,
      agentId: firstGrowth.agentId,
      senderAgentId: 'noema',
      text: '复盘第一项工作。',
      model: 'test-model',
    });
    stores.socialProjectStore.bindProjectGrowthTurn(
      batch.id,
      firstGrowth.agentId,
      firstTurn.turnId,
    );
    stores.socialChatStore.writeAgentAsset({
      agentId: firstGrowth.agentId,
      path: 'experiences/delivery.md',
      content: '有证据的经历。',
      reason: '验证恢复时能识别已完成资产写入。',
      sourceTurnId: firstTurn.turnId,
      sourceProjectId: project.id,
    });
    stores.socialChatStore.appendAssistantDelta(
      firstTurn.assistantMessageId,
      '第一位成员完成了自审并保存了经历。',
    );
    stores.socialChatStore.completeReply(firstTurn.assistantMessageId);

    const secondGrowth = stores.socialProjectStore.claimNextProjectGrowthMember(
      batch.id,
    );
    const secondTurn = stores.socialChatStore.beginTurn({
      roomId: secondGrowth.sessionRoomId,
      agentId: secondGrowth.agentId,
      senderAgentId: 'noema',
      text: '复盘第二项工作。',
      model: 'test-model',
    });
    stores.socialProjectStore.bindProjectGrowthTurn(
      batch.id,
      secondGrowth.agentId,
      secondTurn.turnId,
    );

    const recovered = new SocialProjectStore({
      db: stores.db,
      socialChatStore: stores.socialChatStore,
    }).getProjectGrowthBatch(batch.id);
    assert.equal(recovered.status, 'running');
    assert.deepEqual(
      recovered.members.map((member) => member.status),
      ['completed', 'interrupted'],
    );
    assert.equal(recovered.members[0].turnId, firstTurn.turnId);
    assert.match(recovered.members[0].brief, /第一位成员完成/u);
    assert.equal(
      stores.socialProjectStore.getPendingProjectGrowthBriefs(
        firstGrowth.agentId,
      ).length,
      1,
    );
    assert.equal(
      stores.socialProjectStore
        .retryProjectGrowthMember(batch.id, secondGrowth.agentId)
        .members.find((member) => member.agentId === secondGrowth.agentId)
        .status,
      'pending',
    );
  } finally {
    stores.db.close();
  }
});

test('growth retry refuses to replay a failed turn after it changed member assets', () => {
  const stores = makeStores();
  const member = createMember(stores.socialChatStore);
  try {
    const project = createProject(stores, member);
    stores.socialProjectStore.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      actorAgentId: 'noema',
      reason: '交付已核验。',
      plan: {
        stage: '交付',
        objective: '完成后整理成员经历。',
        items: [
          {
            id: 'done',
            title: '交付结果',
            ownerAgentId: member.agentId,
            acceptance: '已核验。',
            dependsOn: [],
            status: 'pending',
            evidence: '完成。',
            blocker: '',
          },
        ],
      },
    });
    acceptLegacyStage(stores, project.id);
    const batch = stores.socialProjectStore.createProjectGrowthBatch(
      project.id,
    );
    const claimed = stores.socialProjectStore.claimNextProjectGrowthMember(
      batch.id,
    );
    stores.socialProjectStore.bindProjectGrowthTurn(
      batch.id,
      member.agentId,
      'failed-after-asset-write',
    );
    stores.socialProjectStore.failProjectGrowthMember(
      batch.id,
      member.agentId,
      { status: 'failed', code: 'provider_timeout', message: '中断' },
    );
    stores.socialChatStore.writeAgentAsset({
      agentId: member.agentId,
      path: 'memory.md',
      content: '已有本轮资产副作用。',
      reason: '验证失败后不盲目重放。',
      sourceTurnId: 'failed-after-asset-write',
      sourceProjectId: project.id,
    });
    assert.equal(claimed.agentId, member.agentId);
    assert.throws(
      () =>
        stores.socialProjectStore.retryProjectGrowthMember(
          batch.id,
          member.agentId,
        ),
      /已写入成员资产/u,
    );
    assert.equal(
      stores.socialProjectStore.getProjectGrowthBatch(batch.id).members[0]
        .status,
      'failed',
    );
  } finally {
    stores.db.close();
  }
});

test('a team proposal stays pending until explicitly decided', () => {
  const stores = makeStores();
  const existing = createMember(stores.socialChatStore, '研究员');
  try {
    const proposal = stores.socialProjectStore.createTeamProposal({
      roomId: 'room-noema',
      title: '价格追踪器',
      brief: '持续核对模型 API 价格与来源。',
      leadAgentId: existing.agentId,
      members: [
        { agentId: existing.agentId, task: '核对价格来源。' },
        {
          newAgent: {
            name: '成本分析师',
            headline: '模型成本比较',
            description: '对比模型 API 的定价口径并注明来源。',
          },
          task: '整理各平台的计价单位。',
        },
      ],
    });
    assert.equal(proposal.status, 'pending');
    assert.equal(proposal.projectId, null);
    assert.equal(proposal.members.length, 2);
    assert.equal(
      stores.socialProjectStore.getTeamProposal(proposal.id).members.length,
      2,
    );

    const rejected = stores.socialProjectStore.decideTeamProposal(
      proposal.id,
      'rejected',
      { reason: '先不组队。' },
    );
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.projectId, null);
    assert.throws(
      () =>
        stores.socialProjectStore.decideTeamProposal(
          proposal.id,
          'approved',
          {},
        ),
      /已经处理/u,
    );
  } finally {
    stores.db.close();
  }
});

test('forming a project team atomically creates missing members and their project sessions', () => {
  const stores = makeStores();
  const existing = createMember(stores.socialChatStore, '研究员');
  try {
    const source = stores.socialChatStore.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '建立价格追踪项目。',
      model: 'test-model',
    });
    stores.socialChatStore.completeReply(source.assistantMessageId);
    const formed = stores.socialProjectStore.formProjectTeam({
      title: '价格追踪器',
      brief: '持续核对模型 API 价格与来源。',
      sourceMessageId: source.userMessageId,
      leadAgentId: existing.agentId,
      members: [
        { agentId: existing.agentId, task: '核对价格来源。' },
        {
          newAgent: {
            name: '成本分析师',
            headline: '模型成本比较',
            description: '对比模型 API 的定价口径并注明来源。',
          },
          task: '整理各平台的计价单位。',
        },
      ],
    });

    assert.equal(formed.project.sourceMessageId, source.userMessageId);
    assert.equal(formed.project.leadAgentId, existing.agentId);
    assert.equal(formed.project.leadName, '研究员');
    assert.deepEqual(
      formed.project.group.members.map((agent) => agent.id),
      ['noema', existing.agentId, formed.members[1].agentId],
    );
    assert.equal(
      stores.socialChatStore.getAgent(formed.members[1].agentId).name,
      '成本分析师',
    );
    assert.equal(
      stores.socialProjectStore.getProjectSession(
        formed.project.id,
        formed.members[1].agentId,
      ).room.members[0].id,
      formed.members[1].agentId,
    );
    assert.notEqual(
      stores.socialChatStore.getAgentResidentRoomId(formed.members[1].agentId),
      stores.socialProjectStore.getProjectSession(
        formed.project.id,
        formed.members[1].agentId,
      ).room.room.id,
      'a member keeps its resident chat separate from its project session',
    );

    assert.throws(
      () =>
        stores.socialProjectStore.formProjectTeam({
          title: '',
          brief: '事务失败时回滚新成员。',
          members: [
            { agentId: existing.agentId, task: '有效任务。' },
            {
              newAgent: {
                name: '不应留下的成员',
                headline: '临时角色',
                description: '用于验证事务回滚。',
              },
              task: '另一个有效任务。',
            },
          ],
        }),
      /项目名称/,
    );
    assert.equal(
      stores.socialChatStore
        .listAgents()
        .some((agent) => agent.name === '不应留下的成员'),
      false,
      'member creation rolls back with the project transaction',
    );
  } finally {
    stores.db.close();
  }
});

test('an existing project can add one file-capable specialist without replacing its team', () => {
  const stores = makeStores();
  const first = createMember(stores.socialChatStore, '研究员');
  const second = createMember(stores.socialChatStore, '产品设计师');
  try {
    const source = stores.socialChatStore.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '开始一个需要研究和设计的项目。',
      model: 'test-model',
    });
    stores.socialChatStore.completeReply(source.assistantMessageId);
    const original = stores.socialProjectStore.formProjectTeam({
      title: '价格追踪器',
      brief: '提供真实、可溯源的 AI API 价格信息。',
      sourceMessageId: source.userMessageId,
      members: [
        { agentId: first.agentId, task: '研究价格来源。' },
        { agentId: second.agentId, task: '设计价格展示。' },
      ],
    });
    const priorMembers = original.project.members.map(
      (member) => member.agentId,
    );

    const extended = stores.socialProjectStore.formProjectTeam({
      existingProjectId: original.project.id,
      title: original.project.title,
      brief: original.project.brief,
      originRoomId: 'room-noema',
      sourceMessageId: source.userMessageId,
      members: [
        {
          newAgent: {
            name: '实现工程师',
            headline: '数据工具实现与验证',
            description: '负责可运行实现，并在授权工作区内验证交付。',
            projectWork: true,
          },
          task: '实现价格快照、变更检测与可运行界面。',
        },
      ],
    });

    assert.equal(extended.project.id, original.project.id);
    assert.equal(extended.project.groupRoomId, original.project.groupRoomId);
    assert.deepEqual(
      extended.project.members.slice(0, 2).map((member) => member.agentId),
      priorMembers,
    );
    const added = stores.socialChatStore.getAgent(extended.members[0].agentId);
    assert.ok(added.capabilities.includes('project-work'));
    assert.equal(
      stores.socialProjectStore.getProjectSession(original.project.id, added.id)
        .room.members[0].id,
      added.id,
    );
  } finally {
    stores.db.close();
  }
});

test('forming a team for an archived project restores its group and reuses member sessions', () => {
  const stores = makeStores();
  const existing = createMember(stores.socialChatStore, '研究员');
  const added = createMember(stores.socialChatStore, '工程师');
  try {
    const original = createProject(stores, existing);
    const originalSessionId = original.members[0].sessionRoomId;
    stores.socialProjectStore.archiveProject(original.id);
    const resumed = stores.socialProjectStore.formProjectTeam({
      existingProjectId: original.id,
      title: original.title,
      brief: original.brief,
      members: [
        { agentId: existing.agentId, task: '续接研究资料。' },
        { agentId: added.agentId, task: '补充实现评估。' },
      ],
    });

    assert.equal(resumed.project.id, original.id);
    assert.equal(resumed.project.groupRoomId, original.groupRoomId);
    assert.equal(resumed.project.status, 'active');
    assert.equal(resumed.project.members.length, 2);
    assert.equal(
      resumed.project.members.find(
        (member) => member.agentId === existing.agentId,
      )?.sessionRoomId,
      originalSessionId,
    );
    assert.ok(
      stores.socialProjectStore.getProjectSession(original.id, added.agentId),
    );
  } finally {
    stores.db.close();
  }
});

test('project session lookup is tied to one active member and excludes archived work', () => {
  const stores = makeStores();
  const member = createMember(stores.socialChatStore);
  try {
    const project = createProject(stores, member);
    const sessionRoomId = project.members[0].sessionRoomId;
    assert.deepEqual(
      stores.socialProjectStore.getProjectSessionContext(
        sessionRoomId,
        member.agentId,
      ),
      {
        projectId: project.id,
        title: project.title,
        brief: project.brief,
        sourceMessageId: null,
        status: 'active',
        agentId: member.agentId,
        roomId: sessionRoomId,
        groupRoomId: project.groupRoomId,
      },
    );
    assert.deepEqual(
      stores.socialProjectStore.getProjectSessionContext(
        project.groupRoomId,
        member.agentId,
      ),
      {
        projectId: project.id,
        title: project.title,
        brief: project.brief,
        sourceMessageId: null,
        status: 'active',
        agentId: member.agentId,
        roomId: sessionRoomId,
        groupRoomId: project.groupRoomId,
      },
    );
    assert.equal(
      stores.socialProjectStore.getProjectSessionContext(
        project.groupRoomId,
        'noema',
      ),
      null,
    );
    assert.throws(
      () =>
        stores.socialProjectStore.getProjectSessionContext(
          sessionRoomId,
          'noema',
        ),
      /只属于其指定成员/,
    );
    stores.socialProjectStore.archiveProject(project.id);
    assert.throws(
      () =>
        stores.socialProjectStore.getProjectSessionContext(
          sessionRoomId,
          member.agentId,
        ),
      /项目已归档/,
    );
  } finally {
    stores.db.close();
  }
});

test('private, project-session, and group transcripts remain independent through archive and restore', () => {
  const stores = makeStores();
  const member = createMember(stores.socialChatStore);
  try {
    const project = createProject(stores, member);
    const session = stores.socialProjectStore.getProjectSession(
      project.id,
      member.agentId,
    );
    const personalTurn = stores.socialChatStore.beginTurn({
      roomId: member.roomId,
      agentId: member.agentId,
      text: '个人私聊内容。',
      model: 'test-model',
    });
    stores.socialChatStore.completeReply(personalTurn.assistantMessageId);
    const projectTurn = stores.socialChatStore.beginTurn({
      roomId: session.room.room.id,
      agentId: member.agentId,
      text: '项目会话内容。',
      model: 'test-model',
    });
    stores.socialChatStore.completeReply(projectTurn.assistantMessageId);
    const groupTurn = stores.socialChatStore.beginTurn({
      roomId: project.groupRoomId,
      agentId: 'noema',
      text: '群内公开内容。',
      model: 'test-model',
    });
    stores.socialChatStore.completeReply(groupTurn.assistantMessageId);

    const personalMessages = stores.socialChatStore.getRoomSnapshot(
      member.roomId,
    ).messages;
    const projectMessages = stores.socialChatStore.getRoomSnapshot(
      session.room.room.id,
    ).messages;
    assert.ok(
      personalMessages.some((message) => message.content === '个人私聊内容。'),
    );
    assert.ok(
      !personalMessages.some((message) => message.content === '项目会话内容。'),
    );
    assert.ok(
      projectMessages.some((message) => message.content === '项目会话内容。'),
    );
    assert.ok(
      !projectMessages.some((message) => message.content === '个人私聊内容。'),
    );
    assert.ok(
      stores.socialChatStore
        .getRoomSnapshot(project.groupRoomId)
        .messages.some((m) => m.content === '群内公开内容。'),
    );

    const reopenedChatStore = new SocialChatStore(stores.db);
    const reopenedProjectStore = new SocialProjectStore({
      db: stores.db,
      socialChatStore: reopenedChatStore,
    });
    const reopened = reopenedProjectStore.getProject(project.id);
    assert.equal(reopened.groupRoomId, project.groupRoomId);
    assert.equal(
      reopenedProjectStore.getProjectSession(project.id, member.agentId).room
        .room.id,
      session.room.room.id,
    );
    assert.ok(
      reopenedProjectStore
        .getProjectSession(project.id, member.agentId)
        .room.messages.some((message) => message.content === '项目会话内容。'),
    );

    const interrupted = stores.socialChatStore.beginTurn({
      roomId: session.room.room.id,
      agentId: member.agentId,
      text: '未结束的执行。',
      model: 'test-model',
    });
    assert.throws(
      () => stores.socialProjectStore.archiveProject(project.id),
      /仍有对话或执行/,
    );
    stores.socialChatStore.interruptReply(interrupted.assistantMessageId);

    const archived = stores.socialProjectStore.archiveProject(project.id);
    assert.equal(archived.status, 'archived');
    assert.ok(
      !stores.socialChatStore
        .listRooms()
        .some((room) => room.id === project.groupRoomId),
    );
    assert.equal(
      stores.socialProjectStore.listProjects({ includeArchived: false }).length,
      0,
    );

    const restored = stores.socialProjectStore.restoreProject(project.id);
    assert.equal(restored.status, 'active');
    assert.equal(restored.groupRoomId, project.groupRoomId);
    assert.equal(
      stores.socialProjectStore.getProjectSession(project.id, member.agentId)
        .room.room.id,
      session.room.room.id,
    );
    assert.ok(
      stores.socialChatStore
        .listRooms()
        .some((room) => room.id === project.groupRoomId),
    );
    assert.ok(
      stores.socialChatStore
        .getRoomSnapshot(session.room.room.id)
        .messages.some((m) => m.content === '项目会话内容。'),
    );
  } finally {
    stores.db.close();
  }
});

test('a removed member can rejoin the same project session without losing its history', () => {
  const stores = makeStores();
  const member = createMember(stores.socialChatStore);
  try {
    const project = createProject(stores, member);
    const original = stores.socialProjectStore.getProjectSession(
      project.id,
      member.agentId,
    );
    const turn = stores.socialChatStore.beginTurn({
      roomId: original.room.room.id,
      agentId: member.agentId,
      text: '这段经验保留在项目会话。',
      model: 'test-model',
    });
    stores.socialChatStore.completeReply(turn.assistantMessageId);
    stores.socialProjectStore.removeProjectMember(project.id, member.agentId);
    assert.throws(
      () =>
        stores.socialProjectStore.getProjectSession(project.id, member.agentId),
      /已离开项目/,
    );
    const rejoined = stores.socialProjectStore.addProjectMember(
      project.id,
      member.agentId,
    );
    assert.equal(rejoined.members[0].sessionRoomId, original.room.room.id);
    assert.ok(
      stores.socialProjectStore
        .getProjectSession(project.id, member.agentId)
        .room.messages.some(
          (message) => message.content === '这段经验保留在项目会话。',
        ),
    );
    assert.throws(
      () => stores.socialProjectStore.removeProjectMember(project.id, 'noema'),
      /不能从项目移除/,
    );
  } finally {
    stores.db.close();
  }
});

test('queued deliveries and pending member reports block archive and member removal', () => {
  const stores = makeStores();
  const member = createMember(stores.socialChatStore);
  try {
    const project = createProject(stores, member);
    const session = stores.socialProjectStore.getProjectSession(
      project.id,
      member.agentId,
    );
    const groupTurn = stores.socialChatStore.beginTurn({
      roomId: project.groupRoomId,
      agentId: 'noema',
      text: '请成员核对本周的交付。',
      model: 'test-model',
    });
    stores.socialChatStore.completeReply(groupTurn.assistantMessageId);
    const now = new Date().toISOString();
    const inboxTurnId = randomUUID();
    stores.db
      .prepare(`
        INSERT INTO social_project_group_inbox
          (turn_id, project_id, group_room_id, agent_id, session_room_id,
           group_user_message_id, queued_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        inboxTurnId,
        project.id,
        project.groupRoomId,
        member.agentId,
        session.room.room.id,
        groupTurn.userMessageId,
        now,
      );

    const queued = stores.socialProjectStore.getProject(project.id);
    assert.equal(queued.unfinished.queuedDeliveries, 1);
    assert.throws(
      () => stores.socialProjectStore.archiveProject(project.id),
      /交付在队列/,
    );
    assert.throws(
      () =>
        stores.socialProjectStore.removeProjectMember(
          project.id,
          member.agentId,
        ),
      /待处理的交付/,
    );

    stores.db
      .prepare('DELETE FROM social_project_group_inbox WHERE turn_id = ?')
      .run(inboxTurnId);
    const reportId = randomUUID();
    stores.db
      .prepare(`
        INSERT INTO social_project_reports
          (id, project_id, source_turn_id, source_user_message_id,
           source_group_assistant_message_id, agent_id, group_room_id,
           session_room_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `)
      .run(
        reportId,
        project.id,
        randomUUID(),
        groupTurn.userMessageId,
        groupTurn.assistantMessageId,
        member.agentId,
        project.groupRoomId,
        session.room.room.id,
        now,
        now,
      );
    assert.equal(
      stores.socialProjectStore.getProject(project.id).unfinished
        .pendingReports,
      1,
    );
    assert.throws(
      () => stores.socialProjectStore.archiveProject(project.id),
      /待整理的成员结果/,
    );

    stores.db
      .prepare('DELETE FROM social_project_reports WHERE id = ?')
      .run(reportId);
    const archived = stores.socialProjectStore.archiveProject(project.id);
    assert.equal(archived.status, 'archived');
    assert.equal(archived.unfinished.queuedDeliveries, 0);
    assert.equal(archived.unfinished.pendingReports, 0);
  } finally {
    stores.db.close();
  }
});

test('schema v11 upgrades to the current schema without deleting chats or re-enabling revoked capabilities', () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const oldStore = createSocialTestStore(db);
  oldStore.setAgentProjectWork('engineering-partner', false);
  const roomBefore = oldStore.getRoomSnapshot('room-engineering-collaboration');
  try {
    db.exec(`
      DROP TABLE social_work_file_change_operations;
      DROP TABLE social_work_file_changes;
      DROP TABLE IF EXISTS social_work_workspace_write_locks;
      DROP TABLE IF EXISTS social_work_command_batches;
      DROP TABLE IF EXISTS social_work_change_blobs;
      ALTER TABLE social_work_tasks DROP COLUMN workspace_identity_json;
      DROP TABLE social_user_memories_fts;
      DROP INDEX social_user_memories_updated;
      DROP TABLE social_user_memories;
      DROP TABLE social_user_followups;
      DROP TABLE application_shutdown_intent;
      ALTER TABLE social_work_tasks DROP COLUMN project_plan_item_id;
      ALTER TABLE social_work_tasks DROP COLUMN project_result_pending;
      DELETE FROM social_schema_migrations WHERE version = 26; DELETE FROM social_schema_migrations WHERE version = 25;
      DROP TABLE IF EXISTS social_project_growth_members;
      DROP TABLE IF EXISTS social_project_growth_batches;
      DELETE FROM social_schema_migrations WHERE version = 24;
      DELETE FROM social_schema_migrations WHERE version = 23;
      DROP TABLE IF EXISTS social_project_dispatch_log;
      DROP TABLE IF EXISTS social_project_publications;
      DROP TABLE IF EXISTS social_project_read_cursors;
      DELETE FROM social_schema_migrations WHERE version = 22;
      DROP TABLE social_project_plan_revisions;
      DELETE FROM social_schema_migrations WHERE version = 21;
      DROP TABLE social_agent_asset_revisions;
      DELETE FROM social_schema_migrations WHERE version = 20;
      DROP TABLE social_project_reports;
      DELETE FROM social_schema_migrations WHERE version = 19;
      DROP TABLE social_project_group_inbox;
      DELETE FROM social_schema_migrations WHERE version = 18;
      DROP TABLE social_work_runtime_checkpoints;
      DELETE FROM social_schema_migrations WHERE version = 17;
      ALTER TABLE social_messages DROP COLUMN sender_agent_id;
      DELETE FROM social_schema_migrations WHERE version = 16;
      DROP TABLE social_work_execution_steps;
      DELETE FROM social_schema_migrations WHERE version = 14;
      DELETE FROM social_schema_migrations WHERE version = 13;
      ALTER TABLE social_work_tasks DROP COLUMN execution_engine;
      DROP TABLE social_project_reviews;
      DELETE FROM social_schema_migrations WHERE version = 15;
      DROP TABLE social_project_sessions;
      DROP TABLE social_projects;
      DELETE FROM social_schema_migrations WHERE version > 11;
    `);
    const upgradedStore = new SocialChatStore(db);
    assert.equal(
      db
        .prepare('SELECT MAX(version) AS version FROM social_schema_migrations')
        .get().version,
      SOCIAL_SCHEMA_VERSION,
    );
    assert.deepEqual(
      upgradedStore
        .getRoomSnapshot('room-engineering-collaboration')
        .members.map((m) => m.id),
      roomBefore.members.map((m) => m.id),
    );
    assert.deepEqual(
      upgradedStore.getAgent('engineering-partner').capabilities,
      [],
    );
    assert.equal(
      upgradedStore.getRoomSnapshot('room-engineering-collaboration').messages
        .length,
      roomBefore.messages.length,
    );
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});
