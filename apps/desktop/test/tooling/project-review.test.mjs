import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../../src/main/storage/root-store.mjs';
import { SocialChatStore } from '../../src/main/chat/social-chat-store.mjs';
import { SocialProjectStore } from '../../src/main/projects/social-project-store.mjs';
import { SocialChatService } from '../../src/main/chat/social-chat-service.mjs';
import { acceptAllProjectWorkItems } from '../../test-support/project-plan-fixtures.mjs';

function fixture() {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = new SocialChatStore(db);
  const member = store.createAgent({
    name: '设计师',
    headline: '界面设计',
    description: '设计和核对交互。',
  });
  const projects = new SocialProjectStore({ db, socialChatStore: store });
  const project = projects.createProject({
    title: '价格追踪器',
    brief: '比较价格与来源。',
    agentIds: ['noema', member.members[0].id],
  });
  const other = projects.createProject({
    title: '旅行计划',
    brief: '整理路线。',
    agentIds: ['noema', member.members[0].id],
  });
  return { db, store, projects, project, other, member };
}

function request(f) {
  const turn = f.store.beginTurn({
    roomId: 'room-noema',
    agentId: 'noema',
    text: '请准备评审。',
    model: 'test',
  });
  f.store.appendAssistantDelta(
    turn.assistantMessageId,
    '请查看第一版，阅读顺序合适吗？',
  );
  const review = f.projects.requestReview({
    projectId: f.project.id,
    messageId: turn.assistantMessageId,
    question: '阅读顺序合适吗？',
  });
  return { turn, review };
}

test('review creation atomically settles its main-chat anchor and pauses only its project', () => {
  const f = fixture();
  try {
    const { turn, review } = request(f);
    assert.equal(
      f.store.getSocialMessage(turn.assistantMessageId).status,
      'complete',
    );
    assert.equal(
      f.projects.getProject(f.project.id).pendingReview.id,
      review.id,
    );
    assert.equal(f.projects.getProject(f.project.id).status, 'awaiting_user');
    assert.equal(f.projects.getProject(f.other.id).status, 'active');
    assert.equal(
      f.projects.requestReview({
        projectId: f.project.id,
        messageId: turn.assistantMessageId,
        question: '重试',
      }).id,
      review.id,
    );
    assert.deepEqual(f.projects.listReviewsForRoom(f.project.groupRoomId), []);
    assert.equal(f.projects.listReviewsForRoom('room-noema').length, 1);
    assert.throws(
      () => f.projects.setAwaitingUser(f.project.id, false),
      /明确反馈/,
    );
    assert.throws(
      () => f.projects.assertWorkAllowed(f.project.groupRoomId),
      /等待用户评审/,
    );
    assert.throws(
      () => f.projects.assertWorkAllowed(f.project.members[0].sessionRoomId),
      /等待用户评审/,
    );
    assert.doesNotThrow(() =>
      f.projects.assertWorkAllowed(f.other.groupRoomId),
    );
  } finally {
    f.db.close();
  }
});

test('review rejects wrong provenance and a failed response transaction leaves it pending', () => {
  const f = fixture();
  try {
    const { turn, review } = request(f);
    assert.throws(
      () =>
        f.projects.requestReview({
          projectId: f.other.id,
          messageId: turn.userMessageId,
          question: '不合法来源',
        }),
      /主聊中的有效消息/,
    );
    assert.throws(
      () =>
        f.projects.submitReview({
          reviewId: review.id,
          roomId: f.project.groupRoomId,
          feedback: '通过',
          beginTurn: () => {},
        }),
      /对应 Noema 主聊/,
    );
    assert.throws(
      () =>
        f.projects.submitReview({
          reviewId: review.id,
          roomId: 'room-noema',
          feedback: '调整顺序',
          beginTurn: () => {
            throw new Error('injected write failure');
          },
        }),
      /injected/,
    );
    assert.equal(f.projects.getReview(review.id).status, 'pending');
    assert.equal(f.projects.getProject(f.project.id).status, 'awaiting_user');
  } finally {
    f.db.close();
  }
});

test('review cannot pause a project while a member report is queued for Noema', () => {
  const f = fixture();
  try {
    const memberId = f.member.members[0].id;
    const member = f.project.members.find(
      (entry) => entry.agentId === memberId,
    );
    const turn = f.store.beginTurn({
      roomId: f.project.groupRoomId,
      agentId: memberId,
      text: '阶段成果已提交，请核对。',
      model: 'test',
    });
    f.store.appendAssistantDelta(
      turn.assistantMessageId,
      '这是成员的阶段报告。',
    );
    f.store.completeReplies([turn.assistantMessageId], {
      projectId: f.project.id,
      sourceTurnId: turn.turnId,
      sourceUserMessageId: turn.userMessageId,
      sourceGroupAssistantMessageId: turn.assistantMessageId,
      agentId: memberId,
      groupRoomId: f.project.groupRoomId,
      sessionRoomId: member.sessionRoomId,
    });
    assert.match(
      f.projects.reviewBlockReason(f.project.id),
      /成员报告待 Noema 处理/u,
    );
    assert.throws(() => request(f), /成员报告待 Noema 处理/u);
    assert.equal(f.projects.getProject(f.project.id).status, 'active');
    assert.equal(f.projects.getProject(f.project.id).pendingReview, null);
  } finally {
    f.db.close();
  }
});

test('main chat does not offer a project review while member reports are pending', async () => {
  const f = fixture();
  const memberId = f.member.members[0].id;
  const member = f.project.members.find((entry) => entry.agentId === memberId);
  const reportTurn = f.store.beginTurn({
    roomId: f.project.groupRoomId,
    agentId: memberId,
    text: '阶段成果已提交，请核对。',
    model: 'test',
  });
  f.store.appendAssistantDelta(reportTurn.assistantMessageId, '这是阶段报告。');
  f.store.completeReplies([reportTurn.assistantMessageId], {
    projectId: f.project.id,
    sourceTurnId: reportTurn.turnId,
    sourceUserMessageId: reportTurn.userMessageId,
    sourceGroupAssistantMessageId: reportTurn.assistantMessageId,
    agentId: memberId,
    groupRoomId: f.project.groupRoomId,
    sessionRoomId: member.sessionRoomId,
  });
  const provider = {
    async *streamChat(input) {
      const reviewTool = input.tools.find(
        (tool) => tool.function.name === 'request_project_review',
      );
      assert.ok(reviewTool, 'an unrelated reviewable project may remain');
      assert.equal(
        reviewTool.function.parameters.properties.project_id.type,
        'string',
      );
      const reviewChoiceLine = input.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .flatMap((content) => content.split('\n'))
        .find((line) => line.startsWith('可请求用户评审的项目：'));
      assert.equal(
        reviewChoiceLine?.includes(f.project.id) ?? false,
        false,
        'the project with a pending report must not appear in review choices',
      );
      yield '我先处理完成员报告，再判断是否需要你评审。';
    },
  };
  const service = new SocialChatService({
    store: f.store,
    projectStore: f.projects,
    provider,
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test',
    getRootState: async () => ({}),
  });
  try {
    const sent = service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '请告知我项目最新进度。',
    });
    await service.active.get('room-noema')?.done;
    assert.equal(f.store.getSocialMessage(sent.messageId).status, 'complete');
    assert.deepEqual(f.projects.listReviewsForRoom('room-noema'), []);
    assert.equal(f.projects.getProject(f.project.id).status, 'active');
  } finally {
    await service.shutdown();
    f.db.close();
  }
});

test('review can pause at a legacy awaiting-review phase while a member report is queued', () => {
  const f = fixture();
  try {
    const memberId = f.member.members[0].id;
    const member = f.project.members.find(
      (entry) => entry.agentId === memberId,
    );
    f.projects.plans.replace({
      projectId: f.project.id,
      expectedRevision: 0,
      reason: '两项交付已验收，阶段到达用户评审门。',
      plan: {
        objective: '基于证据完成一个阶段，并在需要时交用户判断。',
        phases: [
          {
            id: 'phase-one',
            title: '阶段一',
            outcome: '工作项已完成。',
            exitCriteria: '工作成果有可核验依据。',
            dependsOn: [],
            status: 'pending',
            evidence: '',
            workItems: [
              {
                id: 'deliverable',
                title: '交付成果',
                ownerAgentId: memberId,
                acceptance: '提供可核验的成果。',
                dependsOn: [],
                status: 'pending',
                evidence: '成果依据已经 Noema 核验并记录。',
                blocker: '',
              },
            ],
          },
        ],
      },
    });
    acceptAllProjectWorkItems(f.projects.plans, f.project.id);
    const acceptedPlan = f.projects.plans.get(f.project.id);
    f.projects.plans.updatePhase({
      projectId: f.project.id,
      expectedRevision: acceptedPlan.revision,
      phaseId: 'phase-one',
      actorAgentId: 'noema',
      status: 'done',
      evidence: '阶段交付和出口条件均已核验。',
      reason: '测试夹具建立已验收阶段。',
    });
    // Simulate an older persisted "done" item whose independent review record
    // was never written. It remains an awaiting-review gate after migration.
    const latestPlan = f.projects.plans.get(f.project.id);
    const latestRevision = f.db
      .prepare(
        'SELECT items_json FROM social_project_plan_revisions WHERE project_id = ? AND revision = ?',
      )
      .get(f.project.id, latestPlan.revision);
    const legacyPlan = JSON.parse(latestRevision.items_json);
    legacyPlan.phases[0].workItems[0].evidenceReview = null;
    legacyPlan.phases[0].workItems[0].evidenceReviews = [];
    f.db
      .prepare(
        'UPDATE social_project_plan_revisions SET items_json = ? WHERE project_id = ? AND revision = ?',
      )
      .run(JSON.stringify(legacyPlan), f.project.id, latestPlan.revision);
    assert.equal(
      f.projects.plans.get(f.project.id).phases[0].state,
      'awaiting_review',
    );
    const turn = f.store.beginTurn({
      roomId: f.project.groupRoomId,
      agentId: memberId,
      text: '交付后补充一条说明。',
      model: 'test',
    });
    f.store.appendAssistantDelta(turn.assistantMessageId, '这是补充报告。');
    f.store.completeReplies([turn.assistantMessageId], {
      projectId: f.project.id,
      sourceTurnId: turn.turnId,
      sourceUserMessageId: turn.userMessageId,
      sourceGroupAssistantMessageId: turn.assistantMessageId,
      agentId: memberId,
      groupRoomId: f.project.groupRoomId,
      sessionRoomId: member.sessionRoomId,
    });

    const { review } = request(f);
    assert.equal(review.projectId, f.project.id);
    assert.equal(f.projects.getProject(f.project.id).status, 'awaiting_user');
    assert.equal(
      f.db
        .prepare(
          'SELECT status FROM social_project_reports WHERE project_id = ?',
        )
        .get(f.project.id).status,
      'pending',
    );
  } finally {
    f.db.close();
  }
});

test('pending review survives reopening with its original project and message identity', () => {
  const f = fixture();
  let copy;
  try {
    const { review } = request(f);
    copy = new Database(f.db.serialize());
    const store = new SocialChatStore(copy);
    const projects = new SocialProjectStore({
      db: copy,
      socialChatStore: store,
    });
    assert.deepEqual(projects.getReview(review.id), review);
    assert.equal(
      projects.getProject(f.project.id).pendingReview.requestMessageId,
      review.requestMessageId,
    );
    assert.equal(
      store.resolveReplyTarget({
        roomId: review.roomId,
        messageId: review.requestMessageId,
      }).id,
      review.requestMessageId,
    );
  } finally {
    copy?.close();
    f.db.close();
  }
});

test('real service tool requests review; ordinary chat cannot resume it; failed feedback inference is safely retried', async () => {
  const f = fixture();
  let mode = 'request';
  let calls = 0;
  const provider = {
    async *streamChat(input) {
      calls++;
      if (mode === 'request') {
        assert.ok(
          input.tools.some(
            (tool) => tool.function.name === 'request_project_review',
          ),
        );
        input.onToolCalls([
          {
            id: 'review-call',
            type: 'function',
            function: {
              name: 'request_project_review',
              arguments: JSON.stringify({
                project_id: f.project.id,
                question: '请检查第一版阅读顺序，建议先展示价格变化。',
              }),
            },
          },
        ]);
        return;
      }
      if (mode === 'fail') throw new Error('injected network failure');
      yield '已收到。';
    },
  };
  const service = new SocialChatService({
    store: f.store,
    projectStore: f.projects,
    provider,
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test',
    getRootState: async () => ({}),
  });
  try {
    service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '第一版已完成，请向我提出评审。',
    });
    await service.active.get('room-noema')?.done;
    const review = f.projects.listReviewsForRoom('room-noema')[0];
    assert.ok(review);
    mode = 'plain';
    service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '今天天气怎么样？',
    });
    await service.active.get('room-noema')?.done;
    assert.equal(f.projects.getProject(f.project.id).status, 'awaiting_user');
    mode = 'fail';
    const submitted = service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '请先展示变化，缩短说明。',
      reviewRequestId: review.id,
    });
    await service.active.get('room-noema')?.done;
    const answered = f.projects.getReview(review.id);
    assert.equal(answered.status, 'answered');
    assert.equal(answered.feedback, '请先展示变化，缩短说明。');
    assert.equal(
      f.store.getSocialMessage(submitted.messageId).status,
      'failed',
    );
    assert.equal(f.projects.getProject(f.project.id).status, 'active');
    const count = f.store.getRoomSnapshot('room-noema').messages.length;
    assert.throws(
      () =>
        service.sendMessage({
          roomId: 'room-noema',
          agentId: 'noema',
          text: '重复',
          reviewRequestId: review.id,
        }),
      /已经提交/,
    );
    assert.equal(f.store.getRoomSnapshot('room-noema').messages.length, count);
    mode = 'plain';
    service.retryReply(submitted.messageId);
    await service.active.get('room-noema')?.done;
    assert.equal(
      f.store.getSocialMessage(submitted.messageId).status,
      'complete',
    );
    assert.equal(f.store.getRoomSnapshot('room-noema').messages.length, count);
    assert.equal(calls, 4);
  } finally {
    await service.shutdown();
    f.db.close();
  }
});

test('review feedback turn carries a scoped context and executes a public handoff', async () => {
  const f = fixture();
  let calls = 0;
  const provider = {
    async *streamChat(input) {
      calls++;
      if (calls === 1) {
        input.onToolCalls([
          {
            id: 'review-call',
            type: 'function',
            function: {
              name: 'request_project_review',
              arguments: JSON.stringify({
                project_id: f.project.id,
                question: '这版计划是否适合继续？',
              }),
            },
          },
        ]);
        return;
      }
      if (calls === 2) {
        const toolNames = input.tools.map((tool) => tool.function.name);
        const groupTool = input.tools.find(
          (tool) => tool.function.name === 'project_group',
        );
        assert.ok(toolNames.includes('manage_project_plan'));
        assert.ok(groupTool);
        for (const unrelatedTool of [
          'create_project_team',
          'request_project_review',
          'complete_project',
          'start_project_work',
        ])
          assert.equal(
            toolNames.includes(unrelatedTool),
            false,
            `${unrelatedTool} should not be available in a project-bound review turn`,
          );
        assert.equal(
          groupTool.function.parameters.properties.project_id.type,
          'string',
          'schema remains stable; runtime binds the group tool to its reviewed project',
        );
        assert.ok(
          input.messages.some(
            (message) =>
              message.role === 'system' &&
              message.content.includes('正式评审反馈') &&
              message.content.includes(f.project.title),
          ),
        );
        input.onToolCalls([
          {
            id: 'group-send',
            type: 'function',
            function: {
              name: 'project_group',
              arguments: JSON.stringify({
                operation: 'send',
                text: '@设计师 按用户确认的评审节奏继续，阶段出口再向 Noema 汇报。',
              }),
            },
          },
        ]);
        return;
      }
      if (calls === 3) {
        const toolNames = input.tools.map((tool) => tool.function.name);
        assert.equal(
          toolNames.includes('request_project_review'),
          false,
          'a feedback turn must remain scoped after executing its project action',
        );
        input.onToolCalls([
          {
            id: 'review-again',
            type: 'function',
            function: {
              name: 'request_project_review',
              arguments: JSON.stringify({
                project_id: f.project.id,
                question: '是否继续下一步？',
              }),
            },
          },
        ]);
        return;
      }
      if (calls === 4) {
        const rejected = input.messages.findLast(
          (message) => message.role === 'tool',
        );
        assert.match(rejected.content, /当前不能发起该项目评审/u);
        yield '已将下一步交办发送到项目群；本轮未新建评审。';
        return;
      }
      yield '已将下一步交办发送到项目群。';
    },
  };
  const service = new SocialChatService({
    store: f.store,
    projectStore: f.projects,
    provider,
    secretStore: { isConfigured: () => true },
    getSelectedModel: () => 'test',
    getRootState: async () => ({}),
  });
  try {
    service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '请提出计划评审。',
    });
    await service.active.get('room-noema')?.done;
    const review = f.projects.listReviewsForRoom('room-noema')[0];
    assert.ok(review);

    service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '按建议继续，并在阶段出口汇总给我。',
      reviewRequestId: review.id,
    });
    await service.active.get('room-noema')?.done;

    assert.equal(calls, 4);
    assert.equal(f.projects.getReview(review.id).status, 'answered');
    assert.equal(f.projects.getProject(f.project.id).status, 'active');
    assert.equal(f.projects.getProject(f.other.id).status, 'active');
    assert.equal(
      Boolean(f.projects.getProject(f.project.id).pendingReview),
      false,
    );
    assert.equal(
      f.db.prepare('SELECT COUNT(*) AS count FROM social_project_reviews').get()
        .count,
      1,
    );
    assert.ok(
      f.store
        .getRoomSnapshot(f.project.groupRoomId)
        .messages.some((message) =>
          message.content.includes('阶段出口再向 Noema 汇报'),
        ),
      'the reviewed project should receive the actual public handoff',
    );
  } finally {
    await service.shutdown();
    f.db.close();
  }
});

test('v14 to current migrations preserve projects and old messages', () => {
  const f = fixture();
  try {
    const before = f.store.getRoomSnapshot(f.project.groupRoomId).messages;
    f.db.exec(
      'DROP TABLE social_work_file_change_operations; DROP TABLE social_work_file_changes; ALTER TABLE social_projects DROP COLUMN workspace_identity_json; ALTER TABLE social_projects DROP COLUMN workspace_path; ALTER TABLE social_work_tasks DROP COLUMN workspace_identity_json; ALTER TABLE social_work_tasks DROP COLUMN project_plan_item_id; ALTER TABLE social_work_tasks DROP COLUMN project_result_pending; DELETE FROM social_schema_migrations WHERE version = 27; DELETE FROM social_schema_migrations WHERE version = 26; DELETE FROM social_schema_migrations WHERE version = 25; ALTER TABLE social_project_growth_batches DROP COLUMN finalized_at; DROP TABLE social_project_growth_members; DROP TABLE social_project_growth_batches; DELETE FROM social_schema_migrations WHERE version = 24; DELETE FROM social_schema_migrations WHERE version = 23; DROP TABLE social_project_dispatch_log; DROP TABLE social_project_publications; DROP TABLE social_project_read_cursors; DELETE FROM social_schema_migrations WHERE version = 22; DROP TABLE social_project_plan_revisions; DELETE FROM social_schema_migrations WHERE version = 21; DROP TABLE social_agent_asset_revisions; DELETE FROM social_schema_migrations WHERE version = 20; DROP TABLE social_project_reports; DELETE FROM social_schema_migrations WHERE version = 19; DROP TABLE social_project_group_inbox; DELETE FROM social_schema_migrations WHERE version = 18; DROP TABLE social_work_runtime_checkpoints; DELETE FROM social_schema_migrations WHERE version = 17; ALTER TABLE social_messages DROP COLUMN sender_agent_id; DELETE FROM social_schema_migrations WHERE version = 16; ALTER TABLE social_work_execution_steps DROP COLUMN arguments_json; ALTER TABLE social_work_execution_steps DROP COLUMN result_json; DROP TABLE social_project_reviews; DELETE FROM social_schema_migrations WHERE version = 15; DROP TABLE social_user_memories_fts; DROP INDEX social_user_memories_updated; DROP TABLE social_user_memories; DROP TABLE social_user_followups; DROP TABLE application_shutdown_intent; DELETE FROM social_schema_migrations WHERE version >= 15;',
    );
    const store = new SocialChatStore(f.db);
    const projects = new SocialProjectStore({
      db: f.db,
      socialChatStore: store,
    });
    assert.equal(projects.getProject(f.project.id).pendingReview, null);
    assert.deepEqual(
      store.getRoomSnapshot(f.project.groupRoomId).messages,
      before,
    );
  } finally {
    f.db.close();
  }
});
