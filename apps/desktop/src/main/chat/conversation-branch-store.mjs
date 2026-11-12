import { randomUUID } from 'node:crypto';
import {
  continuityBranchMessageIds,
  continuityMode,
} from './conversation-continuity.mjs';
import { isoNow } from './records.mjs';

export class ConversationBranchStore {
  constructor(db) {
    this.db = db;
  }

  continuityListBranches(roomId = 'room-noema') {
    const countAncestry = this.db.prepare(
      `WITH RECURSIVE chain(id, parent_turn_id) AS (
         SELECT id, parent_turn_id FROM conversation_turns WHERE id = ?
         UNION ALL
         SELECT t.id, t.parent_turn_id
         FROM conversation_turns t JOIN chain c ON t.id = c.parent_turn_id
       )
       SELECT COUNT(*) AS count FROM chain`,
    );
    return this.db
      .prepare(
        `SELECT
           b.id,
           b.room_id AS roomId,
           b.agent_id AS agentId,
           b.title,
           b.origin,
           b.read_only AS readOnly,
           b.parent_branch_id AS parentBranchId,
           b.forked_from_turn_id AS forkedFromTurnId,
           b.head_turn_id AS headTurnId,
           b.head_version AS headVersion,
           b.created_at AS createdAt,
           b.updated_at AS updatedAt
         FROM conversation_branches b
         WHERE b.room_id = ?
         ORDER BY b.created_at ASC, b.id ASC`,
      )
      .all(roomId)
      .map((row) => ({
        ...row,
        readOnly: Boolean(row.readOnly),
        turnCount: row.headTurnId ? countAncestry.get(row.headTurnId).count : 0,
      }));
  }

  continuityGetState(roomId = 'room-noema') {
    const branches = this.continuityListBranches(roomId);
    const active = this.db
      .prepare(
        `SELECT branch_id AS branchId, version AS activeVersion, updated_at AS updatedAt
         FROM conversation_active_branch
         WHERE room_id = ?`,
      )
      .get(roomId);
    return {
      mode: continuityMode(),
      roomId,
      activeBranchId: active?.branchId ?? null,
      activeVersion: active?.activeVersion ?? 0,
      activeBranch:
        branches.find((branch) => branch.id === active?.branchId) ?? null,
      branches,
    };
  }

  continuityCreateBranch({
    roomId = 'room-noema',
    fromTurnId = null,
    position = 'after',
    title = null,
  } = {}) {
    if (position !== 'after' && position !== 'before') {
      throw new Error('continuity_position_invalid');
    }
    const state = this.continuityGetState(roomId);
    if (!state.activeBranch) throw new Error('continuity_branch_not_found');
    const sourceTurnId = fromTurnId ?? state.activeBranch.headTurnId;
    if (!sourceTurnId) throw new Error('continuity_turn_not_found');
    const source = this.db
      .prepare(
        `SELECT
           t.id, t.branch_id AS branchId, t.status, t.ordinal,
           t.parent_turn_id AS parentTurnId,
           b.room_id AS roomId, b.title AS branchTitle, b.read_only AS readOnly,
           (SELECT content FROM social_messages m
            WHERE m.id = t.user_message_id LIMIT 1) AS userContent
         FROM conversation_turns t
         JOIN conversation_branches b ON b.id = t.branch_id
         WHERE t.id = ?`,
      )
      .get(sourceTurnId);
    if (!source || source.roomId !== roomId) {
      throw new Error('continuity_turn_not_found');
    }
    if (source.status !== 'complete' && position !== 'before') {
      throw new Error('continuity_turn_not_complete');
    }
    const now = isoNow();
    const branchId = randomUUID();
    const headTurnId =
      position === 'before' ? source.parentTurnId : sourceTurnId;
    const headVersion =
      position === 'before' ? 0 : Number(source.ordinal ?? 0) + 1;
    const branchTitle =
      String(title ?? source.userContent ?? source.branchTitle ?? '')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 60) || '新分支';
    this.db
      .prepare(
        `INSERT INTO conversation_branches (
           id, room_id, agent_id, title, origin, read_only,
           parent_branch_id, forked_from_turn_id, head_turn_id, head_version,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'fork', 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        branchId,
        roomId,
        state.activeBranch.agentId ?? null,
        branchTitle,
        source.branchId,
        sourceTurnId,
        headTurnId,
        headVersion,
        now,
        now,
      );
    return this.continuityListBranches(roomId).find(
      (branch) => branch.id === branchId,
    );
  }

  continuityCreateEditBranch({
    roomId = 'room-noema',
    messageId,
    title = null,
  } = {}) {
    const state = this.continuityGetState(roomId);
    if (!state.activeBranch) throw new Error('continuity_branch_not_found');
    if (state.activeBranch.readOnly) {
      throw new Error('continuity_branch_read_only');
    }
    const turn = this.db
      .prepare(
        `SELECT
           t.id,
           t.user_message_id AS userMessageId,
           t.assistant_message_id AS assistantMessageId
         FROM conversation_turns t
         WHERE t.user_message_id = ? OR t.assistant_message_id = ?
         LIMIT 1`,
      )
      .get(messageId, messageId);
    if (!turn) throw new Error('continuity_turn_not_found');
    const allowed = continuityBranchMessageIds(this.db, roomId);
    if (!allowed?.has(messageId)) {
      throw new Error('continuity_message_not_on_branch');
    }
    const position = turn.userMessageId === messageId ? 'before' : 'after';
    const branch = this.continuityCreateBranch({
      roomId,
      fromTurnId: turn.id,
      position,
      title,
    });
    return this.continuitySwitchBranch({
      roomId,
      branchId: branch.id,
      expectedVersion: state.activeVersion,
    });
  }

  continuitySwitchBranch({
    roomId = 'room-noema',
    branchId,
    expectedVersion = null,
  } = {}) {
    const state = this.continuityGetState(roomId);
    const branch = state.branches.find((item) => item.id === branchId);
    if (!branch) throw new Error('continuity_branch_not_found');
    if (branch.readOnly) throw new Error('continuity_branch_read_only');
    const expected =
      expectedVersion === null ? state.activeVersion : expectedVersion;
    if (!Number.isInteger(expected) || expected < 0) {
      throw new Error('continuity_version_invalid');
    }
    const now = isoNow();
    const result = this.db
      .prepare(
        `UPDATE conversation_active_branch
         SET branch_id = ?, version = version + 1, updated_at = ?
         WHERE room_id = ? AND version = ?`,
      )
      .run(branchId, now, roomId, expected);
    if (result.changes !== 1) {
      throw new Error('continuity_version_conflict');
    }
    return this.continuityGetState(roomId);
  }

  truncateActiveBranchForRewind(roomId, messageId, now) {
    if (continuityMode() !== 'on' || roomId !== 'room-noema') return;
    const active = this.db
      .prepare(
        'SELECT branch_id AS branchId FROM conversation_active_branch WHERE room_id = ?',
      )
      .get(roomId);
    if (!active?.branchId) return;
    const turn = this.db
      .prepare(
        `SELECT id, ordinal, parent_turn_id AS parentTurnId
         FROM conversation_turns
         WHERE branch_id = ? AND user_message_id = ?`,
      )
      .get(active.branchId, messageId);
    if (!turn) return;
    this.db
      .prepare(
        `DELETE FROM conversation_turns
         WHERE branch_id = ? AND ordinal >= ?`,
      )
      .run(active.branchId, turn.ordinal);
    this.db
      .prepare(
        `UPDATE conversation_branches
         SET head_turn_id = ?, head_version = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(turn.parentTurnId, Number(turn.ordinal), now, active.branchId);
    this.db
      .prepare(
        `UPDATE conversation_active_branch
         SET version = version + 1, updated_at = ?
         WHERE room_id = ?`,
      )
      .run(now, roomId);
  }
}
