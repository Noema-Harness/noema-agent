import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RootStore } from '../src/root-store.mjs';

function memoryStore() {
  return new RootStore(':memory:');
}

test('root store migrates idempotently and persists the selected model', () => {
  const store = memoryStore();
  assert.doesNotThrow(() => store.migrate());
  assert.equal(
    store.db
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get().version,
    13,
  );
  store.setSelectedModel('free-router');
  assert.equal(store.getSelectedModel(), 'free-router');
  store.close();
});

test('captures remain local-only until an atomic discussion turn is created', () => {
  const store = memoryStore();
  const saved = store.createCapture('刚才发现了一个值得以后讨论的点');
  assert.equal(store.getSnapshot().captures[0].content, saved.content);

  const turn = store.beginTurn({
    id: 'capture-turn',
    captureId: saved.id,
    model: 'free-router',
  });
  const linked = store.getCapture(saved.id);
  assert.equal(linked.discussionTurnId, turn.id);
  assert.equal(
    store.db
      .prepare(
        "SELECT content FROM root_messages WHERE turn_id = ? AND role = 'user'",
      )
      .get(turn.id).content,
    saved.content,
  );
  assert.throws(
    () => store.updateCapture(saved.id, '改写后的内容'),
    /不能修改/,
  );
  assert.throws(
    () => store.beginTurn({ id: 'second-capture-turn', captureId: saved.id }),
    /已经开始讨论/,
  );

  store.deleteCapture(saved.id);
  assert.equal(store.getCapture(saved.id), null);
  assert.equal(
    store.db
      .prepare(
        "SELECT content FROM root_messages WHERE turn_id = ? AND role = 'user'",
      )
      .get(turn.id).content,
    '刚才发现了一个值得以后讨论的点',
  );
  store.close();
});

test('unmentioned captures never enter ordinary model context', () => {
  const store = memoryStore();
  store.createCapture('这段私密速记不应自动进入请求上下文');
  const turn = store.beginTurn({ id: 'ordinary-turn', text: '普通聊天内容' });
  const messages = store.getPromptMessages(turn.id);
  assert.equal(messages.at(-1).content, '普通聊天内容');
  assert.equal(
    messages.some((message) => message.content.includes('私密速记')),
    false,
  );
  store.close();
});

test('captures persist across a database reopen', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-capture-store-'));
  const databasePath = path.join(directory, 'root.sqlite3');
  try {
    const first = new RootStore(databasePath);
    const capture = first.createCapture('离线重启后仍然能找到这条记录。');
    first.close();

    const reopened = new RootStore(databasePath);
    assert.equal(reopened.getCapture(capture.id).content, capture.content);
    assert.equal(reopened.getSnapshot().captures.length, 1);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('history recall provenance is bounded and only attaches completed visible messages', () => {
  const store = memoryStore();
  const sourceTurn = store.beginTurn({
    id: 'history-source-turn',
    text: '我以前提到过 Noema 对话里的长期连续性。',
    model: 'auto:noema-free',
  });
  store.appendAssistant({
    id: sourceTurn.id,
    attempt: sourceTurn.attempt,
    content: '原始对话应保持可检索。',
  });
  store.completeTurn(sourceTurn.id, sourceTurn.attempt);
  const source = store
    .getSnapshot()
    .messages.find(
      (message) => message.turnId === sourceTurn.id && message.role === 'user',
    );
  const currentTurn = store.beginTurn({
    id: 'history-current-turn',
    text: '你还记得吗？',
    model: 'auto:noema-free',
  });
  const snapshot = {
    id: source.id,
    role: source.role,
    createdAt: source.createdAt,
    snippet: source.content,
  };

  store.setTurnHistorySources(currentTurn.id, currentTurn.attempt, [snapshot]);
  const assistant = store
    .getSnapshot()
    .messages.find(
      (message) =>
        message.turnId === currentTurn.id && message.role === 'assistant',
    );
  assert.deepEqual(assistant.historySources, [snapshot]);
  assert.equal(assistant.historySearchStatus, 'found');
  assert.equal(assistant.historySourcesIncluded, false);
  assert.equal(
    store.markTurnHistorySourcesIncluded(currentTurn.id, currentTurn.attempt),
    true,
  );
  const includedAssistant = store
    .getSnapshot()
    .messages.find(
      (message) =>
        message.turnId === currentTurn.id && message.role === 'assistant',
    );
  assert.equal(includedAssistant.historySourcesIncluded, true);
  assert.throws(
    () =>
      store.setTurnHistorySources(currentTurn.id, currentTurn.attempt, [
        { ...snapshot, id: 'missing-source' },
      ]),
    /历史来源不属于已完成的可见对话消息/,
  );
  assert.throws(
    () =>
      store.setTurnHistorySources(
        currentTurn.id,
        currentTurn.attempt,
        Array.from({ length: 5 }, (_, index) => ({
          ...snapshot,
          id: `source-${index}`,
        })),
      ),
    /历史来源快照列表无效/,
  );
  store.appendAssistant({
    id: currentTurn.id,
    attempt: currentTurn.attempt,
    content: '我在当前对话里回答。',
  });
  store.completeTurn(currentTurn.id, currentTurn.attempt);
  const noMatchTurn = store.beginTurn({
    id: 'history-no-match-turn',
    text: '之前有没有聊过找不到的词？',
    model: 'auto:noema-free',
  });
  store.setTurnHistorySources(noMatchTurn.id, noMatchTurn.attempt, []);
  const noMatchAssistant = store
    .getSnapshot()
    .messages.find(
      (message) =>
        message.turnId === noMatchTurn.id && message.role === 'assistant',
    );
  assert.equal(noMatchAssistant.historySearchStatus, 'no_match');
  assert.equal(noMatchAssistant.historySourcesIncluded, false);
  assert.deepEqual(noMatchAssistant.historySources, []);
  store.close();
});

test('schema-v12 databases add history delivery status without rewriting prior sources', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations (version, applied_at) VALUES (12, 'fixture');
    CREATE TABLE root_messages (
      id TEXT PRIMARY KEY,
      history_sources_json TEXT NOT NULL DEFAULT '[]',
      history_search_status TEXT NOT NULL DEFAULT 'not_searched'
        CHECK (history_search_status IN ('not_searched', 'found', 'included', 'no_match'))
    );
    INSERT INTO root_messages (id, history_sources_json, history_search_status)
    VALUES ('assistant-existing', '[{"id":"old-source"}]', 'found');
  `);
  const store = new RootStore(db);

  assert.equal(
    db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()
      .version,
    13,
  );
  assert.equal(
    db
      .prepare(
        'SELECT history_sources_included AS included FROM root_messages WHERE id = ?',
      )
      .get('assistant-existing').included,
    0,
  );
  assert.equal(
    db
      .prepare(
        'SELECT history_search_status AS status FROM root_messages WHERE id = ?',
      )
      .get('assistant-existing').status,
    'found',
  );
  assert.equal(
    db
      .prepare(
        'SELECT history_sources_json AS sources FROM root_messages WHERE id = ?',
      )
      .get('assistant-existing').sources,
    '[{"id":"old-source"}]',
  );
  store.close();
});

test('a schema-v4 database upgrades through interaction and verification state', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations (version, applied_at) VALUES
      (1, 'fixture'), (2, 'fixture'), (3, 'fixture'), (4, 'fixture');
    CREATE TABLE root_turns (id TEXT PRIMARY KEY, attempt INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE root_messages (
      id TEXT PRIMARY KEY, turn_id TEXT, role TEXT, content TEXT, status TEXT,
      attempt INTEGER, model TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE root_context_imports (id TEXT PRIMARY KEY);
    CREATE TABLE background_tasks (id TEXT PRIMARY KEY);
  `);
  const store = new RootStore(db);

  assert.equal(
    store.db
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get().version,
    13,
  );
  assert.equal(
    store.db
      .prepare(
        "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'interaction_adjustments'",
      )
      .get().count,
    1,
  );
  assert.deepEqual(
    store.db
      .prepare('PRAGMA table_info(background_tasks)')
      .all()
      .map((column) => column.name)
      .filter((name) => name.startsWith('verification_')),
    [
      'verification_checks_json',
      'verification_status',
      'verification_results_json',
      'verification_attempts',
    ],
  );
  assert.ok(
    store.db
      .prepare('PRAGMA table_info(root_turns)')
      .all()
      .some((column) => column.name === 'interaction_adjustment_ids_json'),
  );
  assert.ok(
    store.db
      .prepare('PRAGMA table_info(background_tasks)')
      .all()
      .some((column) => column.name === 'interaction_adjustment_ids_json'),
  );
  assert.deepEqual(
    store.db
      .prepare('PRAGMA table_info(background_tasks)')
      .all()
      .filter((column) => column.name.startsWith('tool_action'))
      .map((column) => column.name),
    ['tool_action_categories_json', 'tool_actions_truncated'],
  );
  store.db
    .prepare(`
      INSERT INTO root_messages (
        id, turn_id, role, content, status, attempt, model, created_at, updated_at
      ) VALUES ('legacy-response', 'legacy-turn', 'assistant', '旧回复', 'complete', 1, 'free-router', 'fixture', 'fixture')
    `)
    .run();
  assert.deepEqual(
    store.db
      .prepare(`
        SELECT routed_via_json AS routedVia, route_metadata_status AS status
        FROM root_messages WHERE id = 'legacy-response'
      `)
      .get(),
    { routedVia: '[]', status: 'unknown' },
  );
  store.close();
});

test('schema-v9 migration snapshots existing adjustments without guessing older attempts', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations (version, applied_at) VALUES (9, 'fixture');
    CREATE TABLE root_turns (
      id TEXT PRIMARY KEY, attempt INTEGER NOT NULL DEFAULT 1,
      interaction_adjustment_ids_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE root_messages (
      id TEXT PRIMARY KEY, turn_id TEXT, role TEXT, content TEXT, status TEXT,
      attempt INTEGER, model TEXT, created_at TEXT, updated_at TEXT,
      routed_via_json TEXT NOT NULL DEFAULT '[]',
      route_metadata_status TEXT NOT NULL DEFAULT 'unknown'
    );
    CREATE TABLE background_tasks (
      id TEXT PRIMARY KEY,
      interaction_adjustment_ids_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE interaction_adjustments (
      seq INTEGER PRIMARY KEY, id TEXT UNIQUE, source_turn_id TEXT UNIQUE,
      scope TEXT, situation TEXT, behavior TEXT, source_quote TEXT,
      status TEXT, created_at TEXT, withdrawn_at TEXT
    );
    INSERT INTO root_turns VALUES ('turn-1', 2, '["adjustment-1"]');
    INSERT INTO root_messages VALUES
      ('assistant-1', 'turn-1', 'assistant', 'first attempt', 'failed', 1, NULL, '2026-10-15', '2026-10-15', '[]', 'unknown'),
      ('assistant-2', 'turn-1', 'assistant', 'second attempt', 'complete', 2, NULL, '2026-10-15', '2026-10-15', '[]', 'unknown');
    INSERT INTO background_tasks VALUES ('task-1', '["adjustment-1"]');
    INSERT INTO interaction_adjustments VALUES
      (1, 'adjustment-1', 'turn-source', 'coding', 'Original situation', 'Original behavior', 'original quote', 'active', '2026-10-15', NULL);
  `);

  const store = new RootStore(db);
  const readSnapshots = (table, id) =>
    JSON.parse(
      db
        .prepare(
          `SELECT interaction_adjustment_snapshots_json AS value FROM ${table} WHERE id = ?`,
        )
        .get(id).value,
    );
  const expected = [
    {
      id: 'adjustment-1',
      scope: 'coding',
      situation: 'Original situation',
      behavior: 'Original behavior',
      sourceQuote: 'original quote',
      userEdited: false,
      editedAt: null,
    },
  ];

  assert.equal(
    db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()
      .version,
    13,
  );
  assert.deepEqual(readSnapshots('root_messages', 'assistant-2'), expected);
  assert.deepEqual(readSnapshots('root_messages', 'assistant-1'), []);
  assert.deepEqual(readSnapshots('background_tasks', 'task-1'), expected);
  store.close();
});

test('schema-v9 migration backfills only the latest root attempt and task snapshots', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations (version, applied_at) VALUES (9, 'fixture');
    CREATE TABLE root_turns (
      id TEXT PRIMARY KEY, attempt INTEGER NOT NULL DEFAULT 1,
      interaction_adjustment_ids_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE root_messages (
      id TEXT PRIMARY KEY, turn_id TEXT, role TEXT, content TEXT, status TEXT,
      attempt INTEGER, model TEXT, created_at TEXT, updated_at TEXT,
      routed_via_json TEXT NOT NULL DEFAULT '[]',
      route_metadata_status TEXT NOT NULL DEFAULT 'unknown'
    );
    CREATE TABLE background_tasks (
      id TEXT PRIMARY KEY,
      interaction_adjustment_ids_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE interaction_adjustments (
      seq INTEGER PRIMARY KEY, id TEXT UNIQUE, source_turn_id TEXT UNIQUE,
      scope TEXT, situation TEXT, behavior TEXT, source_quote TEXT,
      status TEXT, created_at TEXT, withdrawn_at TEXT
    );
    INSERT INTO root_turns VALUES ('turn-1', 2, '["adjustment-1"]');
    INSERT INTO root_messages VALUES
      ('assistant-1', 'turn-1', 'assistant', 'first attempt', 'failed', 1, NULL, '2026-10-15', '2026-10-15', '[]', 'unknown'),
      ('assistant-2', 'turn-1', 'assistant', 'second attempt', 'complete', 2, NULL, '2026-10-15', '2026-10-15', '[]', 'unknown');
    INSERT INTO background_tasks VALUES ('task-1', '["adjustment-1"]');
    INSERT INTO interaction_adjustments VALUES
      (1, 'adjustment-1', 'turn-source', 'coding', 'Original situation', 'Original behavior', 'original quote', 'active', '2026-10-15', NULL);
  `);

  const store = new RootStore(db);
  const latestAttempt = db
    .prepare(
      'SELECT interaction_adjustment_snapshots_json AS snapshots FROM root_messages WHERE id = ?',
    )
    .get('assistant-2');
  const earlierAttempt = db
    .prepare(
      'SELECT interaction_adjustment_snapshots_json AS snapshots FROM root_messages WHERE id = ?',
    )
    .get('assistant-1');
  const taskSnapshot = db
    .prepare(
      'SELECT interaction_adjustment_snapshots_json AS snapshots FROM background_tasks WHERE id = ?',
    )
    .get('task-1');

  assert.equal(
    db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()
      .version,
    13,
  );
  assert.deepEqual(JSON.parse(latestAttempt.snapshots), [
    {
      id: 'adjustment-1',
      scope: 'coding',
      situation: 'Original situation',
      behavior: 'Original behavior',
      sourceQuote: 'original quote',
      userEdited: false,
      editedAt: null,
    },
  ]);
  assert.deepEqual(JSON.parse(earlierAttempt.snapshots), []);
  assert.deepEqual(JSON.parse(taskSnapshot.snapshots), [
    {
      id: 'adjustment-1',
      scope: 'coding',
      situation: 'Original situation',
      behavior: 'Original behavior',
      sourceQuote: 'original quote',
      userEdited: false,
      editedAt: null,
    },
  ]);
  store.close();
});

test('stores gateway route provenance on the matching assistant attempt only', () => {
  const store = memoryStore();
  const first = store.beginTurn({
    text: '记录本轮路由',
    model: 'auto:noema-free',
  });
  let assistant = store
    .getSnapshot()
    .messages.find((message) => message.role === 'assistant');
  assert.equal(assistant.routeMetadataStatus, 'pending');
  assert.deepEqual(assistant.routedVia, []);

  store.recordAssistantRouteMetadata({
    id: first.id,
    attempt: first.attempt,
    routedVia: 'blockrun/model-a',
  });
  store.appendAssistant({
    id: first.id,
    attempt: first.attempt,
    content: '已记录。',
  });
  store.completeTurn(first.id, first.attempt);
  assistant = store
    .getSnapshot()
    .messages.find((message) => message.role === 'assistant');
  assert.equal(assistant.routeMetadataStatus, 'reported');
  assert.deepEqual(assistant.routedVia, ['blockrun/model-a']);

  const failed = store.beginTurn({
    text: '发生错误后重试',
    model: 'auto:noema-free',
  });
  store.recordAssistantRouteMetadata({
    id: failed.id,
    attempt: failed.attempt,
    routedVia: 'kilo/model-b',
  });
  store.failTurn(
    failed.id,
    failed.attempt,
    'provider_error',
    'synthetic failure',
  );
  const retry = store.retryTurn(failed.id, 'free-router');
  store.recordAssistantRouteMetadata({
    id: retry.id,
    attempt: retry.attempt,
    routedVia: null,
  });
  store.completeTurn(retry.id, retry.attempt);

  const attempts = store
    .getSnapshot()
    .messages.filter(
      (message) => message.role === 'assistant' && message.turnId === failed.id,
    );
  assert.equal(attempts[0].routeMetadataStatus, 'reported');
  assert.deepEqual(attempts[0].routedVia, ['kilo/model-b']);
  assert.equal(attempts[1].routeMetadataStatus, 'not_reported');
  assert.deepEqual(attempts[1].routedVia, []);

  const unavailable = store.beginTurn({
    text: '没有获得网关响应',
    model: 'auto:noema-free',
  });
  store.failTurn(
    unavailable.id,
    unavailable.attempt,
    'gateway_unavailable',
    'synthetic failure',
  );
  const unavailableAssistant = store
    .getSnapshot()
    .messages.find(
      (message) =>
        message.turnId === unavailable.id && message.role === 'assistant',
    );
  assert.equal(unavailableAssistant.routeMetadataStatus, 'unknown');
  store.close();
});

test('Codex context import is provenance-bearing, bounded to one snapshot, and removable', () => {
  const store = memoryStore();
  const snapshot = {
    source: 'codex',
    threadId: 'thr-fixture',
    title: '验证一条续接',
    cwd: 'D:\\Scratch',
    sourceUpdatedAt: '2026-10-13T12:00:00.000Z',
    capturedAt: '2026-10-13T12:01:00.000Z',
    messages: [
      { role: 'user', content: '请先检查错误原因。' },
      { role: 'assistant', content: '我只读了相关日志。' },
    ],
    omittedItems: 3,
    omittedTurns: 0,
    omittedMessages: 0,
    hasMoreTurns: true,
  };
  const imported = store.addContextImport(snapshot);
  assert.equal(imported.sourceThreadId, 'thr-fixture');
  assert.equal(imported.workingDirectory, 'D:\\Scratch');
  assert.equal(imported.consentedAt, null);
  assert.equal(imported.messageCount, 2);
  assert.equal(imported.hasMoreTurns, true);
  assert.throws(() => store.addContextImport(snapshot), /已有一个导入快照/);
  assert.equal(store.consentToContextImportTransmission(), true);
  assert.ok(store.getActiveContextImport().consentedAt);
  assert.equal(store.removeContextImport(), true);
  assert.equal(store.getActiveContextImport(), null);
  store.close();
});

test('a selected Codex snapshot reaches the next FreeLLMAPI context as historical data, not a user turn', () => {
  const store = memoryStore();
  store.addContextImport({
    source: 'codex',
    threadId: 'thr-context',
    title: '继续当前改动',
    messages: [
      { role: 'user', content: '只改导入按钮。' },
      { role: 'assistant', content: '已定位到现有对话主线。' },
    ],
  });
  store.consentToContextImportTransmission();
  const current = store.beginTurn({
    text: '接着做最小改动。',
    model: 'auto:noema-free',
  });
  const context = store.getPromptContext(current.id);
  const imported = context.messages.find((message) =>
    message.content.includes('codex_context_snapshot'),
  );
  assert.equal(imported.role, 'user');
  assert.match(imported.content, /只改导入按钮/);
  assert.match(imported.content, /不是本轮请求或操作授权/);
  assert.equal(context.messages.at(-1).content, '接着做最小改动。');
  assert.ok(context.historyCharacters > 0);
  store.close();
});

test('an unconsented Codex snapshot is excluded from every model context', () => {
  const store = memoryStore();
  store.addContextImport({
    source: 'codex',
    threadId: 'thr-unconsented',
    title: 'local-only preview',
    messages: [{ role: 'user', content: 'Synthetic data must remain local.' }],
  });
  const current = store.beginTurn({
    text: '普通问题，不应自动带入快照。',
    model: 'auto:noema-free',
  });

  const context = store.getPromptContext(current.id);
  assert.equal(
    context.messages.some((message) =>
      message.content.includes('codex_context_snapshot'),
    ),
    false,
  );
  assert.equal(store.getContextImports().length, 1);
  assert.equal(store.getContextImports()[0].consentedAt, null);
  store.close();
});

test('interaction adjustments require a quoted user correction and stay scoped', () => {
  const store = memoryStore();
  const correction = store.beginTurn({
    text: '你刚才又把阶段进展当成终点了。编码任务中，除非必须由我决定，否则请继续到交付。',
    model: 'auto:noema-free',
  });
  const adjustment = store.addInteractionAdjustment({
    id: 'adjustment-coding-1',
    sourceTurnId: correction.id,
    scope: 'coding',
    situation: '长期编码任务的阶段性进度汇报',
    behavior: '若没有用户决策或真实阻塞，就继续推进到验收完成。',
    sourceQuote: '除非必须由我决定，否则请继续到交付。',
  });

  assert.equal(adjustment.status, 'active');
  assert.equal(adjustment.scope, 'coding');
  assert.match(adjustment.sourceQuote, /除非必须由我决定/);
  assert.deepEqual(
    store.getInteractionAdjustmentsForSurface('coding').map((item) => item.id),
    ['adjustment-coding-1'],
  );
  assert.deepEqual(
    store.getInteractionAdjustmentsForSurface('conversation'),
    [],
  );
  assert.throws(
    () =>
      store.addInteractionAdjustment({
        id: 'adjustment-unquoted',
        sourceTurnId: correction.id,
        scope: 'coding',
        situation: '任何情境',
        behavior: '不要停止。',
        sourceQuote: '用户没说过的句子',
      }),
    /没有引用本轮用户原话/,
  );

  store.appendAssistant({ id: correction.id, attempt: 1, content: '收到。' });
  store.completeTurn(correction.id, 1);
  const next = store.beginTurn({
    text: '继续处理代码任务。',
    model: 'auto:noema-free',
  });
  const context = store.getPromptContext(next.id);
  assert.equal(
    context.messages.some((message) =>
      message.content.includes('长期编码任务的阶段性进度汇报'),
    ),
    false,
  );
  assert.equal(context.messages.at(-1).content, '继续处理代码任务。');
  assert.equal(context.interactionAdjustmentCount, 0);
  assert.equal(store.withdrawInteractionAdjustment(adjustment.id), true);
  assert.equal(
    store.getInteractionAdjustment(adjustment.id).status,
    'withdrawn',
  );
  assert.deepEqual(store.getInteractionAdjustmentsForSurface('coding'), []);
  store.close();
});

test('conversation-scoped adjustments survive the recent-turn window until withdrawn', () => {
  const store = memoryStore();
  const correction = store.beginTurn({
    text: '当我分享一段不愉快的经历时，先问我当时最在意什么，不要直接给心理分析。',
    model: 'auto:noema-free',
  });
  store.addInteractionAdjustment({
    id: 'adjustment-conversation-1',
    sourceTurnId: correction.id,
    scope: 'conversation',
    situation: '用户分享一段不愉快的经历但没有请求分析或建议',
    behavior:
      '先自然回应并询问用户当时最在意的部分；不要先做心理诊断或给解决方案。',
    sourceQuote: '不要直接给心理分析。',
  });
  store.appendAssistant({
    id: correction.id,
    attempt: 1,
    content: '我听到了。',
  });
  store.completeTurn(correction.id, 1);

  const next = store.beginTurn({
    text: '朋友临时取消了约定，我有点不是滋味。',
    model: 'auto:noema-free',
  });
  const context = store.getPromptContext(next.id);
  const adjustment = context.messages.find((message) =>
    message.content.includes('interaction_adjustments'),
  );
  assert.ok(adjustment);
  assert.match(adjustment.content, /先自然回应并询问用户当时最在意的部分/);
  assert.equal(
    context.messages.at(-1).content,
    '朋友临时取消了约定，我有点不是滋味。',
  );
  assert.equal(context.interactionAdjustmentCount, 1);

  store.appendAssistant({ id: next.id, attempt: 1, content: '明白。' });
  store.completeTurn(next.id, 1);
  assert.equal(
    store.withdrawInteractionAdjustment('adjustment-conversation-1'),
    true,
  );

  const later = store.beginTurn({
    text: '再说一件让我不舒服的事。',
    model: 'auto:noema-free',
  });
  assert.equal(
    store
      .getPromptContext(later.id)
      .messages.some((message) =>
        message.content.includes('interaction_adjustments'),
      ),
    false,
  );
  assert.equal(
    store.getInteractionAdjustment('adjustment-conversation-1').status,
    'withdrawn',
  );
  store.close();
});

test('users can revise active interaction adjustments without rewriting older attempts', () => {
  const store = memoryStore();
  const sourceTurn = store.beginTurn({
    text: '请先确认问题背景，再提出修改方案。',
    model: 'auto:noema-free',
  });
  const original = store.addInteractionAdjustment({
    id: 'adjustment-edit-1',
    sourceTurnId: sourceTurn.id,
    scope: 'both',
    situation: '开始修改代码前',
    behavior: '先补充解释再动手。',
    sourceQuote: '先确认问题背景',
  });
  store.appendAssistant({
    id: sourceTurn.id,
    attempt: 1,
    content: '我会先确认背景。',
  });
  store.completeTurn(sourceTurn.id, 1);

  const firstAppliedTurn = store.beginTurn({
    text: '继续实现这个改动。',
    model: 'auto:noema-free',
  });
  const firstContext = store.getPromptContext(firstAppliedTurn.id);
  store.setTurnContext(
    firstAppliedTurn.id,
    firstAppliedTurn.attempt,
    firstContext,
  );
  store.appendAssistant({
    id: firstAppliedTurn.id,
    attempt: 1,
    content: '先确认实现范围。',
  });
  store.completeTurn(firstAppliedTurn.id, 1);

  const firstAppliedSnapshot = store
    .getSnapshot()
    .messages.find(
      (message) => message.id === firstAppliedTurn.assistantMessageId,
    ).interactionAdjustmentSnapshots[0];
  assert.equal(firstAppliedSnapshot.behavior, '先补充解释再动手。');
  assert.equal(firstAppliedSnapshot.userEdited, false);

  const edited = store.updateInteractionAdjustment({
    id: original.id,
    scope: 'both',
    situation: '涉及范围或风险较大的修改前',
    behavior: '说明关键依据与风险；小改动直接做完。',
  });
  assert.equal(edited.userEdited, true);
  assert.equal(edited.scope, 'both');
  assert.equal(edited.originalScope, 'both');
  assert.equal(edited.originalSituation, '开始修改代码前');
  assert.equal(edited.originalBehavior, '先补充解释再动手。');
  assert.equal(edited.sourceQuote, '先确认问题背景');
  assert.equal(edited.createdAt, original.createdAt);
  assert.ok(edited.editedAt);

  const secondAppliedTurn = store.beginTurn({
    text: '还有一个小的文案要改。',
    model: 'auto:noema-free',
  });
  const secondContext = store.getPromptContext(secondAppliedTurn.id);
  const appliedContext = secondContext.messages.find((message) =>
    message.content.includes('interaction_adjustments'),
  );
  assert.match(appliedContext.content, /小改动直接做完/);
  assert.match(appliedContext.content, /"userEdited":true/);
  store.setTurnContext(
    secondAppliedTurn.id,
    secondAppliedTurn.attempt,
    secondContext,
  );

  const editedAgain = store.updateInteractionAdjustment({
    id: original.id,
    scope: 'conversation',
    situation: 'Noema 正准备做重大改变时',
    behavior: '先说明依据；日常交流保持自然简短。',
  });
  assert.equal(editedAgain.originalBehavior, '先补充解释再动手。');
  assert.equal(editedAgain.scope, 'conversation');

  const messages = store.getSnapshot();
  assert.deepEqual(
    messages.messages.find(
      (message) => message.id === firstAppliedTurn.assistantMessageId,
    ).interactionAdjustmentSnapshots,
    [firstAppliedSnapshot],
  );
  assert.deepEqual(
    messages.messages.find(
      (message) => message.id === secondAppliedTurn.assistantMessageId,
    ).interactionAdjustmentSnapshots[0],
    secondContext.interactionAdjustmentSnapshots[0],
  );
  assert.equal(store.withdrawInteractionAdjustment(original.id), true);
  assert.equal(
    store.updateInteractionAdjustment({
      id: original.id,
      scope: 'both',
      situation: '不能再修改',
      behavior: '已撤回',
    }),
    null,
  );
  assert.throws(
    () =>
      store.updateInteractionAdjustment({
        id: original.id,
        scope: 'both',
        situation: '   ',
        behavior: '有内容',
      }),
    /不能为空/,
  );
  store.close();
});

test('interaction adjustment storage refuses to grow beyond the active cap', () => {
  const store = memoryStore();
  for (let index = 1; index <= 12; index++) {
    const quote = `明确纠正 ${index}`;
    const turn = store.beginTurn({ text: quote, model: 'auto:noema-free' });
    store.addInteractionAdjustment({
      id: `adjustment-${index}`,
      sourceTurnId: turn.id,
      scope: 'conversation',
      situation: `情境 ${index}`,
      behavior: `行为 ${index}`,
      sourceQuote: quote,
    });
    store.appendAssistant({ id: turn.id, attempt: 1, content: '记下了。' });
    store.completeTurn(turn.id, 1);
  }
  const finalTurn = store.beginTurn({
    text: '再增加一条明确纠正。',
    model: 'auto:noema-free',
  });
  assert.throws(
    () =>
      store.addInteractionAdjustment({
        id: 'adjustment-overflow',
        sourceTurnId: finalTurn.id,
        scope: 'conversation',
        situation: '新的情境',
        behavior: '新的行为',
        sourceQuote: '再增加一条明确纠正。',
      }),
    /原型上限 12 条/,
  );
  assert.equal(
    store.getInteractionAdjustmentsForSurface('conversation').length,
    12,
  );
  store.close();
});

test('background task records DSH ownership and a separate root event response', () => {
  const store = memoryStore();
  const turn = store.beginTurn({
    text: '把这个文件修改交给后台',
    model: 'free-router',
  });
  const task = store.createBackgroundTask({
    id: 'task-1',
    sourceTurnId: turn.id,
    workspacePath: 'D:\\Scratch',
    model: 'free-router',
    prompt: 'Only edit the selected file.',
  });

  assert.equal(task.status, 'starting');
  assert.equal(task.sessionId, null);
  store.setBackgroundTaskSession(task.id, 'session-1');
  store.updateBackgroundTaskProgress(task.id, {
    phase: 'step_start',
    toolCallCount: 1,
  });
  const running = store.getBackgroundTask(task.id);
  assert.equal(running.sessionId, 'session-1');
  assert.equal(running.status, 'running');
  assert.equal(running.toolCallCount, 1);
  assert.deepEqual(running.toolActionCategories, []);
  assert.equal(running.toolActionsTruncated, false);

  store.finishBackgroundTask(task.id, {
    status: 'completed',
    resultText: 'Edited one file.',
    exitCode: 0,
    sessionId: 'session-1',
    toolCallCount: 1,
  });
  assert.equal(store.getNextPendingBackgroundEvent().id, task.id);
  assert.equal(
    store.beginBackgroundEventResponse(task.id, 'free-router'),
    true,
  );
  store.appendBackgroundEventResponse(task.id, 'Noema received the result.');
  store.completeBackgroundEventResponse(task.id);

  const finished = store.getBackgroundTask(task.id);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.eventStatus, 'delivered');
  assert.equal(finished.noemaResponseStatus, 'complete');
  assert.equal(finished.noemaResponse, 'Noema received the result.');
  assert.equal(store.getNextPendingBackgroundEvent(), null);
  store.close();
});

test('worker action trace stores only bounded, allowlisted categories', () => {
  const store = memoryStore();
  const turn = store.beginTurn({
    text: '把这个文件修改交给后台',
    model: 'auto:noema-free',
  });
  const task = store.createBackgroundTask({
    id: 'task-action-trace',
    sourceTurnId: turn.id,
    workspacePath: 'D:\\Scratch',
    model: 'auto:noema-free',
    prompt: 'Inspect and update one file.',
  });

  store.recordBackgroundTaskToolAction(task.id, 'list');
  store.recordBackgroundTaskToolAction(task.id, 'read');
  store.recordBackgroundTaskToolAction(task.id, 'write');
  const recorded = store.getBackgroundTask(task.id);
  assert.deepEqual(recorded.toolActionCategories, ['list', 'read', 'write']);
  assert.equal(recorded.toolActionsTruncated, false);
  assert.throws(
    () =>
      store.recordBackgroundTaskToolAction(task.id, 'D:\\Sensitive\\file.md'),
    /后台工具操作类别无效/,
  );

  for (let index = 3; index < 32; index++) {
    store.recordBackgroundTaskToolAction(task.id, 'read');
  }
  store.recordBackgroundTaskToolAction(task.id, 'edit');
  const capped = store.getBackgroundTask(task.id);
  assert.equal(capped.toolActionCategories.length, 32);
  assert.equal(capped.toolActionsTruncated, true);
  store.close();
});

test('future root context retains a delivered worker event as system data, not a user turn', () => {
  const store = memoryStore();
  const dispatchedTurn = store.beginTurn({
    text: '把 README 的安装说明交给后台处理。',
    model: 'auto:noema-free',
  });
  store.appendAssistant({
    id: dispatchedTurn.id,
    attempt: dispatchedTurn.attempt,
    content: '任务已交给后台 DSH agent。',
  });
  store.completeTurn(dispatchedTurn.id, dispatchedTurn.attempt);
  const task = store.createBackgroundTask({
    id: 'task-context',
    sourceTurnId: dispatchedTurn.id,
    workspacePath: 'D:\\Scratch',
    model: 'auto:noema-free',
    prompt: '只修改 README 安装说明。',
    verificationChecks: [{ kind: 'file_exists', path: 'README.md' }],
    interactionAdjustmentIds: ['adjustment-verification-test'],
    interactionAdjustmentSnapshots: [
      {
        id: 'adjustment-verification-test',
        scope: 'coding',
        situation: '文件验收失败',
        behavior: '先检查文件状态',
        sourceQuote: '先检查文件状态',
        userEdited: false,
        editedAt: null,
      },
    ],
  });
  store.recordBackgroundTaskToolAction(task.id, 'list');
  store.recordBackgroundTaskToolAction(task.id, 'write');
  store.finishBackgroundTask(task.id, {
    status: 'completed',
    resultText: 'README 第 1 行已更新。',
    sessionId: 'session-context',
    toolCallCount: 1,
    verificationStatus: 'verified',
    verificationResults: [
      {
        kind: 'file_exists',
        path: 'README.md',
        status: 'verified',
        reason: 'file_exists',
      },
    ],
    verificationAttempts: 0,
  });
  store.beginBackgroundEventResponse(task.id, 'auto:noema-free');
  store.appendBackgroundEventResponse(task.id, '安装说明已更新。');
  store.completeBackgroundEventResponse(task.id);

  const next = store.beginTurn({
    text: '刚才后台任务做完了吗？',
    model: 'auto:noema-free',
  });
  const context = store.getPromptContext(next.id);
  assert.deepEqual(
    context.messages.map((message) => message.role),
    ['user', 'assistant', 'system', 'user'],
  );
  assert.match(context.messages[2].content, /background_task_result/);
  assert.match(context.messages[2].content, /安装说明已更新/);
  assert.match(context.messages[2].content, /"verification"/);
  assert.match(context.messages[2].content, /"status":"verified"/);
  assert.match(context.messages[2].content, /adjustment-verification-test/);
  assert.match(
    context.messages[2].content,
    /"toolActionCategories":\["list","write"\]/,
  );
  assert.equal(context.messages[2].content.includes('D:\\Scratch'), false);
  assert.equal(context.messages[2].role, 'system');
  assert.ok(context.historyCharacters > 0);
  store.close();
});

test('a failed event response remains in future root context without partial summary text', () => {
  const store = memoryStore();
  const originalTurn = store.beginTurn({
    text: '把 README 安装说明交给后台。',
    model: 'auto:noema-free',
  });
  store.appendAssistant({
    id: originalTurn.id,
    attempt: originalTurn.attempt,
    content: '已启动后台任务。',
  });
  store.completeTurn(originalTurn.id, originalTurn.attempt);
  const task = store.createBackgroundTask({
    id: 'task-summary-failed',
    sourceTurnId: originalTurn.id,
    workspacePath: 'D:\\Scratch',
    model: 'auto:noema-free',
    prompt: '更新 README 安装说明。',
    verificationChecks: [{ kind: 'file_exists', path: 'README.md' }],
  });
  store.recordBackgroundTaskToolAction(task.id, 'write');
  store.finishBackgroundTask(task.id, {
    status: 'completed',
    resultText: 'README 更新完成。',
    verificationStatus: 'verified',
    verificationResults: [
      {
        kind: 'file_exists',
        path: 'README.md',
        status: 'verified',
        reason: 'file_exists',
      },
    ],
  });
  store.beginBackgroundEventResponse(task.id, 'auto:noema-free');
  store.appendBackgroundEventResponse(task.id, '不完整的临时总结');
  store.interruptBackgroundEventResponse(
    task.id,
    'failed',
    'Provider failure details stay out of model context.',
  );
  assert.equal(store.getNextPendingBackgroundEvent(), null);

  const nextTurn = store.beginTurn({
    text: '刚才的任务结果是什么？',
    model: 'auto:noema-free',
  });
  const eventMessage = store
    .getPromptContext(nextTurn.id)
    .messages.find((message) =>
      message.content.includes('background_task_result'),
    );

  assert.ok(eventMessage);
  assert.equal(eventMessage.role, 'system');
  assert.match(eventMessage.content, /"eventStatus":"pending"/);
  assert.match(eventMessage.content, /"noemaResponseStatus":"failed"/);
  assert.match(eventMessage.content, /"noemaSummary":null/);
  assert.match(eventMessage.content, /"toolActionCategories":\["write"\]/);
  assert.equal(eventMessage.content.includes('不完整的临时总结'), false);
  assert.equal(
    eventMessage.content.includes('Provider failure details stay out'),
    false,
  );
  assert.equal(store.resetBackgroundEventResponseForRetry(task.id), true);
  assert.equal(store.getNextPendingBackgroundEvent()?.id, task.id);
  store.close();
});

test('model context includes only the newest completed turns and reports what was omitted', () => {
  const store = memoryStore();
  for (const [text, reply] of [
    ['早期主题', '早期回复'],
    ['中间主题', '中间回复'],
    ['最近主题', '最近回复'],
  ]) {
    const turn = store.beginTurn({ text, model: 'free-router' });
    store.appendAssistant({
      id: turn.id,
      attempt: turn.attempt,
      content: reply,
    });
    store.completeTurn(turn.id, turn.attempt);
  }
  const current = store.beginTurn({
    text: '继续最近主题',
    model: 'free-router',
  });
  const context = store.getPromptContext(current.id, {
    maxTurns: 1,
    maxCharacters: 100,
  });

  assert.equal(context.includedTurns, 1);
  assert.equal(context.omittedTurns, 2);
  assert.deepEqual(
    context.messages.map(({ role, content }) => [role, content]),
    [
      ['user', '最近主题'],
      ['assistant', '最近回复'],
      ['user', '继续最近主题'],
    ],
  );
  store.close();
});

test('a retry reuses the original user message and preserves the interrupted response', () => {
  const store = memoryStore();
  const first = store.beginTurn({
    text: '继续刚才的话题',
    model: 'free-router',
  });
  store.appendAssistant({
    id: first.id,
    attempt: first.attempt,
    content: '第一段未完成',
  });
  store.interruptTurn(first.id, first.attempt);

  const retry = store.retryTurn(
    first.id,
    'nvidia/nemotron-3-super-120b-a12b:free',
  );
  store.appendAssistant({
    id: retry.id,
    attempt: retry.attempt,
    content: '完整的新回复',
  });
  store.completeTurn(retry.id, retry.attempt);

  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.messages.filter((message) => message.role === 'user').length,
    1,
  );
  assert.deepEqual(
    snapshot.messages
      .filter((message) => message.role === 'assistant')
      .map((message) => [message.content, message.status]),
    [
      ['第一段未完成', 'interrupted'],
      ['完整的新回复', 'complete'],
    ],
  );
  assert.equal(store.getTurn(first.id).attempt, 2);
  assert.deepEqual(store.getPromptMessages(first.id), [
    { role: 'user', content: '继续刚才的话题' },
  ]);
  store.close();
});

test('user content is parameterized and does not execute as SQL', () => {
  const store = memoryStore();
  const injection = "'); DROP TABLE root_messages;--";
  store.beginTurn({ text: injection, model: null });
  assert.equal(store.getSnapshot().messages[0].content, injection);
  assert.equal(
    store.db.prepare('SELECT count(*) AS total FROM root_messages').get().total,
    2,
  );
  store.close();
});

test('an application restart turns an in-flight response into a recoverable interruption', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-root-store-'));
  const file = path.join(directory, 'root.sqlite3');
  try {
    let store = new RootStore(file);
    const turn = store.beginTurn({
      text: '这条回复会在应用关闭时中断',
      model: 'free-router',
    });
    store.appendAssistant({
      id: turn.id,
      attempt: turn.attempt,
      content: '已输出部分内容',
    });
    store.close();

    store = new RootStore(file);
    assert.equal(store.recoverActiveTurns(), 1);
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.activeTurnId, null);
    assert.equal(snapshot.messages[1].status, 'interrupted');
    assert.equal(snapshot.messages[1].content, '已输出部分内容');
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an application restart interrupts a running DSH worker and queues its event', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-worker-store-'));
  const file = path.join(directory, 'root.sqlite3');
  try {
    let store = new RootStore(file);
    const turn = store.beginTurn({
      text: '委派一个后台任务',
      model: 'free-router',
    });
    const task = store.createBackgroundTask({
      id: 'task-restart',
      sourceTurnId: turn.id,
      workspacePath: 'D:\\Scratch',
      model: 'free-router',
      prompt: 'Inspect the test file.',
    });
    store.setBackgroundTaskSession(task.id, 'session-restart');
    store.close();

    store = new RootStore(file);
    assert.equal(store.recoverActiveTurns(), 1);
    const recovered = store.getBackgroundTask(task.id);
    assert.equal(recovered.status, 'interrupted');
    assert.equal(recovered.eventStatus, 'pending');
    assert.equal(recovered.sessionId, 'session-restart');
    assert.equal(store.getNextPendingBackgroundEvent().id, task.id);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
