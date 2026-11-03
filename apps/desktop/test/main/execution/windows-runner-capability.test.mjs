import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindowsRunnerCapabilityReport } from '../../../src/main/execution/windows-runner-capability.mjs';

test('Windows capability report exposes only safe identity and readiness fields', () => {
  assert.deepEqual(
    createWindowsRunnerCapabilityReport({
      platform: 'win32',
      support: { supported: true },
      backendReadiness: {
        ready: true,
        backend: {
          id: 'noema-codex-windows',
          version: '0.1.0',
          path: 'C:\\secret\\runner.exe',
        },
      },
      setupReadiness: { ready: true, packageSid: 'S-1-secret' },
      protocolVersion: 7,
    }),
    {
      platform: 'win32',
      supported: true,
      backendReady: true,
      status: 'ready',
      reasonCode: null,
      reasonCodes: [],
      setupActionAvailable: false,
      backendId: 'noema-codex-windows',
      backendVersion: '0.1.0',
      protocolVersion: 7,
      setupStatus: 'ready',
    },
  );
});

test('Windows capability report bounds error reasons and versions', () => {
  const report = createWindowsRunnerCapabilityReport({
    platform: 'win32',
    support: { supported: false, reason: 'C:\\private\\runner.exe' },
    backendReadiness: {
      code: 'runner_resource_missing',
      backend: { id: 'unknown id', version: 'latest' },
    },
    setupReadiness: { ready: false, reason: 'secret account detail' },
    protocolVersion: -1,
  });
  assert.equal(report.reasonCode, 'runner_resource_missing');
  assert.deepEqual(report.reasonCodes, ['runner_resource_missing']);
  assert.equal(report.setupActionAvailable, false);
  assert.equal(report.backendId, null);
  assert.equal(report.backendVersion, null);
  assert.equal(report.protocolVersion, null);
  assert.equal(report.setupStatus, 'unavailable');
});

test('runner setup remains available when setup blockers coexist with implementation hold', () => {
  const report = createWindowsRunnerCapabilityReport({
    platform: 'win32',
    support: { supported: false, reason: 'runner_implementation_incomplete' },
    backendReadiness: {
      ready: false,
      code: 'runner_implementation_incomplete',
      blockers: [
        'runner_implementation_incomplete',
        'sandbox_setup_unavailable',
        'network_filters_unverified',
      ],
      platform: { build: 19_045, ubr: 7_807 },
      backend: { id: 'noema-codex-windows', version: '0.1.0' },
    },
    setupReadiness: { ready: false, reason: 'sandbox_setup_unavailable' },
  });
  assert.deepEqual(report.reasonCodes, [
    'runner_implementation_incomplete',
    'sandbox_setup_unavailable',
    'network_filters_unverified',
  ]);
  assert.equal(report.setupActionAvailable, true);
});

test('runner setup remains hidden below the command security baseline', () => {
  const report = createWindowsRunnerCapabilityReport({
    platform: 'win32',
    support: { supported: false, reason: 'runner_implementation_incomplete' },
    backendReadiness: {
      ready: false,
      code: 'runner_implementation_incomplete',
      blockers: [
        'runner_implementation_incomplete',
        'sandbox_setup_unavailable',
        'network_filters_unverified',
        'os_baseline_unsupported',
      ],
      platform: { build: 19_045, ubr: 6_093 },
      backend: { id: 'noema-codex-windows', version: '0.1.0' },
    },
    setupReadiness: { ready: false, reason: 'sandbox_setup_unavailable' },
  });
  assert.equal(report.setupActionAvailable, false);
});

test('non-Windows hosts report that Windows runner setup does not apply', () => {
  assert.deepEqual(
    createWindowsRunnerCapabilityReport({
      platform: 'linux',
      support: { supported: true },
    }),
    {
      platform: 'not_applicable',
      supported: false,
      backendReady: false,
      status: 'not_applicable',
      reasonCode: null,
      reasonCodes: [],
      setupActionAvailable: false,
      backendId: null,
      backendVersion: null,
      protocolVersion: null,
      setupStatus: 'not_applicable',
    },
  );
});
