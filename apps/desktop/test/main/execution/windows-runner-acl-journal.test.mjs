import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  WindowsRunnerAclJournalStore,
  admitsWindowsRunnerAclJournal,
  beginWindowsRunnerAclTransaction,
  completeWindowsRunnerAclTransaction,
  emptyWindowsRunnerAclJournal,
  markWindowsRunnerAclTransactionVerified,
  validateWindowsRunnerAclJournal,
} from '../../../src/main/execution/windows-runner-acl-journal.mjs';
import { WindowsRunnerAclTransactionService } from '../../../src/main/execution/windows-runner-acl-transaction.ts';

const operationId = 'acl-operation-0001';
const grantA = {
  path: 'C:\\work\\project',
  fileIdentity: { volumeSerialNumber: '55', fileIndex: '101' },
  capabilityName:
    'Noema.Write.1111111111111111111111111111111111111111111111111111111111111111',
  access: 'write',
  isDirectory: true,
};
const grantB = {
  path: 'D:\\shared\\notes.txt',
  fileIdentity: { volumeSerialNumber: '77', fileIndex: '202' },
  capabilityName:
    'Noema.Read.2222222222222222222222222222222222222222222222222222222222222222',
  access: 'read',
  isDirectory: false,
};

function evidenceFor(...grants) {
  return grants.map((grant) => ({
    ...grant.fileIdentity,
    capabilityName: grant.capabilityName,
    access: grant.access,
    objectCount: grant.isDirectory ? 3 : 1,
    aclVerifiedCount: grant.isDirectory ? 3 : 1,
    treeDigest: 'a'.repeat(64),
    inheritanceVerified: grant.isDirectory,
  }));
}

function evidenceForNative(grants) {
  const knownGrants = [grantA, grantB];
  const selected = grants.map((grant) =>
    knownGrants.find(
      (known) =>
        known.fileIdentity.volumeSerialNumber ===
          grant.fileIdentity.volumeSerialNumber &&
        known.fileIdentity.fileIndex === grant.fileIdentity.fileIndex,
    ),
  );
  assert.equal(selected.every(Boolean), true);
  return evidenceFor(...selected);
}

function withUserData(run) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-acl-journal-'),
  );
  try {
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function withUserDataAsync(run) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-acl-journal-'),
  );
  try {
    await run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('ACL journal requires exact root evidence through staged completion', () => {
  const applying = beginWindowsRunnerAclTransaction(
    emptyWindowsRunnerAclJournal(),
    operationId,
    [grantA, grantB],
  );
  assert.equal(applying.status, 'repair_required');
  assert.equal(applying.phase, 'applying');
  assert.equal(admitsWindowsRunnerAclJournal(applying), false);
  assert.throws(
    () =>
      completeWindowsRunnerAclTransaction(
        applying,
        operationId,
        evidenceFor(grantA, grantB),
      ),
    { code: 'acl_state_transition_invalid' },
  );

  const verified = markWindowsRunnerAclTransactionVerified(
    applying,
    operationId,
    evidenceFor(grantB, grantA),
  );
  assert.equal(verified.phase, 'verified');
  assert.equal(admitsWindowsRunnerAclJournal(verified), false);
  assert.equal(
    completeWindowsRunnerAclTransaction(
      verified,
      operationId,
      evidenceFor(grantA, grantB),
    ).status,
    'clean',
  );
  assert.throws(
    () =>
      completeWindowsRunnerAclTransaction(
        verified,
        operationId,
        evidenceFor(grantA),
      ),
    { code: 'acl_live_verification_incomplete' },
  );
  assert.throws(
    () =>
      completeWindowsRunnerAclTransaction(
        verified,
        operationId,
        evidenceFor(
          {
            ...grantA,
            fileIdentity: { volumeSerialNumber: '55', fileIndex: '303' },
          },
          grantB,
        ),
      ),
    { code: 'acl_live_verification_mismatch' },
  );
  const changedTree = evidenceFor(grantA, grantB);
  changedTree[0].treeDigest = 'b'.repeat(64);
  assert.throws(
    () =>
      completeWindowsRunnerAclTransaction(verified, operationId, changedTree),
    { code: 'acl_live_verification_mismatch' },
  );
});

test('pending ACL transaction survives store restart and blocks another batch', () => {
  withUserData((userDataPath) => {
    const first = new WindowsRunnerAclJournalStore({ userDataPath });
    const pending = first.begin(operationId, [grantA]);
    assert.equal(pending.phase, 'applying');

    const restarted = new WindowsRunnerAclJournalStore({ userDataPath });
    assert.deepEqual(restarted.load(), pending);
    assert.throws(() => restarted.begin('acl-operation-0002', [grantB]), {
      code: 'acl_recovery_required',
    });

    const verified = restarted.markVerified(operationId, evidenceFor(grantA));
    assert.deepEqual(restarted.load(), verified);
    assert.equal(
      restarted.complete(operationId, evidenceFor(grantA)).status,
      'clean',
    );
    assert.equal(admitsWindowsRunnerAclJournal(restarted.load()), true);
  });
});

test('ACL journal rejects malformed records, path identities, and duplicate roots', () => {
  assert.throws(
    () =>
      beginWindowsRunnerAclTransaction(
        emptyWindowsRunnerAclJournal(),
        operationId,
        [],
      ),
    { code: 'acl_grants_invalid' },
  );
  assert.throws(
    () =>
      beginWindowsRunnerAclTransaction(
        emptyWindowsRunnerAclJournal(),
        operationId,
        [{ ...grantA, path: 'C:\\work\\CON.txt' }],
      ),
    { code: 'acl_grants_invalid' },
  );
  assert.throws(
    () =>
      beginWindowsRunnerAclTransaction(
        emptyWindowsRunnerAclJournal(),
        operationId,
        [grantA, grantA],
      ),
    { code: 'acl_grants_invalid' },
  );
  assert.throws(
    () =>
      beginWindowsRunnerAclTransaction(
        emptyWindowsRunnerAclJournal(),
        operationId,
        [{ ...grantA, path: 'C:\\work\\..\\outside' }],
      ),
    { code: 'acl_grants_invalid' },
  );
  assert.throws(
    () =>
      validateWindowsRunnerAclJournal({
        version: 1,
        revision: 1,
        status: 'clean',
        extra: true,
      }),
    { code: 'acl_journal_invalid' },
  );
});

test('journal store rejects linked, malformed, or reparse-backed state', () => {
  withUserData((userDataPath) => {
    const store = new WindowsRunnerAclJournalStore({ userDataPath });
    store.begin(operationId, [grantA]);
    const alias = path.join(userDataPath, 'acl-journal-alias.json');
    fs.linkSync(store.journalPath, alias);
    assert.throws(() => store.load(), { code: 'acl_journal_untrusted' });
  });

  withUserData((userDataPath) => {
    const store = new WindowsRunnerAclJournalStore({ userDataPath });
    fs.mkdirSync(path.dirname(store.journalPath), { recursive: true });
    fs.writeFileSync(store.journalPath, '{broken');
    assert.throws(() => store.load(), { code: 'acl_journal_invalid' });
  });

  withUserData((userDataPath) => {
    const redirected = path.join(userDataPath, 'redirected');
    fs.mkdirSync(redirected);
    const store = new WindowsRunnerAclJournalStore({
      userDataPath: redirected,
    });
    fs.rmSync(store.directoryPath, { recursive: true, force: true });
    fs.symlinkSync(redirected, store.directoryPath, 'junction');
    assert.throws(() => store.load(), {
      code: 'acl_journal_directory_untrusted',
    });
  });
});

test('ACL transaction service journals before mutation and verifies again before clearing', async () => {
  await withUserDataAsync(async (userDataPath) => {
    const journal = new WindowsRunnerAclJournalStore({ userDataPath });
    const steps = [];
    const events = [];
    const traceIdentity = {
      requestId: 'request-identity-0001',
      executionId: 'execution-01',
      taskId: 'task-01',
      toolCallId: 'call-01',
    };
    const helper = {
      async reconcileFilesystemRootAcls({ operationId: id, grants }) {
        steps.push('reconcile');
        assert.equal(id, operationId);
        assert.equal(journal.load().phase, 'applying');
        assert.deepEqual(grants, [
          {
            path: grantA.path,
            fileIdentity: grantA.fileIdentity,
            capabilityName: grantA.capabilityName,
            access: grantA.access,
            isDirectory: grantA.isDirectory,
          },
        ]);
        return evidenceFor(grantA);
      },
      async verifyFilesystemRootAcls({ operationId: id }) {
        steps.push('verify');
        assert.equal(id, operationId);
        assert.equal(journal.load().phase, 'verified');
        return evidenceFor(grantA);
      },
    };
    const service = new WindowsRunnerAclTransactionService({
      journalStore: journal,
      helper,
      makeOperationId: () => operationId,
      recordEvent: (event) => events.push(event),
    });

    assert.deepEqual(
      await service.ensureFilesystemRoots([grantA], traceIdentity),
      { ready: true, recovered: false },
    );
    assert.deepEqual(steps, ['reconcile', 'verify']);
    assert.equal(journal.load().status, 'clean');
    assert.ok(events.length > 0);
    for (const event of events) {
      assert.equal(event.requestId, traceIdentity.requestId);
      assert.equal(event.executionId, traceIdentity.executionId);
      assert.equal(event.taskId, traceIdentity.taskId);
      assert.equal(event.toolCallId, traceIdentity.toolCallId);
    }
  });
});

test('ACL transaction recovery uses only persisted grants and requires a fresh command retry', async () => {
  await withUserDataAsync(async (userDataPath) => {
    const journal = new WindowsRunnerAclJournalStore({ userDataPath });
    journal.begin(operationId, [grantA]);
    const calls = [];
    const helper = {
      async reconcileFilesystemRootAcls({ grants }) {
        calls.push(['reconcile', grants]);
        return evidenceForNative(grants);
      },
      async verifyFilesystemRootAcls({ grants }) {
        calls.push(['verify', grants]);
        return evidenceForNative(grants);
      },
    };
    const service = new WindowsRunnerAclTransactionService({
      journalStore: journal,
      helper,
      makeOperationId: () => 'acl-operation-0002',
    });

    assert.deepEqual(await service.ensureFilesystemRoots([grantB]), {
      ready: false,
      recovered: true,
      reason: 'acl_recovered_retry',
    });
    assert.deepEqual(
      calls.map(([kind]) => kind),
      ['reconcile', 'verify'],
    );
    assert.deepEqual(calls[0][1], [
      {
        path: grantA.path,
        fileIdentity: grantA.fileIdentity,
        capabilityName: grantA.capabilityName,
        access: grantA.access,
        isDirectory: grantA.isDirectory,
      },
    ]);
    assert.equal(journal.load().status, 'clean');

    const next = await service.ensureFilesystemRoots([grantB]);
    assert.equal(next.ready, true);
    assert.equal(journal.load().status, 'clean');
  });
});

test('verified ACL journal recovery is read-only when evidence matches', async () => {
  await withUserDataAsync(async (userDataPath) => {
    const journal = new WindowsRunnerAclJournalStore({ userDataPath });
    journal.begin(operationId, [grantA]);
    journal.markVerified(operationId, evidenceFor(grantA));
    let reconcileCalls = 0;
    const service = new WindowsRunnerAclTransactionService({
      journalStore: journal,
      helper: {
        async reconcileFilesystemRootAcls() {
          reconcileCalls += 1;
          assert.fail('matching live evidence needs no reconciliation');
        },
        async verifyFilesystemRootAcls() {
          return evidenceFor(grantA);
        },
      },
    });

    assert.deepEqual(await service.recoverPending(), {
      ready: true,
      recovered: true,
    });
    assert.equal(reconcileCalls, 0);
    assert.equal(journal.load().status, 'clean');
  });
});

test('verified ACL journal recovery reconciles a changed tree before updating its evidence', async () => {
  await withUserDataAsync(async (userDataPath) => {
    const journal = new WindowsRunnerAclJournalStore({ userDataPath });
    journal.begin(operationId, [grantA]);
    journal.markVerified(operationId, evidenceFor(grantA));
    let reconcileCalls = 0;
    const changedEvidence = evidenceFor(grantA);
    changedEvidence[0].treeDigest = 'b'.repeat(64);
    const service = new WindowsRunnerAclTransactionService({
      journalStore: journal,
      helper: {
        async reconcileFilesystemRootAcls() {
          reconcileCalls += 1;
          return changedEvidence;
        },
        async verifyFilesystemRootAcls() {
          return changedEvidence;
        },
      },
    });

    assert.deepEqual(await service.recoverPending(), {
      ready: true,
      recovered: true,
    });
    assert.equal(reconcileCalls, 1);
    assert.equal(journal.load().status, 'clean');
  });
});

test('fresh verification mismatch keeps the journal in repair-required verified state', async () => {
  await withUserDataAsync(async (userDataPath) => {
    const journal = new WindowsRunnerAclJournalStore({ userDataPath });
    const changedEvidence = evidenceFor(grantA);
    changedEvidence[0].treeDigest = 'c'.repeat(64);
    const service = new WindowsRunnerAclTransactionService({
      journalStore: journal,
      helper: {
        async reconcileFilesystemRootAcls() {
          return evidenceFor(grantA);
        },
        async verifyFilesystemRootAcls() {
          return changedEvidence;
        },
      },
      makeOperationId: () => operationId,
    });

    assert.deepEqual(await service.ensureFilesystemRoots([grantA]), {
      ready: false,
      recovered: false,
      reason: 'acl_live_verification_mismatch',
    });
    assert.equal(journal.load().status, 'repair_required');
    assert.equal(journal.load().phase, 'verified');
  });
});

test('ACL transaction helper errors leave the durable journal pending and diagnostics are non-fatal', async () => {
  await withUserDataAsync(async (userDataPath) => {
    const journal = new WindowsRunnerAclJournalStore({ userDataPath });
    const service = new WindowsRunnerAclTransactionService({
      journalStore: journal,
      helper: {
        async reconcileFilesystemRootAcls() {
          throw Object.assign(new Error('details must not escape'), {
            code: 'filesystem_root_hardlink_detected',
          });
        },
        async verifyFilesystemRootAcls() {
          assert.fail('verification must not follow a failed reconciliation');
        },
      },
      makeOperationId: () => operationId,
      recordEvent() {
        throw new Error('diagnostics unavailable');
      },
    });

    assert.deepEqual(await service.ensureFilesystemRoots([grantA]), {
      ready: false,
      recovered: false,
      reason: 'filesystem_root_hardlink_detected',
    });
    assert.equal(journal.load().status, 'repair_required');
    assert.equal(journal.load().phase, 'applying');
  });
});

test('ACL transaction service serializes concurrent batches in one main process', async () => {
  await withUserDataAsync(async (userDataPath) => {
    const journal = new WindowsRunnerAclJournalStore({ userDataPath });
    let active = 0;
    let maximumActive = 0;
    let operationSequence = 0;
    const helper = {
      async reconcileFilesystemRootAcls({ grants }) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return evidenceForNative(grants);
      },
      async verifyFilesystemRootAcls({ grants }) {
        return evidenceForNative(grants);
      },
    };
    const service = new WindowsRunnerAclTransactionService({
      journalStore: journal,
      helper,
      makeOperationId: () =>
        `acl-operation-${String(++operationSequence).padStart(4, '0')}`,
    });

    const results = await Promise.all([
      service.ensureFilesystemRoots([grantA]),
      service.ensureFilesystemRoots([grantB]),
    ]);
    assert.equal(
      results.every((result) => result.ready),
      true,
    );
    assert.equal(maximumActive, 1);
    assert.equal(journal.load().status, 'clean');
  });
});
