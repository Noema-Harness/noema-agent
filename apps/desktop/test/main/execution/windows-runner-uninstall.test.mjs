import assert from 'node:assert/strict';
import test from 'node:test';
import { removeWindowsRunnerStateOnUninstall } from '../../../src/main/execution/windows-runner-uninstall.mjs';

const operationId = 'squirrel-uninstall-operation-01';

test('runner cleanup only runs for a packaged Windows Squirrel uninstall', async () => {
  let helperCreations = 0;
  for (const input of [
    { platform: 'linux', isPackaged: true, isUninstallEvent: true },
    { platform: 'win32', isPackaged: false, isUninstallEvent: true },
    { platform: 'win32', isPackaged: true, isUninstallEvent: false },
  ]) {
    assert.deepEqual(
      await removeWindowsRunnerStateOnUninstall({
        ...input,
        createHelper() {
          helperCreations += 1;
          throw new Error('must not create helper');
        },
      }),
      { status: 'skipped' },
    );
  }
  assert.equal(helperCreations, 0);
});

test('runner cleanup sends a bounded operation identity and completes before uninstall', async () => {
  const calls = [];
  const result = await removeWindowsRunnerStateOnUninstall({
    platform: 'win32',
    isPackaged: true,
    isUninstallEvent: true,
    operationId,
    createHelper() {
      return {
        async removeSandboxSetup(input) {
          calls.push(input);
        },
      };
    },
    onFailure() {
      assert.fail('successful cleanup must not warn');
    },
  });
  assert.deepEqual(calls, [{ operationId }]);
  assert.deepEqual(result, { status: 'removed' });
});

test('runner cleanup warns with a safe reason and still permits uninstall', async () => {
  const warnings = [];
  const result = await removeWindowsRunnerStateOnUninstall({
    platform: 'win32',
    isPackaged: true,
    isUninstallEvent: true,
    operationId,
    createHelper() {
      return {
        async removeSandboxSetup() {
          const error = new Error('private path should not be shown');
          error.code = 'wfp_elevation_cancelled';
          throw error;
        },
      };
    },
    onFailure(code) {
      warnings.push(code);
    },
  });
  assert.deepEqual(warnings, ['wfp_elevation_cancelled']);
  assert.deepEqual(result, {
    status: 'warning',
    code: 'wfp_elevation_cancelled',
  });
});
