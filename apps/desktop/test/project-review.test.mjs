import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatStore } from '../src/social-chat-store.mjs';
import { SocialProjectStore } from '../src/social-project-store.mjs';
import { SocialChatService } from '../src/social-chat-service.mjs';

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

test('v14 to v15 migration preserves projects and old messages', () => {
  const f = fixture();
  try {
    const before = f.store.getRoomSnapshot(f.project.groupRoomId).messages;
    f.db.exec(
      'DROP TABLE social_project_reviews; DELETE FROM social_schema_migrations WHERE version = 15;',
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
