import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  advanceWindowsRunnerSetup,
  admitsWindowsRunnerSetup,
  beginWindowsRunnerSetup,
  commitWindowsRunnerSetupReady,
  requireWindowsRunnerSetupRepair,
  unconfiguredWindowsRunnerSetupState,
  validateWindowsRunnerSetupState,
  WindowsRunnerSetupStateStore,
} from '../../../src/main/execution/windows-runner-setup-state.mjs';

const completeEvidence = Object.freeze({
  packageSid: 'S-1-15-2-101-102-103-104-105-106-107',
  profileValid: true,
  networkFiltersValid: true,
});
const appContainerPackageSid = 'S-1-15-2-101-102-103-104-105-106-107';

async function withUserDataPath(run) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-runner-setup-state-'),
  );
  try {
    return await run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function atVerify(state = unconfiguredWindowsRunnerSetupState()) {
  const next = beginWindowsRunnerSetup(state, 'setup_01');
  return advanceWindowsRunnerSetup(next, 'setup_01', 'verify');
}

test('setup state only becomes ready after strict staged live verification', () => {
  const verifying = atVerify();
  const incomplete = { ...completeEvidence, profileValid: false };
  assert.throws(
    () =>
      commitWindowsRunnerSetupReady(
        verifying,
        'setup_01',
        appContainerPackageSid,
        incomplete,
      ),
    { code: 'setup_state_live_verification_incomplete' },
  );
  assert.throws(
    () =>
      commitWindowsRunnerSetupReady(
        verifying,
        'setup_01',
        appContainerPackageSid,
        {
          ...completeEvidence,
          networkFiltersValid: false,
        },
      ),
    { code: 'setup_state_live_verification_incomplete' },
  );
  assert.throws(
    () =>
      commitWindowsRunnerSetupReady(
        verifying,
        'setup_01',
        'S-1-15-2-101-102-103-104-105-106-108',
        completeEvidence,
      ),
    { code: 'setup_state_live_verification_incomplete' },
  );
  assert.throws(
    () =>
      commitWindowsRunnerSetupReady(
        verifying,
        'setup_01',
        appContainerPackageSid,
        {
          ...completeEvidence,
          unexpected: 'ignored evidence',
        },
      ),
    { code: 'setup_state_live_verification_incomplete' },
  );
  assert.throws(
    () =>
      commitWindowsRunnerSetupReady(
        verifying,
        'other_setup',
        appContainerPackageSid,
        completeEvidence,
      ),
    { code: 'setup_state_transition_invalid' },
  );

  const ready = commitWindowsRunnerSetupReady(
    verifying,
    'setup_01',
    appContainerPackageSid,
    completeEvidence,
  );
  assert.equal(admitsWindowsRunnerSetup(ready, completeEvidence), true);
  assert.equal(ready.packageSid, appContainerPackageSid);
  assert.equal(
    admitsWindowsRunnerSetup(ready, {
      ...completeEvidence,
      profileValid: false,
    }),
    false,
  );
  assert.equal(
    admitsWindowsRunnerSetup(ready, {
      ...completeEvidence,
      networkFiltersValid: false,
    }),
    false,
  );
  assert.equal(
    admitsWindowsRunnerSetup(ready, {
      ...completeEvidence,
      packageSid: 'S-1-15-2-101-102-103-104-105-106-108',
    }),
    false,
  );
});

test('setup state rejects malformed AppContainer package SIDs', () => {
  const verifying = atVerify();
  for (const packageSid of [
    'S-1-5-21-1',
    'S-1-5-21-111-222-333-4294967296',
    'S-1-15-2-101-102-103-104-105-106-107-extra',
    'S-2-5-21-111-222-333-1001',
    'S-1-0x1000000000000-21-111',
    'S-1-15-2-4294967296-2-3-4-5-6-7',
    'S-1-15-2-01-2-3-4-5-6-7',
    'S-1-15-2-1-2-3-4-5-6-7-8',
  ]) {
    assert.throws(
      () =>
        commitWindowsRunnerSetupReady(
          verifying,
          'setup_01',
          packageSid,
          completeEvidence,
        ),
      { code: 'setup_identity_invalid' },
    );
  }
});

test('repair stages cannot be skipped or silently replaced by another operation', () => {
  const repair = beginWindowsRunnerSetup(
    unconfiguredWindowsRunnerSetupState(),
    'setup_01',
  );
  assert.throws(
    () => advanceWindowsRunnerSetup(repair, 'setup_01', 'filesystem'),
    { code: 'setup_state_transition_invalid' },
  );
  assert.throws(() => beginWindowsRunnerSetup(repair, 'setup_02'), {
    code: 'setup_recovery_required',
  });
  const failed = requireWindowsRunnerSetupRepair(repair, 'acl_apply_failed');
  assert.equal(admitsWindowsRunnerSetup(failed, completeEvidence), false);
});

test('state store atomically preserves repair-required state across owner restart', async () => {
  await withUserDataPath(async (userDataPath) => {
    const first = new WindowsRunnerSetupStateStore({ userDataPath });
    assert.deepEqual(first.load(), unconfiguredWindowsRunnerSetupState());
    const repair = await first.transact((state) =>
      beginWindowsRunnerSetup(state, 'setup_01'),
    );
    const second = new WindowsRunnerSetupStateStore({ userDataPath });
    assert.deepEqual(second.load(), repair);
    const advanced = await second.transact((state) =>
      advanceWindowsRunnerSetup(state, 'setup_01', 'verify'),
    );
    assert.equal(advanced.revision, repair.revision + 1);
    assert.deepEqual(first.load(), advanced);
  });
});

test('legacy account setup state resets to unconfigured without asserting AppContainer readiness', async () => {
  await withUserDataPath(async (userDataPath) => {
    const directory = path.join(userDataPath, 'windows-runner');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'setup-state.json'),
      JSON.stringify({
        version: 1,
        revision: 7,
        status: 'ready',
        operationId: 'legacy_setup_01',
        identitySid: 'S-1-5-21-111-222-333-1001',
      }),
      'utf8',
    );

    const store = new WindowsRunnerSetupStateStore({ userDataPath });
    assert.deepEqual(store.load(), unconfiguredWindowsRunnerSetupState());
  });
});

test('version two AppContainer state resets because it lacks WFP evidence', async () => {
  await withUserDataPath(async (userDataPath) => {
    const directory = path.join(userDataPath, 'windows-runner');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'setup-state.json'),
      JSON.stringify({
        version: 2,
        revision: 2,
        status: 'ready',
        operationId: 'setup_previous_02',
        packageSid: appContainerPackageSid,
      }),
      'utf8',
    );
    const store = new WindowsRunnerSetupStateStore({ userDataPath });
    assert.deepEqual(store.load(), unconfiguredWindowsRunnerSetupState());
  });
});

test('state store serializes concurrent transitions and refuses to replace active repair', async () => {
  await withUserDataPath(async (userDataPath) => {
    const store = new WindowsRunnerSetupStateStore({ userDataPath });
    const results = await Promise.allSettled([
      store.transact((state) => beginWindowsRunnerSetup(state, 'setup_01')),
      store.transact((state) => beginWindowsRunnerSetup(state, 'setup_02')),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.code, 'setup_recovery_required');
    assert.equal(store.load().revision, 1);
  });
});

test('state store rejects malformed, unknown, and hard-linked state files', async () => {
  await withUserDataPath(async (userDataPath) => {
    const store = new WindowsRunnerSetupStateStore({ userDataPath });
    await store.transact((state) => beginWindowsRunnerSetup(state, 'setup_01'));
    fs.writeFileSync(store.statePath, '{bad json');
    assert.throws(() => store.load(), { code: 'setup_state_invalid' });

    const repair = beginWindowsRunnerSetup(
      unconfiguredWindowsRunnerSetupState(),
      'setup_01',
    );
    fs.writeFileSync(
      store.statePath,
      JSON.stringify({ ...repair, injected: true }),
    );
    assert.throws(() => store.load(), { code: 'setup_state_invalid' });

    fs.writeFileSync(store.statePath, JSON.stringify(repair));
    const aliasPath = `${store.statePath}.alias`;
    fs.linkSync(store.statePath, aliasPath);
    assert.throws(() => store.load(), {
      code: 'setup_state_file_untrusted',
    });
    fs.unlinkSync(aliasPath);
  });
});

test('state store rejects junctions at userData and runner-state directory levels', async () => {
  await withUserDataPath((userDataPath) => {
    const target = path.join(userDataPath, 'target');
    fs.mkdirSync(target);
    const userDataJunction = path.join(userDataPath, 'user-data-junction');
    fs.symlinkSync(target, userDataJunction, 'junction');
    const throughUserDataJunction = new WindowsRunnerSetupStateStore({
      userDataPath: userDataJunction,
    });
    assert.throws(() => throughUserDataJunction.load(), {
      code: 'setup_state_directory_untrusted',
    });

    const stateDirectoryTarget = path.join(userDataPath, 'state-target');
    fs.mkdirSync(stateDirectoryTarget);
    const stateDirectoryJunction = path.join(userDataPath, 'windows-runner');
    fs.symlinkSync(stateDirectoryTarget, stateDirectoryJunction, 'junction');
    const throughStateDirectoryJunction = new WindowsRunnerSetupStateStore({
      userDataPath,
    });
    assert.throws(() => throughStateDirectoryJunction.load(), {
      code: 'setup_state_directory_untrusted',
    });
  });
});

test('state decoder rejects unsupported versions and impossible revisions', () => {
  assert.throws(
    () =>
      validateWindowsRunnerSetupState({
        version: 1,
        revision: 0,
        status: 'unconfigured',
      }),
    { code: 'setup_state_version_unsupported' },
  );
  assert.throws(
    () =>
      validateWindowsRunnerSetupState({
        version: 2,
        revision: 2,
        status: 'unconfigured',
      }),
    { code: 'setup_state_version_unsupported' },
  );
  assert.throws(
    () =>
      validateWindowsRunnerSetupState({
        version: 2,
        revision: 1,
        status: 'ready',
        operationId: 'setup_01',
        packageSid: 'S-1-5-21-1',
      }),
    { code: 'setup_state_version_unsupported' },
  );
});
