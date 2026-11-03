import { randomUUID } from 'node:crypto';
import { isoNow, requireText } from './records.mjs';

const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 500;
const MAX_PENDING = 30;
const MIN_DELAY_MS = 60_000;
const MAX_DELAY_MS = 365 * 24 * 60 * 60 * 1_000;
const DELIVERY_LEASE_MS = 60_000;

function boundedText(value, label, maxLength) {
  return requireText(value, label, maxLength).trim();
}

function normalizeDueAt(value, now = Date.now()) {
  if (
    typeof value !== 'string' ||
    !/(?:Z|[+-]\d{2}:\d{2})$/iu.test(value.trim())
  )
    throw new Error('回访时间必须包含明确时区。');
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('回访时间无效。');
  if (time < now + MIN_DELAY_MS || time > now + MAX_DELAY_MS)
    throw new Error('回访时间需在 1 分钟至 365 天内。');
  return new Date(time).toISOString();
}

/** Durable, user-owned one-shot reminders. No model or network work occurs here. */
export class UserFollowupStore {
  constructor(db, { now = Date.now } = {}) {
    this.db = db;
    this.now = now;
  }

  isEnabled() {
    const row = this.db
      .prepare(
        "SELECT value FROM app_settings WHERE key = 'user_followups_enabled'",
      )
      .get();
    return row?.value !== 'false';
  }

  setEnabled(enabled) {
    if (typeof enabled !== 'boolean')
      throw new TypeError('回访开关必须是布尔值。');
    this.db
      .prepare(`
        INSERT INTO app_settings(key, value, updated_at)
        VALUES ('user_followups_enabled', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value,
          updated_at = excluded.updated_at
      `)
      .run(String(enabled), isoNow());
    return this.isEnabled();
  }

  list({ limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 100));
    const items = this.db
      .prepare(`
        SELECT f.id, f.title, f.body, f.due_at AS dueAt, f.status,
               f.source_room_id AS sourceRoomId,
               f.source_message_id AS sourceMessageId,
               f.delivery_lease_until AS deliveryLeaseUntil,
               f.delivered_at AS deliveredAt, f.last_error AS lastError,
               f.created_at AS createdAt, f.updated_at AS updatedAt,
               room.title AS sourceRoomTitle,
               source.created_at AS sourceMessageCreatedAt
        FROM social_user_followups AS f
        LEFT JOIN social_rooms AS room ON room.id = f.source_room_id
        LEFT JOIN social_messages AS source ON source.id = f.source_message_id
        ORDER BY CASE f.status WHEN 'pending' THEN 0 WHEN 'delivering' THEN 1
          WHEN 'delivered' THEN 2 ELSE 3 END, f.due_at, f.id
        LIMIT ?
      `)
      .all(safeLimit);
    return { enabled: this.isEnabled(), items };
  }

  #validateSource(sourceRoomId, sourceMessageId) {
    if (!sourceRoomId && !sourceMessageId)
      return { roomId: null, messageId: null };
    const roomId = boundedText(sourceRoomId, '来源聊天 ID', 200);
    const messageId = boundedText(sourceMessageId, '来源消息 ID', 200);
    const source = this.db
      .prepare(`
        WITH RECURSIVE noema_rooms(id) AS (
          SELECT id FROM social_rooms WHERE id = 'room-noema' AND kind = 'direct'
          UNION ALL
          SELECT child.id FROM social_rooms AS child
          JOIN noema_rooms AS parent ON child.parent_room_id = parent.id
        )
        SELECT m.id FROM social_messages AS m
        JOIN noema_rooms AS room ON room.id = m.room_id
        WHERE m.id = ? AND m.room_id = ? AND m.role = 'user'
          AND m.sender_agent_id IS NULL AND m.status = 'complete'
      `)
      .get(messageId, roomId);
    if (!source)
      throw new Error('回访来源必须是 Noema 主聊中的已完成用户消息。');
    return { roomId, messageId };
  }

  add({ title, body, dueAt, sourceRoomId = null, sourceMessageId = null }) {
    const normalizedTitle = boundedText(title, '回访标题', MAX_TITLE_LENGTH);
    const normalizedBody = boundedText(body, '回访内容', MAX_BODY_LENGTH);
    const due = normalizeDueAt(dueAt, this.now());
    const source = this.#validateSource(sourceRoomId, sourceMessageId);
    const id = `followup-${randomUUID()}`;
    const now = isoNow();
    this.db.transaction(() => {
      const pending = this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM social_user_followups WHERE status IN ('pending', 'delivering')",
        )
        .get().count;
      if (pending >= MAX_PENDING)
        throw new Error(`最多同时保留 ${MAX_PENDING} 条待处理回访。`);
      this.db
        .prepare(`
          INSERT INTO social_user_followups
            (id, title, body, due_at, status, source_room_id, source_message_id,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
        `)
        .run(
          id,
          normalizedTitle,
          normalizedBody,
          due,
          source.roomId,
          source.messageId,
          now,
          now,
        );
    })();
    return this.get(id);
  }

  update({ id, title, body, dueAt }) {
    const followupId = boundedText(id, '回访 ID', 200);
    const normalizedTitle = boundedText(title, '回访标题', MAX_TITLE_LENGTH);
    const normalizedBody = boundedText(body, '回访内容', MAX_BODY_LENGTH);
    const due = normalizeDueAt(dueAt, this.now());
    const result = this.db
      .prepare(`
        UPDATE social_user_followups SET title = ?, body = ?, due_at = ?,
          last_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `)
      .run(normalizedTitle, normalizedBody, due, isoNow(), followupId);
    if (result.changes !== 1) throw new Error('只能修改仍在待处理状态的回访。');
    return this.get(followupId);
  }

  cancel(id) {
    const followupId = boundedText(id, '回访 ID', 200);
    const result = this.db
      .prepare(`
        UPDATE social_user_followups SET status = 'canceled',
          delivery_lease_until = NULL, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `)
      .run(isoNow(), followupId);
    return result.changes === 1;
  }

  claimDue({ now = this.now(), limit = 30 } = {}) {
    if (!this.isEnabled()) return [];
    const nowIso = new Date(now).toISOString();
    const leaseUntil = new Date(now + DELIVERY_LEASE_MS).toISOString();
    return this.db.transaction(() => {
      const rows = this.db
        .prepare(`
          SELECT id FROM social_user_followups
          WHERE due_at <= ? AND (status = 'pending' OR
            (status = 'delivering' AND delivery_lease_until <= ?))
          ORDER BY due_at, id LIMIT ?
        `)
        .all(nowIso, nowIso, Math.max(1, Math.min(MAX_PENDING, limit)));
      const claim = this.db.prepare(`
        UPDATE social_user_followups SET status = 'delivering',
          delivery_lease_until = ?, updated_at = ?
        WHERE id = ? AND (status = 'pending' OR
          (status = 'delivering' AND delivery_lease_until <= ?))
      `);
      const claimed = [];
      for (const row of rows) {
        if (claim.run(leaseUntil, nowIso, row.id, nowIso).changes === 1)
          claimed.push(this.get(row.id));
      }
      return claimed;
    })();
  }

  markDelivered(id) {
    const now = isoNow();
    return (
      this.db
        .prepare(`
        UPDATE social_user_followups SET status = 'delivered',
          delivered_at = ?, delivery_lease_until = NULL, last_error = NULL,
          updated_at = ?
        WHERE id = ? AND status = 'delivering'
      `)
        .run(now, now, id).changes === 1
    );
  }

  release(id, error) {
    const message =
      typeof error === 'string' && error.trim()
        ? error.trim().slice(0, 300)
        : '桌面通知暂时无法显示。';
    return (
      this.db
        .prepare(`
        UPDATE social_user_followups SET status = 'pending',
          delivery_lease_until = NULL, last_error = ?, updated_at = ?
        WHERE id = ? AND status = 'delivering'
      `)
        .run(message, isoNow(), id).changes === 1
    );
  }

  get(id) {
    return (
      this.db
        .prepare(`
        SELECT f.id, f.title, f.body, f.due_at AS dueAt, f.status,
               f.source_room_id AS sourceRoomId,
               f.source_message_id AS sourceMessageId,
               f.delivery_lease_until AS deliveryLeaseUntil,
               f.delivered_at AS deliveredAt, f.last_error AS lastError,
               f.created_at AS createdAt, f.updated_at AS updatedAt,
               room.title AS sourceRoomTitle,
               source.created_at AS sourceMessageCreatedAt
        FROM social_user_followups AS f
        LEFT JOIN social_rooms AS room ON room.id = f.source_room_id
        LEFT JOIN social_messages AS source ON source.id = f.source_message_id
        WHERE f.id = ?
      `)
        .get(id) ?? null
    );
  }
}

export const USER_FOLLOWUP_LIMITS = Object.freeze({
  maxTitleLength: MAX_TITLE_LENGTH,
  maxBodyLength: MAX_BODY_LENGTH,
  maxPending: MAX_PENDING,
  minDelayMs: MIN_DELAY_MS,
  maxDelayMs: MAX_DELAY_MS,
});
