import { randomUUID } from 'node:crypto';
import { MAX_FORWARDED_MESSAGES, isoNow, requireText } from './records.mjs';

export class ContinuationThreadStore {
  constructor(db, { resolveForwardSources, getRoomSnapshot }) {
    this.db = db;
    this.resolveForwardSources = resolveForwardSources;
    this.getRoomSnapshot = getRoomSnapshot;
  }

  createContinuationThread({ sourceRoomId, sourceIds, title }) {
    const normalizedTitle = requireText(title, '主题名称', 80);
    requireText(sourceRoomId, '来源聊天 ID', 200);
    if (
      !Array.isArray(sourceIds) ||
      sourceIds.length === 0 ||
      sourceIds.length > MAX_FORWARDED_MESSAGES ||
      sourceIds.some((id) => typeof id !== 'string' || !id.trim())
    ) {
      throw new TypeError(`请选择 1 至 ${MAX_FORWARDED_MESSAGES} 条来源消息。`);
    }
    const sourceRoom = this.db
      .prepare(`
        SELECT r.id, r.kind, r.parent_room_id AS parentRoomId,
               GROUP_CONCAT(rm.agent_id, char(31)) AS memberIds
        FROM social_rooms AS r
        LEFT JOIN social_room_members AS rm ON rm.room_id = r.id
        WHERE r.id = ? GROUP BY r.id
      `)
      .get(sourceRoomId);
    const members = sourceRoom?.memberIds
      ? sourceRoom.memberIds.split(String.fromCharCode(31))
      : [];
    if (
      !sourceRoom ||
      sourceRoom.kind !== 'direct' ||
      sourceRoom.parentRoomId ||
      members.length !== 1 ||
      members[0] !== 'noema'
    ) {
      throw new Error('主题线程只能从 Noema 的主聊天中创建。');
    }
    const uniqueIds = [...new Set(sourceIds)];
    if (uniqueIds.length !== sourceIds.length) {
      throw new TypeError('来源消息不能重复。');
    }
    const id = `room-${randomUUID()}`;
    const messageId = randomUUID();
    const turnId = randomUUID();
    const now = isoNow();
    this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO social_rooms
            (id, kind, title, parent_room_id, origin_message_id, created_at, updated_at)
          VALUES (?, 'direct', ?, ?, ?, ?, ?)
        `)
        .run(id, normalizedTitle, sourceRoomId, uniqueIds[0], now, now);
      this.db
        .prepare(`
          INSERT INTO social_room_members (room_id, agent_id, position)
          VALUES (?, 'noema', 0)
        `)
        .run(id);
      const forwardedSources = this.resolveForwardSources({
        sourceRoomId,
        sourceIds: uniqueIds,
        targetRoomId: id,
      });
      this.db
        .prepare('UPDATE social_rooms SET origin_message_id = ? WHERE id = ?')
        .run(forwardedSources[0].id, id);
      this.db
        .prepare(`
          INSERT INTO social_messages
            (id, room_id, turn_id, role, content, status, runtime,
             forwarded_sources_json, reply_to_message_id, reply_to_json,
             created_at, updated_at)
          VALUES (?, ?, ?, 'user', '', 'complete', 'local', ?, NULL, 'null', ?, ?)
        `)
        .run(messageId, id, turnId, JSON.stringify(forwardedSources), now, now);
      this.db
        .prepare('UPDATE social_rooms SET updated_at = ? WHERE id = ?')
        .run(now, sourceRoomId);
    })();
    return this.getRoomSnapshot(id);
  }

  setContinuationThreadClosed(roomId, closed) {
    requireText(roomId, '主题聊天 ID', 200);
    if (typeof closed !== 'boolean') {
      throw new TypeError('主题状态必须明确选择。');
    }
    const room = this.db
      .prepare(`
        SELECT parent_room_id AS parentRoomId, closed_at AS closedAt
        FROM social_rooms WHERE id = ?
      `)
      .get(roomId);
    if (!room) throw new Error('找不到这个聊天空间。');
    if (!room.parentRoomId) throw new Error('只有主题线程可以关闭或重新打开。');
    const hasActiveWork = this.db
      .prepare(`
        SELECT 1 FROM social_work_tasks
        WHERE room_id = ? AND status IN ('starting', 'running', 'verifying')
        LIMIT 1
      `)
      .get(roomId);
    if (closed && hasActiveWork) {
      throw new Error('主题中仍有工作正在运行；先停止或等待它结束。');
    }
    if (Boolean(room.closedAt) === closed) return this.getRoomSnapshot(roomId);
    const now = isoNow();
    this.db
      .prepare(`
        UPDATE social_rooms SET closed_at = ?, updated_at = ? WHERE id = ?
      `)
      .run(closed ? now : null, now, roomId);
    return this.getRoomSnapshot(roomId);
  }

  deleteContinuationThread(roomId) {
    requireText(roomId, '主题聊天 ID', 200);
    const room = this.db
      .prepare(
        'SELECT parent_room_id AS parentRoomId FROM social_rooms WHERE id = ?',
      )
      .get(roomId);
    if (!room) throw new Error('找不到这个聊天空间。');
    if (!room.parentRoomId) throw new Error('只能删除主题聊天。');
    const hasActiveWork = this.db
      .prepare(
        `SELECT 1 FROM social_work_tasks WHERE room_id = ? AND status IN ('starting', 'running', 'verifying') LIMIT 1`,
      )
      .get(roomId);
    if (hasActiveWork)
      throw new Error('主题中仍有工作正在运行；先停止或等待它结束。');
    this.db.prepare('DELETE FROM social_rooms WHERE id = ?').run(roomId);
    return { parentRoomId: room.parentRoomId };
  }
}
