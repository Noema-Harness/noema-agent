import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type {
  NoemaAgentMemory,
  NoemaAgentMemoryAuditEntry,
  NoemaMemoryKind,
  NoemaMemorySourceKind,
  NoemaMemoryStatus,
  NoemaMemoryTrust,
} from '../../shared/contracts/noema-bridge.d.ts';
import { isoNow, requireText } from './records.ts';
import { buildMemorySearchExpression } from './personal-memory-store.ts';

const MAX_CONTENT_LENGTH = 2_000;
const MAX_AGENT_ID_LENGTH = 200;
const MAX_SOURCE_REF_LENGTH = 200;
const MAX_REASON_LENGTH = 500;
const MAX_SEARCH_RESULTS = 5;
const MAX_SEARCH_CHARACTERS = 4_000;

/** Kinds that may take effect without an explicit confirmation. */
const IMMEDIATE_KINDS: ReadonlySet<NoemaMemoryKind> = new Set([
  'preference',
  'episode',
]);
const KINDS: ReadonlySet<string> = new Set([
  'fact',
  'preference',
  'episode',
  'procedure',
]);
const SOURCE_KINDS: ReadonlySet<string> = new Set([
  'manual',
  'message',
  'project',
  'tool',
  'import',
]);

type MemoryRow = {
  id: string;
  scope: string;
  agent_id: string;
  kind: string;
  status: string;
  trust: string;
  content: string;
  source_kind: string;
  source_ref: string | null;
  source_room_id: string | null;
  source_message_id: string | null;
  valid_from: string;
  valid_to: string | null;
  superseded_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  source_room_title?: string | null;
  source_project_title?: string | null;
};

type CreateInput = {
  agentId: string;
  kind: NoemaMemoryKind;
  content: string;
  trust?: NoemaMemoryTrust;
  sourceKind?: NoemaMemorySourceKind;
  sourceRef?: string | null;
  sourceRoomId?: string | null;
  sourceMessageId?: string | null;
};

type SearchOptions = {
  agentId: string;
  limit?: number;
  maxCharacters?: number;
};

const SELECT_MEMORY = `
  SELECT m.id, m.scope, m.agent_id, m.kind, m.status, m.trust, m.content,
         m.source_kind, m.source_ref, m.source_room_id, m.source_message_id,
         m.valid_from, m.valid_to, m.superseded_by, m.confirmed_at,
         m.created_at, m.updated_at,
         room.title AS source_room_title,
         project.title AS source_project_title
  FROM agent_memories AS m
  LEFT JOIN social_rooms AS room ON room.id = m.source_room_id
  LEFT JOIN social_projects AS project
    ON m.source_kind = 'project' AND project.id = m.source_ref
`;

function toMemory(row: MemoryRow): NoemaAgentMemory {
  return {
    id: row.id,
    scope: 'agent',
    agentId: row.agent_id,
    kind: row.kind as NoemaMemoryKind,
    status: row.status as NoemaMemoryStatus,
    trust: row.trust as NoemaMemoryTrust,
    content: row.content,
    sourceKind: row.source_kind as NoemaMemorySourceKind,
    sourceRef: row.source_ref,
    sourceRoomId: row.source_room_id,
    sourceMessageId: row.source_message_id,
    sourceRoomTitle: row.source_room_title ?? null,
    sourceProjectTitle: row.source_project_title ?? null,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    supersededBy: row.superseded_by,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireKind(value: unknown): NoemaMemoryKind {
  const kind = requireText(value, '记忆类型', 40);
  if (!KINDS.has(kind))
    throw new Error('记忆类型必须是 fact、preference、episode 或 procedure。');
  return kind as NoemaMemoryKind;
}

function requireSourceKind(value: unknown): NoemaMemorySourceKind {
  const kind = requireText(value, '记忆来源类型', 40);
  if (!SOURCE_KINDS.has(kind))
    throw new Error(
      '记忆来源类型必须是 manual、message、project、tool 或 import。',
    );
  return kind as NoemaMemorySourceKind;
}

function optionalText(value: unknown, label: string, max: number) {
  if (value === null || value === undefined || value === '') return null;
  return requireText(value, label, max);
}

/**
 * Individual memory: append-only assertions with a status that decides
 * whether they may be retrieved.
 *
 * Retrieval only ever sees `active` rows that have not expired. Facts and
 * procedures start as `candidate` until the user confirms them, because a
 * wrong identity fact or commitment is expensive; preferences and episodes
 * take effect immediately but stay visible and revocable.
 */
export class AgentMemoryStore {
  declare db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  #requireMemory(id: unknown) {
    const memoryId = requireText(id, '记忆 ID', MAX_AGENT_ID_LENGTH);
    const row = this.db
      .prepare(`${SELECT_MEMORY} WHERE m.id = ?`)
      .get(memoryId) as MemoryRow | undefined;
    if (!row) throw new Error('找不到这条记忆。');
    return { memoryId, row };
  }

  #writeAudit(
    memoryId: string,
    event: NoemaAgentMemoryAuditEntry['event'],
    actor: NoemaMemoryTrust,
    detail: string | null,
  ) {
    this.db
      .prepare(`
        INSERT INTO agent_memory_audit
          (id, memory_id, event, actor, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        `memory-audit-${randomUUID()}`,
        memoryId,
        event,
        actor,
        detail,
        isoNow(),
      );
  }

  create({
    agentId,
    kind,
    content,
    trust = 'agent',
    sourceKind = 'manual',
    sourceRef = null,
    sourceRoomId = null,
    sourceMessageId = null,
  }: CreateInput): NoemaAgentMemory {
    const owner = requireText(agentId, '成员 ID', MAX_AGENT_ID_LENGTH);
    const memoryKind = requireKind(kind);
    const source = requireSourceKind(sourceKind);
    const text = requireText(content, '记忆内容', MAX_CONTENT_LENGTH).trim();
    if (trust !== 'agent' && trust !== 'user')
      throw new Error('记忆写入者必须是 agent 或 user。');
    const status: NoemaMemoryStatus =
      trust === 'user' || IMMEDIATE_KINDS.has(memoryKind)
        ? 'active'
        : 'candidate';
    const id = `memory-${randomUUID()}`;
    const now = isoNow();
    this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO agent_memories
            (id, scope, agent_id, kind, status, trust, content, source_kind,
             source_ref, source_room_id, source_message_id, valid_from,
             valid_to, superseded_by, confirmed_at, created_at, updated_at)
          VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
        `)
        .run(
          id,
          owner,
          memoryKind,
          status,
          trust,
          text,
          source,
          optionalText(sourceRef, '来源引用', MAX_SOURCE_REF_LENGTH),
          optionalText(sourceRoomId, '来源聊天 ID', MAX_AGENT_ID_LENGTH),
          optionalText(sourceMessageId, '来源消息 ID', MAX_AGENT_ID_LENGTH),
          now,
          status === 'active' ? now : null,
          now,
          now,
        );
      this.db
        .prepare(
          'INSERT INTO agent_memory_fts(memory_id, content) VALUES (?, ?)',
        )
        .run(id, text);
      this.#writeAudit(id, 'created', trust, null);
    })();
    return this.get(id)!;
  }

  list({
    agentId,
    status = null,
  }: {
    agentId: string;
    status?: NoemaMemoryStatus | null;
  }): NoemaAgentMemory[] {
    const owner = requireText(agentId, '成员 ID', MAX_AGENT_ID_LENGTH);
    const rows = (
      status
        ? this.db
            .prepare(
              `${SELECT_MEMORY} WHERE m.agent_id = ? AND m.status = ? ORDER BY m.updated_at DESC, m.id`,
            )
            .all(owner, status)
        : this.db
            .prepare(
              `${SELECT_MEMORY} WHERE m.agent_id = ? ORDER BY m.updated_at DESC, m.id`,
            )
            .all(owner)
    ) as MemoryRow[];
    return rows.map(toMemory);
  }

  get(id: string): NoemaAgentMemory | null {
    const row = this.db.prepare(`${SELECT_MEMORY} WHERE m.id = ?`).get(id) as
      | MemoryRow
      | undefined;
    return row ? toMemory(row) : null;
  }

  confirm(id: string): NoemaAgentMemory {
    const { memoryId, row } = this.#requireMemory(id);
    if (row.status !== 'candidate')
      throw new Error('只有待确认的记忆可以确认。');
    const now = isoNow();
    this.db.transaction(() => {
      this.db
        .prepare(`
          UPDATE agent_memories
          SET status = 'active', trust = 'user', confirmed_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(now, now, memoryId);
      this.#writeAudit(memoryId, 'confirmed', 'user', null);
    })();
    return this.get(memoryId)!;
  }

  retract({
    id,
    reason = null,
  }: {
    id: string;
    reason?: string | null;
  }): NoemaAgentMemory {
    const { memoryId, row } = this.#requireMemory(id);
    if (row.status !== 'active' && row.status !== 'candidate')
      throw new Error('这条记忆已经失效或撤销。');
    const note = optionalText(reason, '撤销依据', MAX_REASON_LENGTH);
    const now = isoNow();
    this.db.transaction(() => {
      this.db
        .prepare(`
          UPDATE agent_memories
          SET status = 'retracted', valid_to = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(now, now, memoryId);
      this.#writeAudit(memoryId, 'retracted', 'user', note);
    })();
    return this.get(memoryId)!;
  }

  /**
   * Replaces an existing memory with a corrected statement. The old row is
   * marked superseded (kept for audit) so retrieval never returns both.
   */
  supersede({
    id,
    content,
    trust = 'user',
    sourceKind = 'manual',
    sourceRef = null,
  }: {
    id: string;
    content: string;
    trust?: NoemaMemoryTrust;
    sourceKind?: NoemaMemorySourceKind;
    sourceRef?: string | null;
  }): NoemaAgentMemory {
    const { memoryId, row } = this.#requireMemory(id);
    if (row.status !== 'active')
      throw new Error('只有生效中的记忆可以被替代。');
    const text = requireText(content, '记忆内容', MAX_CONTENT_LENGTH).trim();
    const source = requireSourceKind(sourceKind);
    const replacementId = `memory-${randomUUID()}`;
    const now = isoNow();
    const status: NoemaMemoryStatus =
      trust === 'user' || row.kind === 'preference' || row.kind === 'episode'
        ? 'active'
        : 'candidate';
    this.db.transaction(() => {
      this.db
        .prepare(`
          UPDATE agent_memories
          SET status = 'superseded', valid_to = ?, superseded_by = ?,
              updated_at = ?
          WHERE id = ?
        `)
        .run(now, replacementId, now, memoryId);
      this.db
        .prepare(`
          INSERT INTO agent_memories
            (id, scope, agent_id, kind, status, trust, content, source_kind,
             source_ref, source_room_id, source_message_id, valid_from,
             valid_to, superseded_by, confirmed_at, created_at, updated_at)
          VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
        `)
        .run(
          replacementId,
          row.agent_id,
          row.kind,
          status,
          trust,
          text,
          source,
          optionalText(sourceRef, '来源引用', MAX_SOURCE_REF_LENGTH),
          row.source_room_id,
          row.source_message_id,
          now,
          status === 'active' ? now : null,
          now,
          now,
        );
      this.db
        .prepare(
          'INSERT INTO agent_memory_fts(memory_id, content) VALUES (?, ?)',
        )
        .run(replacementId, text);
      this.#writeAudit(memoryId, 'superseded', trust, replacementId);
      this.#writeAudit(replacementId, 'created', trust, null);
    })();
    return this.get(replacementId)!;
  }

  /**
   * Returns only memories that may reach the model: active, not expired and
   * owned by the requested agent. Retrieval is a page, not a dump.
   */
  search(
    query: string,
    {
      agentId,
      limit = MAX_SEARCH_RESULTS,
      maxCharacters = MAX_SEARCH_CHARACTERS,
    }: SearchOptions,
  ): NoemaAgentMemory[] {
    const owner = requireText(agentId, '成员 ID', MAX_AGENT_ID_LENGTH);
    const needle = requireText(query, '记忆检索内容', 200)
      .replace(/[\s\p{P}\p{S}]+/gu, ' ')
      .trim();
    if (Array.from(needle.replace(/\s+/gu, '')).length < 2) return [];
    const phrase = buildMemorySearchExpression(needle);
    if (!phrase) return [];
    const safeLimit = Math.max(1, Math.min(MAX_SEARCH_RESULTS, limit));
    const safeMaxCharacters = Math.max(
      100,
      Math.min(MAX_SEARCH_CHARACTERS, maxCharacters),
    );
    const rows = this.db
      .prepare(`
        SELECT m.id, m.scope, m.agent_id, m.kind, m.status, m.trust, m.content,
               m.source_kind, m.source_ref, m.source_room_id, m.source_message_id,
               m.valid_from, m.valid_to, m.superseded_by, m.confirmed_at,
               m.created_at, m.updated_at,
               room.title AS source_room_title,
               project.title AS source_project_title
        FROM agent_memory_fts AS f
        JOIN agent_memories AS m ON m.id = f.memory_id
        LEFT JOIN social_rooms AS room ON room.id = m.source_room_id
        LEFT JOIN social_projects AS project
          ON m.source_kind = 'project' AND project.id = m.source_ref
        WHERE agent_memory_fts MATCH ?
          AND m.agent_id = ?
          AND m.status = 'active'
          AND m.valid_to IS NULL
        ORDER BY bm25(agent_memory_fts), m.updated_at DESC
        LIMIT ?
      `)
      .all(phrase, owner, safeLimit) as MemoryRow[];
    const result: NoemaAgentMemory[] = [];
    let characters = 0;
    for (const row of rows) {
      if (characters + row.content.length > safeMaxCharacters) continue;
      result.push(toMemory(row));
      characters += row.content.length;
    }
    return result;
  }

  audit(memoryId: string): NoemaAgentMemoryAuditEntry[] {
    const id = requireText(memoryId, '记忆 ID', MAX_AGENT_ID_LENGTH);
    return this.db
      .prepare(`
        SELECT id, memory_id AS memoryId, event, actor, detail, created_at AS createdAt
        FROM agent_memory_audit
        WHERE memory_id = ?
        ORDER BY created_at, id
      `)
      .all(id) as NoemaAgentMemoryAuditEntry[];
  }
}

export const AGENT_MEMORY_LIMITS = Object.freeze({
  maxContentLength: MAX_CONTENT_LENGTH,
  maxSearchResults: MAX_SEARCH_RESULTS,
  maxSearchCharacters: MAX_SEARCH_CHARACTERS,
});
