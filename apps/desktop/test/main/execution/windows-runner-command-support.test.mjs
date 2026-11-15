import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWindowsRunnerCommandSupport } from '../../../src/main/execution/windows-runner-command-support.ts';

test('Windows command support opens only from both trusted ready gates', () => {
  assert.deepEqual(
    resolveWindowsRunnerCommandSupport({
      backendReadiness: { ready: true },
      setupReadiness: { ready: true },
    }),
    { supported: true },
  );
});

test('missing helper or startup error keeps the command gate closed', () => {
  assert.equal(
    resolveWindowsRunnerCommandSupport({
      unavailableCode: 'runner_resource_missing',
    }).supported,
    false,
  );
});

test('backend version and unsupported platform evidence cannot open the command gate', () => {
  for (const backendReadiness of [
    { ready: false, code: 'runner_helper_version_mismatch' },
    {
      ready: false,
      reportedReady: true,
      code: 'os_baseline_unsupported',
      platform: { build: 19_044, ubr: 6_093 },
    },
  ]) {
    assert.equal(
      resolveWindowsRunnerCommandSupport({
        backendReadiness,
        setupReadiness: { ready: true },
      }).supported,
      false,
    );
  }
});

test('unconfigured or invalid setup keeps the command gate closed', () => {
  assert.equal(
    resolveWindowsRunnerCommandSupport({
      backendReadiness: { ready: true },
      setupReadiness: { ready: false, reason: 'sandbox_setup_unavailable' },
    }).supported,
    false,
  );
});

test('diagnostics write failure keeps the command gate closed', () => {
  assert.deepEqual(
    resolveWindowsRunnerCommandSupport({
      backendReadiness: { ready: true },
      setupReadiness: { ready: true },
      diagnosticsReady: false,
    }),
    {
      supported: false,
      reason: 'Noema 诊断记录不可用；为保留执行链路，命令未启动。',
    },
  );
});
