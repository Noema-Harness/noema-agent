import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWindowPreferences,
  isInternalNavigation,
  shouldOpenExternally,
} from '../../../src/main/platform/window-security.mjs';

test('renderer runs without Node privileges and with process isolation', () => {
  assert.deepEqual(createWindowPreferences('preload.cjs'), {
    preload: 'preload.cjs',
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  });
});

test('navigation stays in the app; only HTTPS links are handed to the system browser', () => {
  assert.equal(
    isInternalNavigation('http://localhost:5173/', 'http://localhost:5173/'),
    true,
  );
  assert.equal(isInternalNavigation('file:///app/index.html', undefined), true);
  assert.equal(
    isInternalNavigation('https://example.com', 'http://localhost:5173/'),
    false,
  );
  assert.equal(shouldOpenExternally('https://example.com'), true);
  assert.equal(shouldOpenExternally('javascript:alert(1)'), false);
  assert.equal(shouldOpenExternally('http://example.com'), false);
});
