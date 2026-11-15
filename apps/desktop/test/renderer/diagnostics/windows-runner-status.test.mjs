import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canOfferWindowsRunnerSetup,
  windowsRunnerReasonLabel,
} from '../../../src/renderer/diagnostics/windows-runner-status.ts';

test('keeps the incomplete-runner reason specific to command availability', () => {
  const label = windowsRunnerReasonLabel('runner_implementation_incomplete');
  assert.match(label, /命令暂未开放/u);
  assert.doesNotMatch(label, /管理员权限|Windows 更新/u);
});

test('formats every readiness blocker into a readable explanation', () => {
  const label = windowsRunnerReasonLabel([
    'runner_implementation_incomplete',
    'sandbox_setup_unavailable',
  ]);
  assert.match(label, /尚未完成目标机验证/u);
  assert.match(label, /隔离设置尚未完成/u);
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
