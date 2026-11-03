import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canOfferWindowsRunnerSetup,
  windowsRunnerReasonLabel,
} from '../../../src/renderer/diagnostics/windows-runner-status.mjs';

test('explains an incomplete runner without implying a Windows update is needed for Noema', () => {
  assert.match(
    windowsRunnerReasonLabel('runner_implementation_incomplete'),
    /无需更新 Windows 即可启动和使用 Noema/u,
  );
});

test('formats every readiness blocker into a readable explanation', () => {
  const label = windowsRunnerReasonLabel([
    'runner_implementation_incomplete',
    'sandbox_setup_unavailable',
    'network_filters_unverified',
  ]);
  assert.match(label, /尚未完成目标机验证/u);
  assert.match(label, /隔离设置尚未完成/u);
  assert.match(label, /网络隔离规则尚未完成检查/u);
});

test('does not offer setup when the runner implementation is incomplete', () => {
  assert.equal(
    canOfferWindowsRunnerSetup({
      supported: false,
      backendId: 'noema-codex-windows',
      setupActionAvailable: false,
    }),
    false,
  );
});

test('offers setup only when setup can address the current blocker', () => {
  assert.equal(
    canOfferWindowsRunnerSetup({
      supported: false,
      backendId: 'noema-codex-windows',
      setupActionAvailable: true,
    }),
    true,
  );
  assert.equal(
    canOfferWindowsRunnerSetup({
      supported: false,
      backendId: 'noema-codex-windows',
      setupActionAvailable: false,
    }),
    false,
  );
});
