import { randomUUID } from 'node:crypto';

const SCHEMA_VERSION = 1;
const MAX_CONTEXT_MESSAGES = 40;

const SEEDED_AGENTS = [
  {
    id: 'noema',
    name: 'Noema',
    kind: 'core',
    headline: '你的长期对话伙伴',
    description: '在同一处继续讨论、记录和推进你正在关心的事。',
    systemPrompt:
      '你是 Noema，用户长期使用的个人对话伙伴。先辨认用户此刻是在聊天、分享、探索、求判断还是委托行动；不要把每句话都改写成待解决的问题。用简体中文交流，表达直接、具体，不虚构个人经历或真实情绪。当前房间的对话是唯一可用的本地历史，不声称记得其他房间。',
  },
  {
    id: 'engineering-partner',
    name: '工程搭档',
    kind: 'specialist',
    headline: '软件项目与技术探索',
    description: '围绕软件构建、技术判断和迭代验证持续协作。',
    systemPrompt:
      '你是 Noema 中长期存在的工程搭档，擅长软件项目、技术方案判断与迭代验证。你不是某个单次任务的工具实例；在当前房间内与用户共同梳理问题，必要时指出工程风险和更好的路径。不要声称掌握未提供的项目事实或跨房间记忆。优先给出可理解的解释，不把技术术语堆成汇报。当前通过对话提供建议；没有连接工具时，不声称已检查或改动代码。',
  },
];

const SEEDED_ROOMS = [
  { id: 'room-noema', kind: 'direct', title: 'Noema', agentIds: ['noema'] },
  {
    id: 'room-engineering-partner',
    kind: 'direct',
    title: '工程搭档',
    agentIds: ['engineering-partner'],
  },
  {
    id: 'room-engineering-collaboration',
    kind: 'group',
    title: '工程协作',
    agentIds: ['noema', 'engineering-partner'],
  },
];

function isoNow() {
  return new Date().toISOString();
}

function requireText(value, label, maxLength = 100_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${label}不能为空，且不得超过 ${maxLength} 个字符。`);
  }
  return value.trim();
}

function hydrateMessage(row) {
  if (!row) return null;
  return {
    ...row,
    agentId: row.agentId ?? null,
  };
}

/**
 * Stores stable agent identities separately from conversation rooms.
 * @param {import('better-sqlite3').Database} db
 */
export class SocialChatStore {
  constructor(db) {
    this.db = db;
    this.db.pragma('foreign_keys = ON');
    this.migrate();
    this.seedInitialSocialModel();
    this.importLegacyRootMessages();
    this.recoverInterruptedReplies();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS social_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const current =
      this.db
        .prepare('SELECT MAX(version) AS version FROM social_schema_migrations')
        .get()?.version ?? 0;
    if (current > SCHEMA_VERSION) {
      throw new Error(
        `Social chat schema ${current} is newer than this Noema build supports.`,
      );
    }
    if (current < 1) {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE social_agents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('core', 'specialist')),
            headline TEXT NOT NULL,
            description TEXT NOT NULL,
            system_prompt TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE social_rooms (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE social_room_members (
            room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL REFERENCES social_agents(id) ON DELETE RESTRICT,
            position INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (room_id, agent_id)
          );

          CREATE TABLE social_messages (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL UNIQUE,
            room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE CASCADE,
            turn_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            agent_id TEXT REFERENCES social_agents(id) ON DELETE SET NULL,
            content TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('complete', 'streaming', 'interrupted', 'failed')),
            attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
            model TEXT,
            runtime TEXT NOT NULL CHECK (runtime IN ('freellmapi', 'local', 'system')),
            error_code TEXT,
            error_message TEXT,
            legacy_source_id TEXT UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE INDEX social_messages_room_order
            ON social_messages(room_id, seq);
          CREATE INDEX social_messages_turn_attempt
            ON social_messages(turn_id, attempt, role);

          INSERT INTO social_schema_migrations (version, applied_at)
          VALUES (1, '${isoNow()}');
        `);
      })();
    }
  }

  seedInitialSocialModel() {
    const now = isoNow();
    const seed = this.db.transaction(() => {
      const insertAgent = this.db.prepare(`
        INSERT OR IGNORE INTO social_agents
          (id, name, kind, headline, description, system_prompt, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const agent of SEEDED_AGENTS) {
        insertAgent.run(
          agent.id,
          agent.name,
          agent.kind,
          agent.headline,
          agent.description,
          agent.systemPrompt,
          now,
          now,
        );
      }

      const insertRoom = this.db.prepare(`
        INSERT OR IGNORE INTO social_rooms (id, kind, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertMember = this.db.prepare(`
        INSERT OR IGNORE INTO social_room_members (room_id, agent_id, position)
        VALUES (?, ?, ?)
      `);
      for (const room of SEEDED_ROOMS) {
        insertRoom.run(room.id, room.kind, room.title, now, now);
        room.agentIds.forEach((agentId, position) =>
          insertMember.run(room.id, agentId, position),
        );
      }

      const createSystemMessage = this.db.prepare(`
        INSERT INTO social_messages
          (id, room_id, turn_id, role, content, status, runtime, created_at, updated_at)
        SELECT ?, ?, ?, 'system', ?, 'complete', 'system', ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM social_messages WHERE room_id = ?)
      `);
      createSystemMessage.run(
        randomUUID(),
        'room-engineering-partner',
        randomUUID(),
        '工程搭档已加入联系人。这里会持续保留你们的私聊；与 Noema 协作时，可以在「工程协作」群里继续。',
        now,
        now,
        'room-engineering-partner',
      );
      createSystemMessage.run(
        randomUUID(),
        'room-engineering-collaboration',
        randomUUID(),
        '你、Noema 和工程搭档在这个群里协作。每条消息都可以选择由谁回应。',
        now,
        now,
        'room-engineering-collaboration',
      );
    });
    seed();
  }

  importLegacyRootMessages() {
    const legacy = this.db
      .prepare(`
        SELECT m.id, m.turn_id AS turnId, m.role, m.content, m.status,
               m.attempt, m.model, m.created_at AS createdAt, m.updated_at AS updatedAt
        FROM root_messages AS m
        WHERE NOT EXISTS (
          SELECT 1 FROM social_messages WHERE legacy_source_id = m.id
        )
        ORDER BY m.seq ASC
      `)
      .all();
    if (legacy.length === 0) return 0;

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO social_messages
        (id, room_id, turn_id, role, agent_id, content, status, attempt,
         model, runtime, legacy_source_id, created_at, updated_at)
      VALUES (?, 'room-noema', ?, ?, ?, ?, ?, ?, ?, 'freellmapi', ?, ?, ?)
    `);
    const transaction = this.db.transaction((messages) => {
      for (const message of messages) {
        insert.run(
          `legacy-${message.id}`,
          message.turnId,
          message.role,
          message.role === 'assistant' ? 'noema' : null,
          message.content,
          ['complete', 'streaming', 'interrupted', 'failed'].includes(
            message.status,
          )
            ? message.status
            : 'complete',
          message.attempt,
          message.model,
          message.id,
          message.createdAt,
          message.updatedAt,
        );
      }
      this.db
        .prepare('UPDATE social_rooms SET updated_at = ? WHERE id = ?')
        .run(isoNow(), 'room-noema');
    });
    transaction(legacy);
    return legacy.length;
  }

  recoverInterruptedReplies() {
    const now = isoNow();
    return this.db
      .prepare(`
        UPDATE social_messages
        SET status = 'interrupted',
            error_code = 'app_restarted',
            error_message = '应用在回复完成前关闭；已有内容已保留，可重试。',
            updated_at = ?
        WHERE status = 'streaming'
      `)
      .run(now).changes;
  }

  listAgents() {
    return this.db
      .prepare(`
        SELECT id, name, kind, headline, description,
               created_at AS createdAt, updated_at AS updatedAt
        FROM social_agents ORDER BY CASE kind WHEN 'core' THEN 0 ELSE 1 END, name
      `)
      .all();
  }

  listRooms() {
    return this.db
      .prepare(`
        SELECT r.id, r.kind, r.title, r.created_at AS createdAt,
               r.updated_at AS updatedAt, MAX(m.created_at) AS lastMessageAt,
               COUNT(m.id) AS messageCount,
               GROUP_CONCAT(a.id, char(31)) AS memberIds
        FROM social_rooms AS r
        LEFT JOIN social_messages AS m ON m.room_id = r.id
        LEFT JOIN social_room_members AS rm ON rm.room_id = r.id
        LEFT JOIN social_agents AS a ON a.id = rm.agent_id
        GROUP BY r.id
        ORDER BY COALESCE(MAX(m.created_at), r.updated_at) DESC, r.created_at DESC
      `)
      .all()
      .map((room) => ({
        ...room,
        messageCount: Number(room.messageCount ?? 0),
        memberIds: room.memberIds
          ? room.memberIds.split(String.fromCharCode(31))
          : [],
        preview: this.getLatestMessagePreview(room.id),
      }));
  }

  getLatestMessagePreview(roomId) {
    const row = this.db
      .prepare(`
        SELECT role, agent_id AS agentId, content, created_at AS createdAt
        FROM social_messages WHERE room_id = ?
        ORDER BY seq DESC LIMIT 1
      `)
      .get(roomId);
    if (!row) return null;
    const sender =
      row.role === 'user'
        ? '你'
        : row.role === 'system'
          ? ''
          : (this.db
              .prepare('SELECT name FROM social_agents WHERE id = ?')
              .get(row.agentId)?.name ?? '');
    return {
      text: String(row.content).replace(/\s+/gu, ' ').slice(0, 88),
      sender,
      createdAt: row.createdAt,
    };
  }

  getSnapshot() {
    return { agents: this.listAgents(), rooms: this.listRooms() };
  }

  createGroup({ title, agentIds }) {
    const normalizedTitle = requireText(title, '群聊名称', 80);
    if (
      !Array.isArray(agentIds) ||
      agentIds.length < 1 ||
      agentIds.length > 12 ||
      agentIds.some((id) => typeof id !== 'string' || !id.trim())
    ) {
      throw new TypeError('请至少选择一位联系人加入群聊。');
    }
    const uniqueAgentIds = [...new Set(agentIds)];
    for (const agentId of uniqueAgentIds) this.getAgent(agentId);

    const id = `room-${randomUUID()}`;
    const systemTurnId = randomUUID();
    const systemMessageId = randomUUID();
    const now = isoNow();
    this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO social_rooms (id, kind, title, created_at, updated_at)
          VALUES (?, 'group', ?, ?, ?)
        `)
        .run(id, normalizedTitle, now, now);
      const insertMember = this.db.prepare(`
        INSERT INTO social_room_members (room_id, agent_id, position)
        VALUES (?, ?, ?)
      `);
      uniqueAgentIds.forEach((agentId, position) =>
        insertMember.run(id, agentId, position),
      );
      this.db
        .prepare(`
          INSERT INTO social_messages
            (id, room_id, turn_id, role, content, status, runtime, created_at, updated_at)
          VALUES (?, ?, ?, 'system', ?, 'complete', 'system', ?, ?)
        `)
        .run(
          systemMessageId,
          id,
          systemTurnId,
          `群聊已创建。每条消息都可以选择由谁回应。`,
          now,
          now,
        );
    })();
    return this.getRoomSnapshot(id);
  }

  getRoomSnapshot(roomId) {
    requireText(roomId, '房间 ID', 200);
    const room = this.db
      .prepare(`
        SELECT id, kind, title, created_at AS createdAt, updated_at AS updatedAt
        FROM social_rooms WHERE id = ?
      `)
      .get(roomId);
    if (!room) throw new Error('找不到这个聊天空间。');
    const members = this.db
      .prepare(`
        SELECT a.id, a.name, a.kind, a.headline, a.description
        FROM social_room_members AS rm
        JOIN social_agents AS a ON a.id = rm.agent_id
        WHERE rm.room_id = ? ORDER BY rm.position ASC
      `)
      .all(roomId);
    const messages = this.db
      .prepare(`
        SELECT id, room_id AS roomId, turn_id AS turnId, role,
               agent_id AS agentId, content, status, attempt, model, runtime,
               error_code AS errorCode, error_message AS errorMessage,
               legacy_source_id AS legacySourceId,
               created_at AS createdAt, updated_at AS updatedAt
        FROM social_messages WHERE room_id = ? ORDER BY seq ASC
      `)
      .all(roomId)
      .map(hydrateMessage);
    return { room, members, messages };
  }

  getAgent(agentId) {
    requireText(agentId, '联系人 ID', 200);
    const agent = this.db
      .prepare(`
        SELECT id, name, kind, headline, description, system_prompt AS systemPrompt
        FROM social_agents WHERE id = ?
      `)
      .get(agentId);
    if (!agent) throw new Error('找不到要回复的联系人。');
    return agent;
  }

  isMember(roomId, agentId) {
    return Boolean(
      this.db
        .prepare(
          'SELECT 1 FROM social_room_members WHERE room_id = ? AND agent_id = ?',
        )
        .get(roomId, agentId),
    );
  }

  hasStreamingReply(roomId) {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM social_messages WHERE room_id = ? AND role = 'assistant' AND status = 'streaming' LIMIT 1",
        )
        .get(roomId),
    );
  }

  beginTurn({ roomId, agentId, text, model }) {
    const normalizedText = requireText(text, '消息', 100_000);
    if (!this.isMember(roomId, agentId)) {
      throw new Error('这个联系人不在当前聊天空间中。');
    }
    if (this.hasStreamingReply(roomId)) {
      throw new Error('这间聊天中还有一条回复正在生成，请先停止或等待完成。');
    }
    const turnId = randomUUID();
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const now = isoNow();
    this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO social_messages
            (id, room_id, turn_id, role, content, status, runtime, created_at, updated_at)
          VALUES (?, ?, ?, 'user', ?, 'complete', 'freellmapi', ?, ?)
        `)
        .run(userMessageId, roomId, turnId, normalizedText, now, now);
      this.db
        .prepare(`
          INSERT INTO social_messages
            (id, room_id, turn_id, role, agent_id, content, status, attempt,
             model, runtime, created_at, updated_at)
          VALUES (?, ?, ?, 'assistant', ?, '', 'streaming', 1, ?, 'freellmapi', ?, ?)
        `)
        .run(assistantMessageId, roomId, turnId, agentId, model, now, now);
      this.db
        .prepare('UPDATE social_rooms SET updated_at = ? WHERE id = ?')
        .run(now, roomId);
    })();
    return {
      turnId,
      userMessageId,
      assistantMessageId,
      roomId,
      agentId,
      model,
    };
  }

  getContext(roomId, { beforeMessageId = null } = {}) {
    const rows = this.db
      .prepare(`
        SELECT id, role, agent_id AS agentId, content, status
        FROM social_messages
        WHERE room_id = ? AND role IN ('user', 'assistant')
          AND status = 'complete'
          AND (? IS NULL OR seq < (SELECT seq FROM social_messages WHERE id = ?))
        ORDER BY seq DESC LIMIT ?
      `)
      .all(roomId, beforeMessageId, beforeMessageId, MAX_CONTEXT_MESSAGES)
      .reverse();
    return rows.map((row) => ({
      role: row.role === 'assistant' ? 'assistant' : 'user',
      content:
        row.role === 'assistant' && row.agentId
          ? `[${this.getAgent(row.agentId).name}] ${row.content}`
          : row.content,
    }));
  }

  appendAssistantDelta(messageId, delta) {
    if (typeof delta !== 'string' || delta.length > 100_000) {
      throw new TypeError('回复片段无效。');
    }
    if (delta.length === 0) return false;
    const now = isoNow();
    const result = this.db
      .prepare(`
        UPDATE social_messages SET content = content || ?, updated_at = ?
        WHERE id = ? AND status = 'streaming'
      `)
      .run(delta, now, messageId);
    return result.changes > 0;
  }

  completeReply(messageId) {
    const now = isoNow();
    return (
      this.db
        .prepare(`
        UPDATE social_messages SET status = 'complete', updated_at = ?,
          error_code = NULL, error_message = NULL
        WHERE id = ? AND status = 'streaming'
      `)
        .run(now, messageId).changes > 0
    );
  }

  interruptReply(messageId) {
    const now = isoNow();
    return (
      this.db
        .prepare(`
        UPDATE social_messages SET status = 'interrupted',
          error_code = 'interrupted', error_message = '已停止生成；已有内容已保留。',
          updated_at = ?
        WHERE id = ? AND status = 'streaming'
      `)
        .run(now, messageId).changes > 0
    );
  }

  failReply(messageId, code, message) {
    const now = isoNow();
    return (
      this.db
        .prepare(`
        UPDATE social_messages SET status = 'failed', error_code = ?,
          error_message = ?, updated_at = ?
        WHERE id = ? AND status = 'streaming'
      `)
        .run(
          String(code).slice(0, 100),
          String(message).slice(0, 2_000),
          now,
          messageId,
        ).changes > 0
    );
  }

  retryReply(messageId, model) {
    const row = this.db
      .prepare(`
        SELECT id, room_id AS roomId, turn_id AS turnId, agent_id AS agentId,
               attempt, status
        FROM social_messages WHERE id = ? AND role = 'assistant'
      `)
      .get(messageId);
    if (!row) throw new Error('找不到要重试的回复。');
    if (!['failed', 'interrupted'].includes(row.status)) {
      throw new Error('只有失败或已停止的回复可以重试。');
    }
    if (this.hasStreamingReply(row.roomId)) {
      throw new Error('这间聊天中已有回复正在生成。');
    }
    const now = isoNow();
    this.db
      .prepare(`
        UPDATE social_messages SET content = '', status = 'streaming',
          attempt = attempt + 1, model = ?, error_code = NULL,
          error_message = NULL, updated_at = ? WHERE id = ?
      `)
      .run(model, now, messageId);
    return { ...row, attempt: row.attempt + 1, model };
  }
}
