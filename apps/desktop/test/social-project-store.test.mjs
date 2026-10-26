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
        status: 'active',
        agentId: member.agentId,
        roomId: sessionRoomId,
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
        status: 'active',
        agentId: member.agentId,
        roomId: sessionRoomId,
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

test('schema v11 upgrades to v17 without deleting chats or re-enabling revoked capabilities', () => {
  const db = new Database(':memory:');
  new RootStore(db);
  const oldStore = createSocialTestStore(db);
  oldStore.setAgentProjectWork('engineering-partner', false);
  const roomBefore = oldStore.getRoomSnapshot('room-engineering-collaboration');
  try {
    db.exec(`
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
      DELETE FROM social_schema_migrations WHERE version = 12;
    `);
    const upgradedStore = new SocialChatStore(db);
    assert.equal(
      db
        .prepare('SELECT MAX(version) AS version FROM social_schema_migrations')
        .get().version,
      17,
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
