import { randomUUID } from 'node:crypto';
import {
  MAX_FORWARDED_MESSAGES,
  MAX_FORWARDED_CONTENT_LENGTH,
  isoNow,
  requireText,
} from './records.mjs';

export class MessageForwardStore {
  constructor(db, { assertRoomOpen }) {
    this.db = db;
    this.assertRoomOpen = assertRoomOpen;
  }

  resolveForwardSources({ sourceRoomId, sourceIds, targetRoomId }) {
    requireText(sourceRoomId, '来源聊天 ID', 200);
    requireText(targetRoomId, '目标聊天 ID', 200);
    if (sourceRoomId === targetRoomId) {
      throw new Error('转发目标必须是另一间聊天。');
    }
    if (
      !Array.isArray(sourceIds) ||
      sourceIds.length === 0 ||
      sourceIds.length > MAX_FORWARDED_MESSAGES
    ) {
      throw new TypeError(
        `请选择 1 至 ${MAX_FORWARDED_MESSAGES} 条消息进行转发。`,
      );
    }
    const uniqueIds = [...new Set(sourceIds)];
    if (uniqueIds.length !== sourceIds.length) {
      throw new TypeError('转发消息不能重复。');
    }
    const sourceRoom = this.db
      .prepare('SELECT id, title FROM social_rooms WHERE id = ?')
      .get(sourceRoomId);
    const targetRoom = this.db
      .prepare('SELECT id FROM social_rooms WHERE id = ?')
      .get(targetRoomId);
    if (!sourceRoom || !targetRoom) throw new Error('来源或目标聊天已不存在。');

    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`
        SELECT m.id, m.room_id AS roomId, m.role, m.agent_id AS agentId,
               m.sender_agent_id AS senderAgentId,
               m.content, m.status, m.created_at AS createdAt,
               a.name AS authorName, sender.name AS senderAgentName,
               m.seq AS timelineOrder,
               m.forwarded_sources_json AS forwardedSourcesJson
        FROM social_messages AS m
        LEFT JOIN social_agents AS a ON a.id = m.agent_id
        LEFT JOIN social_agents AS sender ON sender.id = m.sender_agent_id
        WHERE m.room_id = ? AND m.id IN (${placeholders})
          AND m.role IN ('user', 'assistant') AND m.status = 'complete'
        ORDER BY m.seq ASC
      `)
      .all(sourceRoomId, ...uniqueIds);
    if (rows.length !== uniqueIds.length) {
      throw new Error('所选消息已不可转发；请重新选择。');
    }
    const sources = rows.map((row) => {
      const nestedSources = JSON.parse(row.forwardedSourcesJson ?? '[]');
      const nestedContent = nestedSources
        .map(
          (source) =>
            `来自「${source.roomTitle}」· ${source.sender}\n${source.content}`,
        )
        .join('\n\n');
      return {
        id: row.id,
        roomId: row.roomId,
        roomTitle: sourceRoom.title,
        role: row.role,
        sender: row.senderAgentId
          ? (row.senderAgentName ?? 'Noema')
          : row.role === 'user'
            ? '你'
            : (row.authorName ?? '联系人'),
        createdAt: row.createdAt,
        content: row.content || nestedContent,
      };
    });
    const totalLength = sources.reduce(
      (sum, source) => sum + source.content.length,
      0,
    );
    if (totalLength > MAX_FORWARDED_CONTENT_LENGTH) {
      throw new Error('所选消息过长，请减少转发条数。');
    }
    return sources;
  }

  appendForwardedMessage({ sourceRoomId, sourceIds, targetRoomId }) {
    this.assertRoomOpen(sourceRoomId);
    this.assertRoomOpen(targetRoomId);
    const forwardedSources = this.resolveForwardSources({
      sourceRoomId,
      sourceIds,
      targetRoomId,
    });
    const messageId = randomUUID();
    const turnId = randomUUID();
    const now = isoNow();
    this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO social_messages
            (id, room_id, turn_id, role, content, status, runtime,
             forwarded_sources_json, reply_to_message_id, reply_to_json,
             created_at, updated_at)
          VALUES (?, ?, ?, 'user', '', 'complete', 'local', ?, NULL, 'null', ?, ?)
        `)
        .run(
          messageId,
          targetRoomId,
          turnId,
          JSON.stringify(forwardedSources),
          now,
          now,
        );
      this.db
        .prepare('UPDATE social_rooms SET updated_at = ? WHERE id = ?')
        .run(now, targetRoomId);
    })();
    return { messageId, roomId: targetRoomId, forwardedSources };
  }
}
