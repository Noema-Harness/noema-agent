import { randomUUID } from 'node:crypto';
import type {
  NoemaPersonalMemory,
  NoemaPersonalMemoryList,
} from '../../shared/contracts/noema-bridge.d.ts';
import { isoNow, requireText } from './records.ts';

type PersonalMemorySearchRow = Omit<
  NoemaPersonalMemory,
  'createdAt' | 'sourceMessageStatus'
>;

type PersonalMemoryInput = {
  content: string;
  sourceRoomId?: string | null;
  sourceMessageId?: string | null;
};

const MAX_MEMORY_LENGTH = 2_000;
const MAX_SEARCH_RESULTS = 5;
const MAX_SEARCH_CHARACTERS = 4_000;
const MAX_QUERY_GRAMS = 40;
const ASCII_TOKEN = /^[\x00-\x7f]+$/u;

function normalizeContent(value: unknown) {
  const content = requireText(value, '个人记忆', MAX_MEMORY_LENGTH);
  return content.trim();
}

/**
 * Builds an FTS5 MATCH expression for a user query.
 *
 * The trigram tokenizer cannot match a whole Chinese clause as one phrase:
 * a 20-character sentence only matches a memory that contains it verbatim,
 * which measured Recall@5 = 25% on a Chinese corpus. Expanding each CJK run
 * into its overlapping 3-grams and OR-joining them raises it to 76.7% because
 * bm25 still ranks memories that share more grams first. Latin tokens keep
 * phrase precision, since their words are already separated.
 */
export function buildMemorySearchExpression(query: string) {
  const tokens = query
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const terms: string[] = [];
  for (const token of tokens) {
    const characters = Array.from(token);
    if (characters.length < 3) continue;
    if (ASCII_TOKEN.test(token)) {
      terms.push(`"${token.replace(/"/gu, '""')}"`);
      continue;
    }
    for (let index = 0; index + 3 <= characters.length; index += 1) {
      const gram = characters.slice(index, index + 3).join('');
      if (terms.includes(`"${gram}"`)) continue;
      terms.push(`"${gram}"`);
    }
  }
  return terms.slice(0, MAX_QUERY_GRAMS).join(' OR ');
}

export class PersonalMemoryStore {
  declare db: import('better-sqlite3').Database;

  constructor(db: import('better-sqlite3').Database) {
    this.db = db;
  }

  isEnabled() {
    const row = this.db
      .prepare(
        "SELECT value FROM app_settings WHERE key = 'personal_memory_enabled'",
      )
      .get() as { value: string } | undefined;
    return row?.value !== 'false';
  }

  setEnabled(enabled: boolean) {
    if (typeof enabled !== 'boolean')
      throw new TypeError('个人记忆开关必须是布尔值。');
    this.db
      .prepare(`
        INSERT INTO app_settings(key, value, updated_at)
        VALUES ('personal_memory_enabled', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value,
          updated_at = excluded.updated_at
      `)
      .run(String(enabled), isoNow());
    return this.isEnabled();
  }

  list(): NoemaPersonalMemoryList {
    const items = this.db
      .prepare(`
        SELECT m.id, m.content, m.source_kind AS sourceKind,
               m.source_room_id AS sourceRoomId,
               m.source_message_id AS sourceMessageId,
               m.created_at AS createdAt, m.updated_at AS updatedAt,
               room.title AS sourceRoomTitle,
               source.created_at AS sourceMessageCreatedAt,
               source.status AS sourceMessageStatus
        FROM social_user_memories AS m
        LEFT JOIN social_rooms AS room ON room.id = m.source_room_id
        LEFT JOIN social_messages AS source ON source.id = m.source_message_id
        ORDER BY m.updated_at DESC, m.id
      `)
      .all() as NoemaPersonalMemory[];
    return { enabled: this.isEnabled(), items };
  }

  #validateSource(
    sourceRoomId: string | null,
    sourceMessageId: string | null,
  ): Pick<
    NoemaPersonalMemory,
    'sourceKind' | 'sourceRoomId' | 'sourceMessageId'
  > {
    if (!sourceRoomId && !sourceMessageId) {
      return {
        sourceKind: 'manual',
        sourceRoomId: null,
        sourceMessageId: null,
      };
    }
    const roomId = requireText(sourceRoomId, '来源聊天 ID', 200);
    const messageId = requireText(sourceMessageId, '来源消息 ID', 200);
    const source = this.db
      .prepare(`
        WITH RECURSIVE noema_rooms(id) AS (
          SELECT id FROM social_rooms WHERE id = 'room-noema' AND kind = 'direct'
          UNION ALL
          SELECT child.id FROM social_rooms AS child
          JOIN noema_rooms AS parent ON child.parent_room_id = parent.id
        )
        SELECT m.id, m.room_id AS roomId
        FROM social_messages AS m
        JOIN noema_rooms AS room ON room.id = m.room_id
        WHERE m.id = ? AND m.room_id = ? AND m.role = 'user' AND m.status = 'complete'
      `)
      .get(messageId, roomId);
    if (!source)
      throw new Error('个人记忆来源必须是 Noema 主聊中的已完成用户消息。');
    return {
      sourceKind: 'message',
      sourceRoomId: roomId,
      sourceMessageId: messageId,
    };
  }

  add({
    content,
    sourceRoomId = null,
    sourceMessageId = null,
  }: PersonalMemoryInput) {
    const normalized = normalizeContent(content);
    const source = this.#validateSource(sourceRoomId, sourceMessageId);
    const id = `memory-${randomUUID()}`;
    const now = isoNow();
    this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO social_user_memories
            (id, content, source_kind, source_room_id, source_message_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          normalized,
          source.sourceKind,
          source.sourceRoomId,
          source.sourceMessageId,
          now,
          now,
        );
      this.db
        .prepare(
          'INSERT INTO social_user_memories_fts(memory_id, content) VALUES (?, ?)',
        )
        .run(id, normalized);
    })();
    return this.get(id);
  }

  update({
    id,
    content,
    sourceRoomId = null,
    sourceMessageId = null,
  }: PersonalMemoryInput & { id: string }) {
    const memoryId = requireText(id, '个人记忆 ID', 200);
    const normalized = normalizeContent(content);
    const source = this.#validateSource(sourceRoomId, sourceMessageId);
    const now = isoNow();
    return this.db.transaction(() => {
      const updated = this.db
        .prepare(`
          UPDATE social_user_memories SET content = ?, source_kind = ?,
            source_room_id = ?, source_message_id = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          normalized,
          source.sourceKind,
          source.sourceRoomId,
          source.sourceMessageId,
          now,
          memoryId,
        );
      if (updated.changes !== 1) throw new Error('找不到这条个人记忆。');
      this.db
        .prepare('DELETE FROM social_user_memories_fts WHERE memory_id = ?')
        .run(memoryId);
      this.db
        .prepare(
          'INSERT INTO social_user_memories_fts(memory_id, content) VALUES (?, ?)',
        )
        .run(memoryId, normalized);
      return this.get(memoryId);
    })();
  }

  delete(id: string) {
    const memoryId = requireText(id, '个人记忆 ID', 200);
    return this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM social_user_memories_fts WHERE memory_id = ?')
        .run(memoryId);
      return (
        this.db
          .prepare('DELETE FROM social_user_memories WHERE id = ?')
          .run(memoryId).changes === 1
      );
    })();
  }

  get(id: string) {
    return (
      (this.db
        .prepare(`
          SELECT m.id, m.content, m.source_kind AS sourceKind,
                 m.source_room_id AS sourceRoomId,
                 m.source_message_id AS sourceMessageId,
                 m.created_at AS createdAt, m.updated_at AS updatedAt,
                 room.title AS sourceRoomTitle,
                 source.created_at AS sourceMessageCreatedAt,
                 source.status AS sourceMessageStatus
          FROM social_user_memories AS m
          LEFT JOIN social_rooms AS room ON room.id = m.source_room_id
          LEFT JOIN social_messages AS source ON source.id = m.source_message_id
          WHERE m.id = ?
        `)
        .get(id) as NoemaPersonalMemory | undefined) ?? null
    );
  }

  search(
    query: string,
    {
      limit = MAX_SEARCH_RESULTS,
      maxCharacters = MAX_SEARCH_CHARACTERS,
    }: { limit?: number; maxCharacters?: number } = {},
  ): PersonalMemorySearchRow[] {
    if (!this.isEnabled()) return [];
    const needle = requireText(query, '个人记忆搜索内容', 120)
      .replace(/[\s\p{P}\p{S}]+/gu, ' ')
      .trim();
    if (Array.from(needle.replace(/\s+/gu, '')).length < 2) return [];
    const safeLimit = Math.max(1, Math.min(MAX_SEARCH_RESULTS, limit));
    const safeMaxCharacters = Math.max(
      100,
      Math.min(MAX_SEARCH_CHARACTERS, maxCharacters),
    );
    const phrase = buildMemorySearchExpression(needle);
    const rows = (
      phrase
        ? this.db
            .prepare(`
        SELECT m.id, m.content, m.source_kind AS sourceKind,
               m.source_room_id AS sourceRoomId,
               m.source_message_id AS sourceMessageId,
               m.updated_at AS updatedAt,
               room.title AS sourceRoomTitle,
               source.created_at AS sourceMessageCreatedAt
        FROM social_user_memories_fts AS f
        JOIN social_user_memories AS m ON m.id = f.memory_id
        LEFT JOIN social_rooms AS room ON room.id = m.source_room_id
        LEFT JOIN social_messages AS source ON source.id = m.source_message_id
        WHERE social_user_memories_fts MATCH ?
        ORDER BY bm25(social_user_memories_fts), m.updated_at DESC
        LIMIT ?
      `)
            .all(phrase, safeLimit)
        : this.db
            .prepare(`
        SELECT m.id, m.content, m.source_kind AS sourceKind,
               m.source_room_id AS sourceRoomId,
               m.source_message_id AS sourceMessageId,
               m.updated_at AS updatedAt,
               room.title AS sourceRoomTitle,
               source.created_at AS sourceMessageCreatedAt
        FROM social_user_memories AS m
        LEFT JOIN social_rooms AS room ON room.id = m.source_room_id
        LEFT JOIN social_messages AS source ON source.id = m.source_message_id
        WHERE ${needle
          .split(/\s+/u)
          .filter((term) => Array.from(term).length >= 2)
          .map(() => 'instr(m.content, ?) > 0')
          .join(' OR ')}
        ORDER BY m.updated_at DESC
        LIMIT ?
      `)
            .all(
              ...needle
                .split(/\s+/u)
                .filter((term) => Array.from(term).length >= 2),
              safeLimit,
            )
    ) as PersonalMemorySearchRow[];
    const result: PersonalMemorySearchRow[] = [];
    let totalCharacters = 0;
    for (const row of rows) {
      const size = row.content.length;
      if (totalCharacters + size > safeMaxCharacters) continue;
      result.push(row);
      totalCharacters += size;
    }
    return result;
  }
}

export const PERSONAL_MEMORY_LIMITS = Object.freeze({
  maxEntryLength: MAX_MEMORY_LENGTH,
  maxSearchResults: MAX_SEARCH_RESULTS,
  maxSearchCharacters: MAX_SEARCH_CHARACTERS,
});
