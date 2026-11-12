import assert from 'node:assert/strict';
import test from 'node:test';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveLegacyHistoryExport } from '../../../src/main/archive/save-legacy-history-export.mjs';

async function createTemporaryDirectory() {
  return mkdtemp(path.join(os.tmpdir(), 'noema-legacy-history-export-'));
}

test('saves the previewed categories as an atomic local export with source provenance', async () => {
  const directory = await createTemporaryDirectory();
  const destination = path.join(directory, 'history.json');
  const originalRecords = [
    {
      category: 'captures',
      legacyOwner: 'legacy-root',
      record: { id: 'c1', content: 'one' },
    },
    {
      category: 'captures',
      legacyOwner: 'legacy-root',
      record: { id: 'c2', content: 'two' },
    },
  ];
  const archiveService = {
    getExportMetadata: () => ({
      format: 'noema-legacy-history-v1',
      previewId: 'preview-1',
      categories: [{ id: 'captures', count: 2 }],
      totalRecords: 2,
    }),
    async *iterateExportRecords() {
      yield* originalRecords;
    },
  };
  try {
    const result = await saveLegacyHistoryExport({
      previewId: 'preview-1',
      archiveService,
      selectFile: async () => ({ canceled: false, filePath: destination }),
      createWriteStream,
    });
    assert.deepEqual(result, { saved: true, canceled: false, errorCode: null });
    const saved = JSON.parse(await readFile(destination, 'utf8'));
    assert.equal(saved.complete, true);
    assert.deepEqual(saved.exportedCounts, { captures: 2 });
    assert.deepEqual(saved.records, originalRecords);
    assert.deepEqual(originalRecords, [
      {
        category: 'captures',
        legacyOwner: 'legacy-root',
        record: { id: 'c1', content: 'one' },
      },
      {
        category: 'captures',
        legacyOwner: 'legacy-root',
        record: { id: 'c2', content: 'two' },
      },
    ]);
    assert.deepEqual(await readdir(directory), ['history.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a changed source count and removes its temporary export', async () => {
  const directory = await createTemporaryDirectory();
  const destination = path.join(directory, 'history.json');
  const archiveService = {
    getExportMetadata: () => ({
      format: 'noema-legacy-history-v1',
      previewId: 'preview-1',
      categories: [{ id: 'captures', count: 2 }],
      totalRecords: 2,
    }),
    async *iterateExportRecords() {
      yield { category: 'captures', record: { id: 'c1' } };
    },
  };
  try {
    const result = await saveLegacyHistoryExport({
      previewId: 'preview-1',
      archiveService,
      selectFile: async () => ({ canceled: false, filePath: destination }),
      createWriteStream,
    });
    assert.deepEqual(result, {
      saved: false,
      canceled: false,
      errorCode: 'write_failed',
    });
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('canceling the destination picker does not read or write archive data', async () => {
  let iterated = false;
  let opened = false;
  const result = await saveLegacyHistoryExport({
    previewId: 'preview-1',
    archiveService: {
      getExportMetadata: () => ({ categories: [{ id: 'captures', count: 1 }] }),
      async *iterateExportRecords() {
        iterated = true;
      },
    },
    selectFile: async () => ({ canceled: true }),
    createWriteStream: () => {
      opened = true;
      throw new Error('must not create a stream');
    },
  });
  assert.deepEqual(result, { saved: false, canceled: true, errorCode: null });
  assert.equal(iterated, false);
  assert.equal(opened, false);
});
