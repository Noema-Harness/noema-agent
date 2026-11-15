import { searchTranscriptHistory } from '../../shared/search/transcript-search.ts';
import type { NoemaRootMessage } from '../../shared/search/transcript-search.ts';
import type { ForwardedSource } from './message-forward-store.ts';
import { hideInternalProjectReportSql, requireText } from './records.ts';

type NoemaHistoryRow = {
  id: string;
  turnId: string;
  role: NoemaRootMessage['role'];
  content: string;
  status: NoemaRootMessage['status'];
  createdAt: string;
  roomId: string;
  roomTitle: string;
};

export class MessageSearchStore {
  declare db: import('better-sqlite3').Database;

  constructor(db: import('better-sqlite3').Database) {
    this.db = db;
  }

  searchMessages(query: string, limit = 12, roomId: string | null = null) {
    const needle = requireText(query, '搜索内容', 120);
    const roomFilter =
      roomId === null ? null : requireText(roomId, '聊天 ID', 200);
    const roomPredicate = roomFilter === null ? '' : 'm.room_id = ? AND';
    const boundedLimit = Number.isInteger(limit)
      ? Math.max(1, Math.min(50, limit))
      : 12;
    const rows = this.db
      .prepare(`
        SELECT m.id, m.room_id AS roomId, m.role,
               m.agent_id AS agentId, m.sender_agent_id AS senderAgentId,
               m.content,
               m.forwarded_sources_json AS forwardedSourcesJson,
               m.created_at AS createdAt, r.title AS roomTitle,
               a.name AS agentName, sender.name AS senderAgentName
        FROM social_messages AS m
        JOIN social_rooms AS r ON r.id = m.room_id
        LEFT JOIN social_agents AS a ON a.id = m.agent_id
        LEFT JOIN social_agents AS sender ON sender.id = m.sender_agent_id
        WHERE ${roomPredicate}
          m.status = 'complete'
          AND m.role IN ('user', 'assistant')
          AND ${hideInternalProjectReportSql('m.id')}
          AND (
            instr(lower(m.content), lower(?)) > 0 OR
            EXISTS (
              SELECT 1 FROM json_each(m.forwarded_sources_json) AS source
              WHERE instr(lower(json_extract(source.value, '$.content')), lower(?)) > 0
            )
          )
        ORDER BY m.created_at DESC, m.seq DESC
        LIMIT ?
      `)
      .all(
        ...(roomFilter === null ? [] : [roomFilter]),
        needle,
        needle,
        boundedLimit,
      ) as {
      id: string;
      roomId: string;
      role: string;
      agentId: string | null;
      senderAgentId: string | null;
      content: string;
      forwardedSourcesJson: string | null;
      createdAt: string;
      roomTitle: string;
      agentName: string | null;
      senderAgentName: string | null;
    }[];
    return rows.map((row) => {
      const forwardedSources: ForwardedSource[] = JSON.parse(
        row.forwardedSourcesJson ?? '[]',
      );
      const matchingSource = forwardedSources.find((source) =>
        source.content.toLocaleLowerCase().includes(needle.toLocaleLowerCase()),
      );
      const content = matchingSource ? matchingSource.content : row.content;
      const index = content
        .toLocaleLowerCase()
        .indexOf(needle.toLocaleLowerCase());
      const start = Math.max(0, index - 60);
      const end = Math.min(
        content.length,
        Math.max(0, index) + needle.length + 120,
      );
      return {
        id: row.id,
        roomId: row.roomId,
        roomTitle: row.roomTitle,
        role: row.role,
        sender: row.senderAgentId
          ? (row.senderAgentName ?? 'Noema')
          : row.role === 'user'
            ? '你'
            : (row.agentName ?? 'Noema'),
        content: `${start ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`,
        forwarded: Boolean(matchingSource),
        createdAt: row.createdAt,
      };
    });
  }

  searchRoomMessages(roomId: string, query: string, limit = 50) {
    return this.searchMessages(query, limit, roomId);
  }

  isNoemaHistoryRoom(roomId: string) {
    requireText(roomId, '聊天 ID', 200);
    return Boolean(
      this.db
        .prepare(`
          WITH RECURSIVE noema_rooms(id) AS (
            SELECT id FROM social_rooms WHERE id = 'room-noema' AND kind = 'direct'
            UNION ALL
            SELECT child.id FROM social_rooms AS child
            JOIN noema_rooms AS parent ON child.parent_room_id = parent.id
          )
          SELECT 1 FROM noema_rooms WHERE id = ?
        `)
        .get(roomId),
    );
  }

  searchNoemaHistory(query: string, currentTurnId: string, roomId: string) {
    const needle = requireText(query, '历史检索内容', 100_000);
    requireText(currentTurnId, '当前 turn ID', 200);
    if (!this.isNoemaHistoryRoom(roomId)) {
      throw new Error('历史检索只对 Noema 主私聊及其延续主题开放。');
    }
    const rows = this.db
      .prepare(`
        WITH RECURSIVE noema_rooms(id) AS (
          SELECT id FROM social_rooms WHERE id = 'room-noema' AND kind = 'direct'
          UNION ALL
          SELECT child.id FROM social_rooms AS child
          JOIN noema_rooms AS parent ON child.parent_room_id = parent.id
        )
        SELECT m.id, m.turn_id AS turnId, m.role, m.content,
               m.status, m.created_at AS createdAt, m.room_id AS roomId,
               room.title AS roomTitle
        FROM social_messages AS m
        JOIN noema_rooms AS allowed_room ON allowed_room.id = m.room_id
        JOIN social_rooms AS room ON room.id = m.room_id
        WHERE m.role IN ('user', 'assistant')
          AND m.status = 'complete'
          AND m.turn_id != ?
          AND (m.role = 'user' OR m.agent_id = 'noema')
          AND ${hideInternalProjectReportSql('m.id')}
          AND EXISTS (
            SELECT 1 FROM social_messages AS reply
            WHERE reply.turn_id = m.turn_id AND reply.role = 'assistant'
              AND reply.agent_id = 'noema' AND reply.status = 'complete'
          )
      `)
      .all(currentTurnId) as NoemaHistoryRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return searchTranscriptHistory(
      rows.map((row) => ({
        ...row,
        turnStatus: 'completed' as const,
      })),
      needle,
      { currentTurnId },
    ).map((source) => {
      const row = byId.get(source.id) as NoemaHistoryRow;
      return {
        ...source,
        roomId: row.roomId,
        roomTitle: row.roomTitle,
      };
    });
  }
}
