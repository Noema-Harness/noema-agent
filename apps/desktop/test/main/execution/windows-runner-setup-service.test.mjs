import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  advanceWindowsRunnerSetup,
  beginWindowsRunnerSetup,
  commitWindowsRunnerSetupReady,
  WindowsRunnerSetupStateStore,
} from '../../../src/main/execution/windows-runner-setup-state.mjs';
import { WindowsRunnerSetupService } from '../../../src/main/execution/windows-runner-setup-service.ts';

const packageSid = 'S-1-15-2-101-102-103-104-105-106-107';
const otherPackageSid = 'S-1-15-2-101-102-103-104-105-106-108';
const completeEvidence = Object.freeze({
  packageSid,
  profileValid: true,
});

async function withUserDataPath(run) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-runner-setup-service-'),
  );
  try {
    return await run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function createService(stateStore, helper, overrides = {}) {
  return new WindowsRunnerSetupService({
    stateStore,
    helper,
    operationIdFactory: () => 'setup_operation_01',
    ...overrides,
  });
}

test('setup service journals before helper work and commits only after fresh matching probe', async () => {
  await withUserDataPath(async (userDataPath) => {
    const stateStore = new WindowsRunnerSetupStateStore({ userDataPath });
    const calls = [];
    const helper = {
      async reconcileSandboxSetup(request) {
        const state = stateStore.load();
        assert.equal(state.status, 'repair_required');
        assert.equal(state.operationId, request.operationId);
        assert.equal(request.userDataPath, userDataPath);
        calls.push(['reconcile', request.operationId]);
        return { operationId: request.operationId, packageSid };
      },
      async probeSandboxSetup(request) {
        assert.equal(stateStore.load().stage, 'verify');
        assert.equal(request.userDataPath, userDataPath);
        calls.push(['probe', request.operationId]);
        return { operationId: request.operationId, evidence: completeEvidence };
      },
    };
    const service = createService(stateStore, helper, {
      onEvent() {
        throw new Error('diagnostics unavailable');
      },
    });

    const ready = await service.reconcile();
    assert.equal(ready.status, 'ready');
    assert.equal(ready.packageSid, packageSid);
    assert.deepEqual(calls, [
      ['reconcile', 'setup_operation_01'],
      ['probe', 'setup_operation_01'],
    ]);
    assert.deepEqual(stateStore.load(), ready);
  });
});

test('setup readiness verification is read-only and requires durable plus live ready state', async () => {
  await withUserDataPath(async (userDataPath) => {
    const unconfiguredStore = new WindowsRunnerSetupStateStore({
      userDataPath,
    });
    let setupProbeCount = 0;
    const helper = {
      async reconcileSandboxSetup() {
        throw new Error('read-only verification must never reconcile setup');
      },
      async probeSandboxSetup({ operationId }) {
        setupProbeCount += 1;
        return { operationId, evidence: completeEvidence };
      },
    };
    const unconfigured = createService(unconfiguredStore, helper);
    assert.deepEqual(await unconfigured.verifyReady(), {
      ready: false,
      reason: 'sandbox_setup_unavailable',
    });
    assert.equal(setupProbeCount, 0);

    const readyStore = new WindowsRunnerSetupStateStore({
      userDataPath: path.join(userDataPath, 'ready'),
    });
    await readyStore.transact((current) =>
      beginWindowsRunnerSetup(current, 'ready_operation_01'),
    );
    for (const stage of ['verify']) {
      await readyStore.transact((current) =>
        advanceWindowsRunnerSetup(current, 'ready_operation_01', stage),
      );
    }
    await readyStore.transact((current) =>
      commitWindowsRunnerSetupReady(
        current,
        'ready_operation_01',
        packageSid,
        completeEvidence,
      ),
    );
    let evidence = completeEvidence;
    const readyService = createService(readyStore, {
      ...helper,
      async probeSandboxSetup({ operationId }) {
        setupProbeCount += 1;
        return { operationId, evidence };
      },
    });
    const before = readyStore.load();
    assert.deepEqual(await readyService.verifyReady(), {
      ready: true,
      operationId: 'ready_operation_01',
      packageSid,
    });
    assert.deepEqual(readyStore.load(), before);
    evidence = { ...completeEvidence, profileValid: false };
    assert.deepEqual(await readyService.verifyReady(), {
      ready: false,
      reason: 'sandbox_setup_unavailable',
    });
    assert.deepEqual(readyStore.load(), before);
    assert.equal(setupProbeCount, 2);
  });
});

test('setup failure preserves repair-required state and retry reuses its operation identity', async () => {
  await withUserDataPath(async (userDataPath) => {
    const stateStore = new WindowsRunnerSetupStateStore({ userDataPath });
    let reconcileAttempts = 0;
    const helper = {
      async reconcileSandboxSetup({ operationId }) {
        reconcileAttempts += 1;
        if (reconcileAttempts === 1) {
          const error = new Error('private helper output');
          error.code = 'native_setup_failed';
          throw error;
        }
        assert.equal(operationId, 'setup_operation_01');
        return { operationId, packageSid };
      },
      async probeSandboxSetup({ operationId }) {
        return { operationId, evidence: completeEvidence };
      },
    };
    const service = createService(stateStore, helper);
    await assert.rejects(service.reconcile(), { code: 'native_setup_failed' });
    const pending = stateStore.load();
    assert.equal(pending.status, 'repair_required');
    assert.equal(pending.operationId, 'setup_operation_01');
    assert.equal(pending.reasonCode, 'native_setup_failed');
    assert.equal(
      JSON.stringify(pending).includes('private helper output'),
      false,
    );

    const ready = await service.reconcile();
    assert.equal(ready.status, 'ready');
    assert.equal(reconcileAttempts, 2);
  });
});

test('mismatched helper identity never commits ready', async () => {
  await withUserDataPath(async (userDataPath) => {
    const stateStore = new WindowsRunnerSetupStateStore({ userDataPath });
    const helper = {
      async reconcileSandboxSetup({ operationId }) {
        return { operationId, packageSid };
      },
      async probeSandboxSetup({ operationId }) {
        return {
          operationId,
          evidence: { ...completeEvidence, packageSid: otherPackageSid },
        };
      },
    };

    await assert.rejects(createService(stateStore, helper).reconcile(), {
      code: 'setup_state_live_verification_incomplete',
    });
    assert.equal(stateStore.load().status, 'repair_required');
  });
});

test('ready state is live-probed and stale evidence forces a new repair operation', async () => {
  await withUserDataPath(async (userDataPath) => {
    const stateStore = new WindowsRunnerSetupStateStore({ userDataPath });
    await stateStore.transact((current) =>
      beginWindowsRunnerSetup(current, 'previous_operation_01'),
    );
    for (const stage of ['verify']) {
      await stateStore.transact((current) =>
        advanceWindowsRunnerSetup(current, 'previous_operation_01', stage),
      );
    }
    await stateStore.transact((current) =>
      commitWindowsRunnerSetupReady(
        current,
        'previous_operation_01',
        packageSid,
        completeEvidence,
      ),
    );

    const calls = [];
    let probeAttempts = 0;
    const helper = {
      async probeSandboxSetup({ operationId }) {
        calls.push(['probe', operationId]);
        probeAttempts += 1;
        return {
          operationId,
          evidence:
            probeAttempts === 1
              ? { ...completeEvidence, profileValid: false }
              : completeEvidence,
        };
      },
      async reconcileSandboxSetup({ operationId }) {
        calls.push(['reconcile', operationId]);
        assert.equal(stateStore.load().status, 'repair_required');
        return { operationId, packageSid };
      },
    };

    const ready = await createService(stateStore, helper).reconcile();
    assert.equal(ready.status, 'ready');
    assert.equal(ready.operationId, 'setup_operation_01');
    assert.deepEqual(calls, [
      ['probe', 'previous_operation_01'],
      ['reconcile', 'setup_operation_01'],
      ['probe', 'setup_operation_01'],
    ]);
  });
});

test('setup service rejects unknown helper response fields and leaves state locked', async () => {
  await withUserDataPath(async (userDataPath) => {
    const stateStore = new WindowsRunnerSetupStateStore({ userDataPath });
    const helper = {
      async reconcileSandboxSetup({ operationId }) {
        return {
          operationId,
          packageSid,
          password: 'must not cross helper boundary',
        };
      },
      async probeSandboxSetup({ operationId }) {
        return { operationId, evidence: completeEvidence };
      },
    };

    await assert.rejects(createService(stateStore, helper).reconcile(), {
      code: 'setup_helper_response_invalid',
    });
    assert.equal(stateStore.load().status, 'repair_required');
    assert.equal(
      JSON.stringify(stateStore.load()).includes(
        'must not cross helper boundary',
      ),
      false,
    );
  });
});
