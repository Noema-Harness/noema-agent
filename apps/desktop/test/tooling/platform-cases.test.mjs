import assert from 'node:assert/strict';
import test from 'node:test';
import { windowsOnly } from '../support/platform-cases.mjs';

test('windowsOnly keeps the case enabled on Windows', () => {
  assert.deepEqual(windowsOnly('drive-letter paths', 'win32'), {});
});

test('windowsOnly skips the case with a readable reason elsewhere', () => {
  assert.deepEqual(windowsOnly('drive-letter paths', 'linux'), {
    skip: 'Windows-only: drive-letter paths',
  });
  assert.deepEqual(windowsOnly('drive-letter paths', 'darwin'), {
    skip: 'Windows-only: drive-letter paths',
  });
});

test('windowsOnly follows the host platform by default', () => {
  const options = windowsOnly('host default');
  if (process.platform === 'win32') assert.deepEqual(options, {});
  else assert.equal(options.skip, 'Windows-only: host default');
});
