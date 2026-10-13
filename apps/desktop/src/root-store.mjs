import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const MAX_MESSAGE_LENGTH = 100_000;

function nowIso() {
  return new Date().toISOString();
}

function requireText(value, label, maxLength = MAX_MESSAGE_LENGTH) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new TypeError(
      `${label} must be a non-empty string of at most ${maxLength} characters`,
    );
  }
  return value;
}

/**
 * Owns Noema's one persistent conversation and its SQLite lifecycle.
 * @param {string | import('better-sqlite3').Database} databaseOrPath
 */
export class RootStore {
  constructor(databaseOrPath) {
    this.db =
      typeof databaseOrPath === 'string'
        ? new Database(databaseOrPath)
        : databaseOrPath;
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 3000');
    if (typeof databaseOrPath === 'string' && databaseOrPath !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
    }
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const currentVersion =
      this.db
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get()?.version ?? 0;
    if (currentVersion < 1) {
      const applyInitialSchema = this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE root_conversations (
            id TEXT PRIMARY KEY CHECK (id = 'root'),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE root_turns (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL UNIQUE,
            conversation_id TEXT NOT NULL REFERENCES root_conversations(id),
            user_message_id TEXT NOT NULL UNIQUE,
            model TEXT,
            status TEXT NOT NULL CHECK (status IN ('streaming', 'completed', 'interrupted', 'failed')),
            attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
            context_turns INTEGER NOT NULL DEFAULT 0,
            context_omitted_turns INTEGER NOT NULL DEFAULT 0,
            context_characters INTEGER NOT NULL DEFAULT 0,
            error_code TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT
          );

          CREATE TABLE root_messages (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL UNIQUE,
            turn_id TEXT NOT NULL REFERENCES root_turns(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('complete', 'streaming', 'interrupted', 'failed')),
            attempt INTEGER NOT NULL CHECK (attempt > 0),
            model TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (turn_id, role, attempt)
          );

          CREATE TABLE app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE INDEX root_messages_turn_order ON root_messages(turn_id, attempt, role);
        `);
        const now = nowIso();
        this.db
          .prepare(
            'INSERT INTO root_conversations (id, created_at, updated_at) VALUES (?, ?, ?)',
          )
          .run('root', now, now);
        this.db
          .prepare(
            'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
          )
          .run(1, now);
      });
      applyInitialSchema();
    }
    if (currentVersion > 1)
      throw new Error(
        `Database schema ${currentVersion} is newer than this Noema build supports`,
      );
  }

  /** @param {{id?: string, text: string, model?: string | null}} input */
  beginTurn({ id = randomUUID(), text, model = null }) {
    requireText(text, 'message');
    if (model !== null) requireText(model, 'model', 200);
    const timestamp = nowIso();
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const transaction = this.db.transaction(() => {
      const active = this.db
        .prepare("SELECT id FROM root_turns WHERE status = 'streaming' LIMIT 1")
        .get();
      if (active) throw new Error('A root response is already in progress');
      this.db
        .prepare(`
        INSERT INTO root_turns (id, conversation_id, user_message_id, model, status, attempt, created_at, updated_at)
        VALUES (?, 'root', ?, ?, 'streaming', 1, ?, ?)
      `)
        .run(id, userMessageId, model, timestamp, timestamp);
      this.db
        .prepare(`
        INSERT INTO root_messages (id, turn_id, role, content, status, attempt, model, created_at, updated_at)
        VALUES (?, ?, 'user', ?, 'complete', 1, ?, ?, ?)
      `)
        .run(userMessageId, id, text, model, timestamp, timestamp);
      this.db
        .prepare(`
        INSERT INTO root_messages (id, turn_id, role, content, status, attempt, model, created_at, updated_at)
        VALUES (?, ?, 'assistant', '', 'streaming', 1, ?, ?, ?)
      `)
        .run(assistantMessageId, id, model, timestamp, timestamp);
    });
    transaction();
    return { id, userMessageId, assistantMessageId, attempt: 1, model };
  }

  /** @param {string} turnId @param {string | null} model */
  retryTurn(turnId, model) {
    requireText(turnId, 'turn id', 200);
    if (model !== null) requireText(model, 'model', 200);
    const timestamp = nowIso();
    const nextAttempt = this.db.transaction(() => {
      const turn = this.db
        .prepare('SELECT * FROM root_turns WHERE id = ?')
        .get(turnId);
      if (!turn || !['interrupted', 'failed'].includes(turn.status)) {
        throw new Error('Only an interrupted or failed turn can be retried');
      }
      const active = this.db
        .prepare("SELECT id FROM root_turns WHERE status = 'streaming' LIMIT 1")
        .get();
      if (active) throw new Error('A root response is already in progress');
      const attempt = turn.attempt + 1;
      this.db
        .prepare(`
        UPDATE root_turns
        SET model = ?, status = 'streaming', attempt = ?, error_code = NULL, error_message = NULL,
            context_turns = 0, context_omitted_turns = 0, context_characters = 0,
            updated_at = ?, completed_at = NULL
        WHERE id = ?
      `)
        .run(model, attempt, timestamp, turnId);
      const assistantMessageId = randomUUID();
      this.db
        .prepare(`
        INSERT INTO root_messages (id, turn_id, role, content, status, attempt, model, created_at, updated_at)
        VALUES (?, ?, 'assistant', '', 'streaming', ?, ?, ?, ?)
      `)
        .run(assistantMessageId, turnId, attempt, model, timestamp, timestamp);
      return {
        id: turnId,
        userMessageId: turn.user_message_id,
        assistantMessageId,
        attempt,
        model,
      };
    });
    return nextAttempt();
  }

  /** @param {{id: string, attempt: number, content: string}} input */
  appendAssistant({ id, attempt, content }) {
    if (!content) return;
    const timestamp = nowIso();
    const result = this.db
      .prepare(`
      UPDATE root_messages
      SET content = content || ?, updated_at = ?
      WHERE turn_id = ? AND role = 'assistant' AND attempt = ? AND status = 'streaming'
    `)
      .run(content, timestamp, id, attempt);
    if (result.changes !== 1)
      throw new Error('The assistant response is no longer active');
    this.db
      .prepare(
        'UPDATE root_turns SET updated_at = ? WHERE id = ? AND attempt = ? AND status = ?',
      )
      .run(timestamp, id, attempt, 'streaming');
  }

  /** @param {string} id @param {number} attempt */
  completeTurn(id, attempt) {
    const timestamp = nowIso();
    const transaction = this.db.transaction(() => {
      const message = this.db
        .prepare(`
        UPDATE root_messages SET status = 'complete', updated_at = ?
        WHERE turn_id = ? AND role = 'assistant' AND attempt = ? AND status = 'streaming'
      `)
        .run(timestamp, id, attempt);
      const turn = this.db
        .prepare(`
        UPDATE root_turns SET status = 'completed', updated_at = ?, completed_at = ?, error_code = NULL, error_message = NULL
        WHERE id = ? AND attempt = ? AND status = 'streaming'
      `)
        .run(timestamp, timestamp, id, attempt);
      if (message.changes !== 1 || turn.changes !== 1)
        throw new Error('The root turn is no longer active');
      this.db
        .prepare('UPDATE root_conversations SET updated_at = ? WHERE id = ?')
        .run(timestamp, 'root');
    });
    transaction();
  }

  /** @param {string} id @param {number} attempt */
  interruptTurn(id, attempt) {
    this.finishWithStatus(id, attempt, 'interrupted', null, null);
  }

  /** @param {string} id @param {number} attempt @param {string} errorCode @param {string} errorMessage */
  failTurn(id, attempt, errorCode, errorMessage) {
    this.finishWithStatus(id, attempt, 'failed', errorCode, errorMessage);
  }

  /** @param {string} id @param {number} attempt @param {'interrupted'|'failed'} status @param {string | null} errorCode @param {string | null} errorMessage */
  finishWithStatus(id, attempt, status, errorCode, errorMessage) {
    const timestamp = nowIso();
    const transaction = this.db.transaction(() => {
      const message = this.db
        .prepare(`
        UPDATE root_messages SET status = ?, updated_at = ?
        WHERE turn_id = ? AND role = 'assistant' AND attempt = ? AND status = 'streaming'
      `)
        .run(status, timestamp, id, attempt);
      const turn = this.db
        .prepare(`
        UPDATE root_turns SET status = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE id = ? AND attempt = ? AND status = 'streaming'
      `)
        .run(status, errorCode, errorMessage, timestamp, id, attempt);
      if (message.changes !== 1 || turn.changes !== 1) return;
      this.db
        .prepare('UPDATE root_conversations SET updated_at = ? WHERE id = ?')
        .run(timestamp, 'root');
    });
    transaction();
  }

  recoverActiveTurns() {
    const active = this.db
      .prepare("SELECT id, attempt FROM root_turns WHERE status = 'streaming'")
      .all();
    for (const turn of active) this.interruptTurn(turn.id, turn.attempt);
    return active.length;
  }

  getSnapshot() {
    const messages = this.db
      .prepare(`
      SELECT m.id, m.turn_id AS turnId, m.role, m.content, m.status,
             m.attempt, m.model, m.created_at AS createdAt, m.updated_at AS updatedAt,
             t.status AS turnStatus, t.attempt AS currentAttempt,
             t.context_turns AS contextTurns, t.context_omitted_turns AS contextOmittedTurns,
             t.context_characters AS contextCharacters,
             t.error_code AS errorCode, t.error_message AS errorMessage
      FROM root_messages AS m
      JOIN root_turns AS t ON t.id = m.turn_id
      ORDER BY m.seq ASC
    `)
      .all();
    const active = this.db
      .prepare("SELECT id FROM root_turns WHERE status = 'streaming' LIMIT 1")
      .get();
    return {
      messages,
      activeTurnId: active?.id ?? null,
      selectedModel: this.getSelectedModel(),
    };
  }

  /** @param {string} turnId */
  getPromptMessages(turnId) {
    return this.getPromptContext(turnId).messages;
  }

  /**
   * Returns a bounded recent context. The complete transcript remains stored locally.
   * @param {string} turnId
   * @param {{maxTurns?: number, maxCharacters?: number}} [limits]
   */
  getPromptContext(turnId, { maxTurns = 8, maxCharacters = 12_000 } = {}) {
    const current = this.db
      .prepare('SELECT seq FROM root_turns WHERE id = ?')
      .get(turnId);
    if (!current) throw new Error('Root turn not found');
    const previousTurns = this.db
      .prepare(`
      SELECT t.id, u.content AS userContent, a.content AS assistantContent
      FROM root_turns AS t
      JOIN root_messages AS u ON u.turn_id = t.id AND u.role = 'user' AND u.attempt = 1
      JOIN root_messages AS a ON a.turn_id = t.id AND a.role = 'assistant' AND a.attempt = t.attempt AND a.status = 'complete'
      WHERE t.seq < ? AND t.status = 'completed'
      ORDER BY t.seq DESC
    `)
      .all(current.seq);
    const currentUser = this.db
      .prepare(`
      SELECT role, content FROM root_messages
      WHERE turn_id = ? AND role = 'user' AND attempt = 1
    `)
      .get(turnId);
    if (!currentUser) throw new Error('Root user message not found');
    const selected = [];
    let historyCharacters = 0;
    for (const turn of previousTurns) {
      const characters = turn.userContent.length + turn.assistantContent.length;
      if (
        selected.length >= maxTurns ||
        historyCharacters + characters > maxCharacters
      )
        break;
      selected.push(turn);
      historyCharacters += characters;
    }
    const messages = selected.reverse().flatMap((turn) => [
      { role: 'user', content: turn.userContent },
      { role: 'assistant', content: turn.assistantContent },
    ]);
    messages.push(currentUser);
    return {
      messages,
      includedTurns: selected.length,
      totalPreviousTurns: previousTurns.length,
      omittedTurns: previousTurns.length - selected.length,
      historyCharacters,
    };
  }

  /** @param {string} id @param {number} attempt @param {{includedTurns:number, omittedTurns:number, historyCharacters:number}} context */
  setTurnContext(id, attempt, context) {
    const timestamp = nowIso();
    const result = this.db
      .prepare(`
      UPDATE root_turns
      SET context_turns = ?, context_omitted_turns = ?, context_characters = ?, updated_at = ?
      WHERE id = ? AND attempt = ? AND status = 'streaming'
    `)
      .run(
        context.includedTurns,
        context.omittedTurns,
        context.historyCharacters,
        timestamp,
        id,
        attempt,
      );
    if (result.changes !== 1)
      throw new Error('The root turn is no longer active');
  }

  /** @param {string} id */
  getTurn(id) {
    return (
      this.db
        .prepare(`
      SELECT t.id, t.model, t.status, t.attempt, t.error_code AS errorCode,
             t.error_message AS errorMessage, t.created_at AS createdAt,
             u.content AS userContent
      FROM root_turns AS t
      JOIN root_messages AS u ON u.turn_id = t.id AND u.role = 'user' AND u.attempt = 1
      WHERE t.id = ?
    `)
        .get(id) ?? null
    );
  }

  getSelectedModel() {
    return (
      this.db
        .prepare("SELECT value FROM app_settings WHERE key = 'selected_model'")
        .get()?.value ?? null
    );
  }

  /** @param {string | null} model */
  setSelectedModel(model) {
    if (model !== null) requireText(model, 'model', 200);
    const timestamp = nowIso();
    if (model === null) {
      this.db
        .prepare("DELETE FROM app_settings WHERE key = 'selected_model'")
        .run();
      return;
    }
    this.db
      .prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('selected_model', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
      .run(model, timestamp);
  }

  close() {
    if (this.db.open) this.db.close();
  }
}

export { MAX_MESSAGE_LENGTH };
