import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SocialChatStore } from '../src/social-chat-store.mjs';
import { SocialProjectStore } from '../src/social-project-store.mjs';
import { RootStore } from '../src/root-store.mjs';
import { createSocialTestStore } from '../test-support/social-team.mjs';

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

test('schema v11 upgrades without deleting existing chats or re-enabling revoked capabilities', () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const oldStore = createSocialTestStore(db);
  oldStore.setAgentProjectWork('engineering-partner', false);
  const roomBefore = oldStore.getRoomSnapshot('room-engineering-collaboration');
  try {
    db.exec(`
      DROP TABLE social_project_sessions;
      DROP TABLE social_projects;
      DELETE FROM social_schema_migrations WHERE version = 12;
    `);
    const upgradedStore = new SocialChatStore(db);
    assert.equal(
      db
        .prepare('SELECT MAX(version) AS version FROM social_schema_migrations')
        .get().version,
      12,
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
