import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { createSocialTestStore } from '../../../test-support/social-team.mjs';

function setup() {
  const db = new Database(':memory:');
  new RootStore(db);
  const store = createSocialTestStore(db);
  store.createSocialWorkTask({
    id: 'file-change-task',
    roomId: 'room-engineering-partner',
    agentId: 'engineering-partner',
    workspacePath: 'C:\\scratch\\project',
    workspaceKey: 'c:\\scratch\\project',
    taskPrompt: 'test file journal',
    model: 'test-model',
  });
  let nextStep = 0;
  function startStep() {
    const id = `write-step-${++nextStep}`;
    store.startSocialWorkExecutionStep('file-change-task', {
      id,
      toolName: 'write_file',
      category: 'write',
      hasSideEffect: true,
    });
    return id;
  }
  function prepare(stepId, relativePath, beforeBytes, afterBytes) {
    return store.prepareSocialWorkFileChange({
      taskId: 'file-change-task',
      stepId,
      relativePath,
      beforeBytes,
      afterHash: hash(afterBytes),
      diffText: 'bounded diff',
      diffTruncated: false,
    });
  }
  function complete(stepId, prepared, actualBytes) {
    return store.completeSocialWorkFileChange({
      taskId: 'file-change-task',
      stepId,
      ...prepared,
      actualHash: actualBytes === null ? null : hash(actualBytes),
    });
  }
  return { db, store, startStep, prepare, complete };
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('file journal retains the first snapshot across repeated writes', () => {
  const { db, store, startStep, prepare, complete } = setup();
  try {
    const original = Buffer.from('original');
    const first = Buffer.from('first change');
    const second = Buffer.from('second change');
    const firstStep = startStep();
    const firstOperation = prepare(firstStep, 'src/file.txt', original, first);
    assert.equal(complete(firstStep, firstOperation, first).state, 'applied');

    const secondStep = startStep();
    const secondOperation = prepare(secondStep, 'src/file.txt', first, second);
    const record = complete(secondStep, secondOperation, second);
    assert.equal(record.state, 'applied');
    assert.deepEqual(record.originalBytes, original);
    assert.equal(record.originalHash, hash(original));
    assert.equal(record.latestHash, hash(second));
    assert.equal(
      store.listSocialWorkFileChanges('file-change-task')[0].originalBytes,
      undefined,
    );
  } finally {
    db.close();
  }
});

test('file journal rejects stale baselines and retains unknown outcomes for review', () => {
  const { db, startStep, prepare, complete } = setup();
  try {
    const original = Buffer.from('original');
    const changed = Buffer.from('changed');
    const step = startStep();
    const prepared = prepare(step, 'file.txt', original, changed);
    complete(step, prepared, changed);

    const staleStep = startStep();
    assert.throws(
      () => prepare(staleStep, 'file.txt', original, Buffer.from('overwrite')),
      { code: 'workspace_file_concurrent_change' },
    );

    const nextStep = startStep();
    const next = prepare(nextStep, 'file.txt', changed, Buffer.from('next'));
    const record = complete(nextStep, next, Buffer.from('external edit'));
    assert.equal(record.state, 'unknown');
    assert.throws(
      () =>
        prepare(
          startStep(),
          'file.txt',
          Buffer.from('external edit'),
          Buffer.from('overwrite'),
        ),
      { code: 'workspace_file_change_unresolved' },
    );
  } finally {
    db.close();
  }
});

test('file journal clears an initial snapshot when a write did not apply', () => {
  const { db, store, startStep, prepare, complete } = setup();
  try {
    const step = startStep();
    const prepared = prepare(step, 'new.txt', null, Buffer.from('new file'));
    const record = complete(step, prepared, null);
    assert.equal(record.state, 'not_applied');
    assert.equal(record.originalBytes, null);
    assert.equal(
      store.listSocialWorkFileChanges('file-change-task')[0].state,
      'not_applied',
    );
  } finally {
    db.close();
  }
});

test('pending file writes reconcile only exact preimage or postimage hashes', () => {
  const { db, store, startStep, prepare } = setup();
  try {
    const original = Buffer.from('original');
    const after = Buffer.from('after');
    const appliedStep = startStep();
    const applied = prepare(appliedStep, 'applied.txt', original, after);
    assert.equal(
      store.listSocialWorkFileChanges('file-change-task')[0].diffText,
      'bounded diff',
    );
    assert.equal(
      store.reconcileSocialWorkFileChange({
        taskId: 'file-change-task',
        changeId: applied.changeId,
        actualHash: hash(after),
      }).state,
      'applied',
    );

    const untouchedStep = startStep();
    const untouched = prepare(untouchedStep, 'untouched.txt', null, after);
    assert.equal(
      store.reconcileSocialWorkFileChange({
        taskId: 'file-change-task',
        changeId: untouched.changeId,
        actualHash: null,
      }).state,
      'not_applied',
    );

    const uncertainStep = startStep();
    const uncertain = prepare(uncertainStep, 'uncertain.txt', null, after);
    assert.equal(
      store.reconcileSocialWorkFileChange({
        taskId: 'file-change-task',
        changeId: uncertain.changeId,
        actualHash: hash(Buffer.from('third state')),
      }).state,
      'conflict',
    );
    const operation = db
      .prepare(
        'SELECT state FROM social_work_file_change_operations WHERE id = ?',
      )
      .get(uncertain.operationId);
    assert.equal(operation.state, 'unknown');
    assert.equal(
      store
        .listSocialWorkFileChanges('file-change-task')
        .find((change) => change.id === uncertain.changeId).diffText,
      'bounded diff',
    );
  } finally {
    db.close();
  }
});

test('a restart recognizes an exact restored baseline without rewriting it', () => {
  const { db, store, startStep, prepare, complete } = setup();
  try {
    const original = Buffer.from('original');
    const after = Buffer.from('after');
    const step = startStep();
    const prepared = prepare(step, 'file.txt', original, after);
    complete(step, prepared, after);
    const reconciled = store.reconcileSocialWorkFileChange({
      taskId: 'file-change-task',
      changeId: prepared.changeId,
      actualHash: hash(original),
    });
    assert.equal(reconciled.state, 'reverted');
    assert.equal(reconciled.originalBytes, null);
  } finally {
    db.close();
  }
});

test('file journal enforces snapshot and workspace-relative path bounds before writing', () => {
  const { db, startStep, prepare } = setup();
  try {
    const oversizedStep = startStep();
    assert.throws(
      () =>
        prepare(
          oversizedStep,
          'large.bin',
          Buffer.alloc(1_000_001),
          Buffer.from('x'),
        ),
      { code: 'workspace_file_change_snapshot_limit' },
    );
    const invalidPathStep = startStep();
    assert.throws(
      () => prepare(invalidPathStep, '../outside.txt', null, Buffer.from('x')),
      { code: 'workspace_file_change_path_invalid' },
    );
  } finally {
    db.close();
  }
});
