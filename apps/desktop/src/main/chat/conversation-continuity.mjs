import { randomUUID } from 'node:crypto';

export const CONVERSATION_CONTINUITY_MARKER = 'noema:conversation-boundary';

export function continuityMode() {
  const value = process.env.NOEMA_CONTINUITY_MODE;
  return value === 'off' || value === 'shadow' || value === 'on' ? value : 'on';
}

function ensureContinuityBranch(db, roomId) {
  const existing = db
    .prepare(
      'SELECT branch_id AS branchId FROM conversation_active_branch WHERE room_id = ?',
    )
    .get(roomId);
  if (existing) return existing;
  const room = db
    .prepare('SELECT title FROM social_rooms WHERE id = ?')
    .get(roomId);
  if (!room) return null;
  const member = db
    .prepare(
      'SELECT agent_id AS agentId FROM social_room_members WHERE room_id = ? LIMIT 1',
    )
    .get(roomId);
  const now = new Date().toISOString();
  const branchId = randomUUID();
  db.prepare(`
    INSERT INTO conversation_branches (
      id, room_id, agent_id, title, origin, read_only,
      parent_branch_id, forked_from_turn_id, head_turn_id, head_version,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'main', 0, NULL, NULL, NULL, 0, ?, ?)
  `).run(
    branchId,
    roomId,
    member?.agentId ?? null,
    normalizeTitle(room.title),
    now,
    now,
  );
  db.prepare(`
    INSERT INTO conversation_active_branch (room_id, branch_id, version, updated_at)
    VALUES (?, ?, 0, ?)
  `).run(roomId, branchId, now);
  return { branchId };
}

export function beginContinuityTurn(
  db,
  { roomId, turnId, userMessageId, assistantMessageId },
) {
  if (continuityMode() === 'off' || roomId !== 'room-noema') return null;
  const active = ensureContinuityBranch(db, roomId);
  if (!active) return null;
  const branch = db
    .prepare(
      'SELECT id, head_turn_id AS headTurnId FROM conversation_branches WHERE id = ?',
    )
    .get(active.branchId);
  if (!branch) return null;
  const ordinal =
    Number(
      db
        .prepare(
          'SELECT COALESCE(MAX(ordinal), -1) AS maxOrdinal FROM conversation_turns WHERE branch_id = ?',
        )
        .get(branch.id).maxOrdinal,
    ) + 1;
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO conversation_turns (
      id, branch_id, parent_turn_id, ordinal, user_message_id,
      assistant_message_id, status, checkpoint_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
  `).run(
    id,
    branch.id,
    branch.headTurnId,
    ordinal,
    userMessageId,
    assistantMessageId,
    now,
    now,
  );
  return { id, branchId: branch.id, turnId };
}

export function commitContinuityTurn(db, assistantMessageId) {
  if (continuityMode() === 'off') return false;
  const turn = db
    .prepare(
      `SELECT id, branch_id AS branchId, parent_turn_id AS parentTurnId
       FROM conversation_turns
       WHERE assistant_message_id = ? AND status = 'pending'`,
    )
    .get(assistantMessageId);
  if (!turn) return false;
  const now = new Date().toISOString();
  return db.transaction(() => {
    const changed = db
      .prepare(
        `UPDATE conversation_turns
         SET status = 'complete', checkpoint_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(now, now, turn.id).changes;
    if (changed !== 1) return false;
    db.prepare(`
      UPDATE conversation_branches
      SET head_turn_id = ?, head_version = head_version + 1, updated_at = ?
      WHERE id = ? AND (head_turn_id IS ? OR head_turn_id = ?)
    `).run(turn.id, now, turn.branchId, turn.parentTurnId, turn.parentTurnId);
    return true;
  })();
}

export function closeContinuityTurn(db, assistantMessageId, status) {
  if (continuityMode() === 'off') return false;
  if (!['failed', 'interrupted'].includes(status)) return false;
  return (
    db
      .prepare(
        `UPDATE conversation_turns
         SET status = ?, updated_at = ?
         WHERE assistant_message_id = ? AND status = 'pending'`,
      )
      .run(status, new Date().toISOString(), assistantMessageId).changes > 0
  );
}

export function addConversationContinuitySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_branches (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES social_agents(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('main', 'fork', 'legacy')),
      read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1)),
      parent_branch_id TEXT,
      forked_from_turn_id TEXT,
      head_turn_id TEXT,
      head_version INTEGER NOT NULL DEFAULT 0 CHECK (head_version >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE INDEX IF NOT EXISTS conversation_branches_room
      ON conversation_branches(room_id, created_at, id);

    CREATE TABLE IF NOT EXISTS conversation_turns (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL REFERENCES conversation_branches(id) ON DELETE CASCADE,
      parent_turn_id TEXT,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      user_message_id TEXT NOT NULL,
      assistant_message_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'complete', 'interrupted', 'failed')),
      checkpoint_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (branch_id, ordinal)
    );

    CREATE INDEX IF NOT EXISTS conversation_turns_branch
      ON conversation_turns(branch_id, ordinal);

    CREATE TABLE IF NOT EXISTS conversation_active_branch (
      room_id TEXT PRIMARY KEY REFERENCES social_rooms(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL REFERENCES conversation_branches(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
      updated_at TEXT NOT NULL
    );
  `);
}

function normalizeTitle(value) {
  const text = String(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
  return text ? text.slice(0, 60) : '新对话';
}

function segmentMessages(messages, boundaries) {
  const boundariesBySeq = boundaries
    .map((item) => Number(item.seq))
    .filter((seq) => Number.isFinite(seq))
    .sort((a, b) => a - b);
  const segments = [];
  let startSeq = 0;
  for (const boundarySeq of boundariesBySeq) {
    const slice = messages.filter(
      (message) => message.seq > startSeq && message.seq < boundarySeq,
    );
    if (slice.length > 0) segments.push(slice);
    startSeq = boundarySeq;
  }
  const tail = messages.filter((message) => message.seq > startSeq);
  const lastBoundary = boundariesBySeq.at(-1) ?? 0;
  const hasUnstartedMain =
    boundariesBySeq.length > 0 &&
    (messages.length === 0 || messages[messages.length - 1].seq < lastBoundary);
  if (tail.length > 0 || hasUnstartedMain || segments.length === 0) {
    segments.push(tail);
  }
  return segments;
}

function groupTurns(messages) {
  const turns = [];
  for (const message of messages) {
    const key = message.turnId
      ? String(message.turnId)
      : `message:${message.id}`;
    let turn = turns.find((item) => item.key === key);
    if (!turn) {
      turn = { key, messages: [], parentId: message.turnId ?? null };
      turns.push(turn);
    }
    turn.messages.push(message);
  }
  return turns;
}

function turnStatus(messages) {
  const assistant = messages.find((message) => message.role === 'assistant');
  if (assistant?.status === 'complete') return 'complete';
  if (assistant?.status === 'failed') return 'failed';
  return 'interrupted';
}

export function backfillConversationContinuity(db) {
  const now = new Date().toISOString();
  const rooms = db
    .prepare('SELECT id, title, created_at AS createdAt FROM social_rooms')
    .all();
  const existing = db.prepare(
    'SELECT 1 FROM conversation_active_branch WHERE room_id = ?',
  );
  const insertBranch = db.prepare(`
    INSERT INTO conversation_branches (
      id, room_id, agent_id, title, origin, read_only,
      parent_branch_id, forked_from_turn_id, head_turn_id, head_version,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?)
  `);
  const updateBranch = db.prepare(`
    UPDATE conversation_branches
    SET head_turn_id = ?, head_version = ?, updated_at = ?
    WHERE id = ?
  `);
  const insertTurn = db.prepare(`
    INSERT INTO conversation_turns (
      id, branch_id, parent_turn_id, ordinal, user_message_id,
      assistant_message_id, status, checkpoint_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertActive = db.prepare(`
    INSERT INTO conversation_active_branch (room_id, branch_id, version, updated_at)
    VALUES (?, ?, 0, ?)
  `);

  for (const room of rooms) {
    if (existing.get(room.id)) continue;
    const members = db
      .prepare(
        'SELECT agent_id AS agentId FROM social_room_members WHERE room_id = ?',
      )
      .all(room.id);
    const agentId = members.length === 1 ? members[0].agentId : null;
    const boundaries = db
      .prepare(`
        SELECT seq
        FROM social_messages
        WHERE room_id = ? AND role = 'system' AND content = ?
        ORDER BY seq
      `)
      .all(room.id, CONVERSATION_CONTINUITY_MARKER);
    const messages = db
      .prepare(`
        SELECT
          seq, id, turn_id AS turnId, role, status, content,
          created_at AS createdAt
        FROM social_messages
        WHERE room_id = ? AND role IN ('user', 'assistant')
        ORDER BY seq
      `)
      .all(room.id);
    const segments = segmentMessages(messages, boundaries);

    let mainBranchId = null;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const isMain = index === segments.length - 1;
      const firstUser = segment.find((message) => message.role === 'user');
      const first = segment[0];
      const last = segment[segment.length - 1];
      const branchId = randomUUID();
      const createdAt = first?.createdAt ?? now;
      const updatedAt = last?.createdAt ?? now;
      const title = isMain
        ? normalizeTitle(firstUser?.content ?? room.title)
        : normalizeTitle(firstUser?.content ?? room.title);
      insertBranch.run(
        branchId,
        room.id,
        agentId,
        title,
        isMain ? 'main' : 'legacy',
        isMain ? 0 : 1,
        now,
        now,
      );

      let headTurnId = null;
      let headVersion = 0;
      let parentTurnId = null;
      const turns = groupTurns(segment);
      for (let ordinal = 0; ordinal < turns.length; ordinal += 1) {
        const turn = turns[ordinal];
        const user = turn.messages.find((message) => message.role === 'user');
        const assistant = [...turn.messages]
          .reverse()
          .find((message) => message.role === 'assistant');
        if (!user) continue;
        const status = turnStatus(turn.messages);
        const turnId = randomUUID();
        const checkpointAt =
          status === 'complete' && assistant?.createdAt
            ? assistant.createdAt
            : null;
        insertTurn.run(
          turnId,
          branchId,
          parentTurnId,
          ordinal,
          user.id,
          assistant?.id ?? null,
          status,
          checkpointAt,
          turn.messages[0]?.createdAt ?? createdAt,
          assistant?.createdAt ?? user.createdAt ?? updatedAt,
        );
        parentTurnId = turnId;
        if (status === 'complete') {
          headTurnId = turnId;
          headVersion += 1;
        }
      }
      updateBranch.run(headTurnId, headVersion, updatedAt, branchId);
      if (isMain) mainBranchId = branchId;
    }

    if (!mainBranchId) {
      mainBranchId = randomUUID();
      insertBranch.run(
        mainBranchId,
        room.id,
        agentId,
        normalizeTitle(room.title),
        'main',
        0,
        null,
        0,
        now,
        now,
      );
    }
    insertActive.run(room.id, mainBranchId, now);
  }
}

export function recoverContinuityTurns(db) {
  return db
    .prepare(
      "UPDATE conversation_turns SET status = 'interrupted' WHERE status = 'pending'",
    )
    .run().changes;
}

export function continuityBranchMessageIds(db, roomId) {
  if (roomId !== 'room-noema') return null;
  const active = db
    .prepare(
      'SELECT branch_id AS branchId FROM conversation_active_branch WHERE room_id = ?',
    )
    .get(roomId);
  if (!active) return null;
  const branch = db
    .prepare(
      'SELECT head_turn_id AS headTurnId FROM conversation_branches WHERE id = ?',
    )
    .get(active.branchId);
  if (!branch) return null;
  const ids = new Set();
  const visited = new Set();
  let turnId = branch.headTurnId;
  while (turnId && !visited.has(turnId)) {
    visited.add(turnId);
    const turn = db
      .prepare(
        `SELECT user_message_id AS userMessageId,
                assistant_message_id AS assistantMessageId,
                parent_turn_id AS parentTurnId
         FROM conversation_turns WHERE id = ?`,
      )
      .get(turnId);
    if (!turn) break;
    if (turn.userMessageId) ids.add(turn.userMessageId);
    if (turn.assistantMessageId) ids.add(turn.assistantMessageId);
    turnId = turn.parentTurnId;
  }
  const openTurns = db
    .prepare(
      `SELECT user_message_id AS userMessageId,
              assistant_message_id AS assistantMessageId
       FROM conversation_turns
       WHERE branch_id = ? AND status <> 'complete'`,
    )
    .all(active.branchId);
  for (const turn of openTurns) {
    if (turn.userMessageId) ids.add(turn.userMessageId);
    if (turn.assistantMessageId) ids.add(turn.assistantMessageId);
  }
  return ids;
}
