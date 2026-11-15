import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WorkspaceChangeBlobStore } from '../../../src/main/chat/workspace-change-blob-store.ts';

function makeStore(options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'noema-blobs-'));
  return {
    directory,
    store: new WorkspaceChangeBlobStore(directory, options),
  };
}

function hashOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('content-addressed blobs are written once, verified and read exactly', () => {
  const { directory, store } = makeStore();
  try {
    const first = Buffer.from('same bytes');
    const result = store.put(first);
    assert.equal(result.hash, hashOf(first));
    assert.equal(result.size, first.byteLength);
    assert.deepEqual(store.read(result.hash), first);
    assert.deepEqual(store.verify(result.hash, first.byteLength), {
      hash: result.hash,
      size: first.byteLength,
    });

    const second = store.put(Buffer.from('same bytes'));
    assert.equal(second.hash, result.hash);
    assert.equal(fs.readdirSync(directory).length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('blob writes reject invalid input and enforce the configured per-file limit', () => {
  const { directory, store } = makeStore({ maxBlobBytes: 4 });
  try {
    assert.throws(
      () => store.put(Buffer.alloc(5)),
      (error) => error.code === 'workspace_change_blob_limit',
    );
    assert.throws(
      () => store.put('not bytes'),
      (error) => error.code === 'workspace_change_blob_limit',
    );
    assert.throws(
      () => store.read('../not-a-hash'),
      (error) => error.code === 'workspace_change_blob_hash_invalid',
    );
    assert.throws(
      () => store.verify('0'.repeat(64)),
      (error) => error.code === 'workspace_change_blob_missing',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a corrupted or wrong-sized blob is never accepted as recovery data', () => {
  const { directory, store } = makeStore();
  try {
    const result = store.put(Buffer.from('original'));
    fs.writeFileSync(path.join(directory, `${result.hash}.blob`), 'tampered');
    assert.throws(
      () => store.read(result.hash),
      (error) => error.code === 'workspace_change_blob_corrupt',
    );
    assert.throws(
      () => store.verify(result.hash),
      (error) => error.code === 'workspace_change_blob_corrupt',
    );

    const exact = store.put(Buffer.from('sized'));
    assert.throws(
      () => store.verify(exact.hash, exact.size + 1),
      (error) => error.code === 'workspace_change_blob_corrupt',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('orphan collection removes temporary and unreferenced files and retains verified references', () => {
  const { directory, store } = makeStore();
  try {
    const kept = store.put(Buffer.from('kept'));
    store.put(Buffer.from('orphan'));
    const temporary = path.join(directory, '.pending-leftover.tmp');
    fs.writeFileSync(temporary, 'temporary');

    const collected = store.collectUnreferenced([kept.hash]);
    assert.deepEqual(collected, { removed: 2, retained: 1 });
    assert.equal(
      fs.existsSync(path.join(directory, `${kept.hash}.blob`)),
      true,
    );
    assert.equal(fs.existsSync(temporary), false);
    assert.equal(fs.readdirSync(directory).length, 1);
    assert.throws(
      () => store.collectUnreferenced('not-an-array'),
      /workspace_blob_references_invalid/u,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
