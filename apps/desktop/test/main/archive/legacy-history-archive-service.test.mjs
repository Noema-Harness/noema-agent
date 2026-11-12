import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  LEGACY_HISTORY_CATEGORIES,
  LegacyHistoryArchiveService,
} from '../../../src/main/archive/legacy-history-archive-service.mjs';
import { RootStore } from '../../../src/main/storage/root-store.mjs';

function createService({ records = [], counts = null } = {}) {
  const calls = [];
  const categoryCounts = Object.fromEntries(
    LEGACY_HISTORY_CATEGORIES.map((category) => [category, 0]),
  );
  const rootStore = {
    getLegacyHistoryCategoryCounts: () => counts ?? categoryCounts,
    listLegacyHistoryPage: (input) => {
      calls.push(input);
      return {
        records,
        nextCursor: records.at(-1)?.seq ?? null,
        hasMore: false,
      };
    },
  };
  return {
    calls,
    service: new LegacyHistoryArchiveService({ rootStore }),
  };
}

test('archive exposes fixed categories with safe counts and no write surface', () => {
  const { service } = createService({
    counts: {
      'root-turns': 2,
      'root-messages': 4,
      'dsh-tasks': 1,
      captures: 3,
      'context-imports': 1,
      'interaction-adjustments': -1,
      injected: 99,
    },
  });
  assert.deepEqual(
    service.listCategories(),
    LEGACY_HISTORY_CATEGORIES.map((id) => ({
      id,
      count:
        id === 'interaction-adjustments'
          ? 0
          : ({
              'root-turns': 2,
              'root-messages': 4,
              'dsh-tasks': 1,
              captures: 3,
              'context-imports': 1,
            }[id] ?? 0),
    })),
  );
  assert.equal('delete' in service, false);
  assert.equal('update' in service, false);
});

test('archive pages clamp size and label records without altering source fields', () => {
  const source = {
    seq: 9,
    id: 'message-1',
    content: '旧消息',
    routedViaJson: '["provider"]',
    interactionAdjustmentIdsJson: '[]',
    interactionAdjustmentSnapshotsJson: '[]',
    historySourcesJson: '[]',
    externalSourcesJson: '[]',
  };
  const { calls, service } = createService({ records: [source] });
  const page = service.listPage({ category: 'root-messages', limit: 500 });
  assert.equal(calls[0].limit, 50);
  assert.deepEqual(page.records[0], {
    id: 'message-1',
    content: '旧消息',
    category: 'root-messages',
    legacyOwner: 'legacy-root',
    routedVia: ['provider'],
    interactionAdjustmentIds: [],
    interactionAdjustmentSnapshots: [],
    historySources: [],
    externalSources: [],
    truncatedFields: [],
    recordStatus: 'complete',
  });
  assert.equal('snapshotJson' in page.records[0], false);
  assert.equal(source.seq, 9);
  assert.equal(source.routedViaJson, '["provider"]');
});

test('malformed context snapshot and overlong content remain visibly partial and export raw evidence', async () => {
  const longPrompt = 'p'.repeat(100_001);
  const { service } = createService({
    records: [{ seq: 1, id: 'bad-context', snapshotJson: '{broken' }],
    counts: { 'context-imports': 1 },
  });
  const contextPage = service.listPage({ category: 'context-imports' });
  assert.equal(contextPage.records[0].recordStatus, 'partial');
  assert.deepEqual(contextPage.records[0].messages, []);
  assert.equal('snapshotJson' in contextPage.records[0], false);
  const exportPreview = service.getExportPreview({
    categories: ['context-imports'],
  });
  const rawExport = [];
  for await (const entry of service.iterateExportRecords(
    exportPreview.previewId,
  )) {
    rawExport.push(entry);
  }
  assert.equal(rawExport[0].recordStatus, 'partial');
  assert.equal(rawExport[0].record.snapshotJson, '{broken');

  const taskService = createService({
    records: [
      {
        seq: 3,
        id: 'long-task',
        prompt: longPrompt,
        verificationChecksJson: '[]',
        verificationResultsJson: '[]',
        interactionAdjustmentIdsJson: '[]',
        interactionAdjustmentSnapshotsJson: '[]',
        toolActionCategoriesJson: '[]',
      },
    ],
  }).service;
  const task = taskService.listPage({ category: 'dsh-tasks' }).records[0];
  assert.equal(task.prompt.length, 100_000);
  assert.deepEqual(task.truncatedFields, ['prompt']);
  assert.equal(task.recordStatus, 'partial');
});

test('archive rejects unknown categories and invalid cursors', () => {
  const { service } = createService();
  assert.throws(
    () => service.listPage({ category: 'root-turns; DROP' }),
    /类别无效/,
  );
  assert.throws(
    () => service.listPage({ category: 'root-turns', cursor: -1 }),
    /分页位置无效/,
  );
  assert.throws(
    () => service.listPage({ category: 'root-turns', limit: 0 }),
    /分页大小无效/,
  );
});

test('archives every legacy category read-only and exports exact original rows', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'noema-legacy-history-fixture-'),
  );
  const rootStore = new RootStore(path.join(directory, 'legacy.sqlite3'));
  t.after(async () => {
    rootStore.close();
    await rm(directory, { recursive: true, force: true });
  });
  const turn = rootStore.beginTurn({
    id: 'archive-integration-turn',
    text: 'legacy root user record',
    model: 'archive-model',
  });
  rootStore.appendAssistant({
    id: turn.id,
    attempt: turn.attempt,
    content: 'legacy assistant record',
  });
  rootStore.completeTurn(turn.id, turn.attempt);
  rootStore.db
    .prepare(`
    INSERT INTO captured_moments (id, content, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `)
    .run(
      'legacy-capture-fixture',
      'legacy capture record',
      new Date().toISOString(),
      new Date().toISOString(),
    );
  rootStore.addContextImport({
    source: 'codex',
    threadId: 'legacy-thread',
    title: 'legacy codex snapshot',
    messages: [{ role: 'user', content: 'snapshot payload' }],
  });
  rootStore.addInteractionAdjustment({
    id: 'legacy-adjustment',
    sourceTurnId: turn.id,
    scope: 'coding',
    situation: 'legacy situation',
    behavior: 'legacy behavior',
    sourceQuote: 'legacy root user record',
  });
  rootStore.createBackgroundTask({
    id: 'legacy-dsh-task',
    sourceTurnId: turn.id,
    workspacePath: 'C:\\ArchiveFixture',
    model: 'archive-model',
    prompt: 'legacy DSH prompt',
  });
  const beforeCounts = rootStore.getLegacyHistoryCategoryCounts();
  const beforeRows = Object.fromEntries(
    LEGACY_HISTORY_CATEGORIES.map((category) => [
      category,
      rootStore.listLegacyHistoryPage({ category, limit: 50, fullText: true })
        .records,
    ]),
  );
  const service = new LegacyHistoryArchiveService({ rootStore });
  assert.deepEqual(
    service.listCategories().map(({ id }) => id),
    LEGACY_HISTORY_CATEGORIES,
  );
  const preview = service.getExportPreview({
    categories: LEGACY_HISTORY_CATEGORIES,
  });
  const exported = [];
  for await (const entry of service.iterateExportRecords(preview.previewId)) {
    exported.push(entry);
  }
  const exportedCounts = Object.fromEntries(
    LEGACY_HISTORY_CATEGORIES.map((category) => [
      category,
      exported.filter((entry) => entry.category === category).length,
    ]),
  );
  assert.deepEqual(exportedCounts, beforeCounts);
  for (const category of LEGACY_HISTORY_CATEGORIES) {
    assert.deepEqual(
      exported
        .filter((entry) => entry.category === category)
        .map(({ record }) => record),
      beforeRows[category],
    );
  }
  assert.deepEqual(rootStore.getLegacyHistoryCategoryCounts(), beforeCounts);
  for (const category of LEGACY_HISTORY_CATEGORIES) {
    assert.deepEqual(
      rootStore.listLegacyHistoryPage({ category, limit: 50, fullText: true })
        .records,
      beforeRows[category],
    );
  }
});
