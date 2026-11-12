import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWindowPreferences,
  isMainFrameIpcEvent,
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

test('IPC accepts only the current top-level renderer frame', () => {
  const mainFrame = { parent: null };
  const sender = { mainFrame };
  assert.equal(isMainFrameIpcEvent({ sender, senderFrame: mainFrame }), true);
  assert.equal(
    isMainFrameIpcEvent({ sender, senderFrame: { parent: mainFrame } }),
    false,
  );
  assert.equal(isMainFrameIpcEvent({ sender }), false);
  assert.equal(
    isMainFrameIpcEvent({ sender: { mainFrame: {} }, senderFrame: mainFrame }),
    false,
  );
});

test('navigation is limited to the configured renderer entry; HTTPS links may open externally', () => {
  assert.equal(
    isInternalNavigation('http://localhost:5173/', 'http://localhost:5173/'),
    true,
  );
  assert.equal(
    isInternalNavigation(
      'http://localhost:5173/#social',
      'http://localhost:5173/',
    ),
    true,
  );
  assert.equal(
    isInternalNavigation(
      'http://localhost:5173/other',
      'http://localhost:5173/',
    ),
    false,
  );
  assert.equal(
    isInternalNavigation(
      'http://user@localhost:5173/',
      'http://localhost:5173/',
    ),
    false,
  );
  assert.equal(
    isInternalNavigation(
      'http://localhost:5173/',
      'http://user@localhost:5173/',
    ),
    false,
  );
  assert.equal(
    isInternalNavigation('file:///app/index.html', undefined),
    false,
  );
  assert.equal(
    isInternalNavigation(
      'file:///app/index.html#social',
      undefined,
      'file:///app/index.html',
    ),
    true,
  );
  assert.equal(
    isInternalNavigation(
      'file:///app/other.html',
      undefined,
      'file:///app/index.html',
    ),
    false,
  );
  assert.equal(
    isInternalNavigation('https://example.com', 'http://localhost:5173/'),
    false,
  );
  assert.equal(shouldOpenExternally('https://example.com'), true);
  assert.equal(shouldOpenExternally('javascript:alert(1)'), false);
  assert.equal(shouldOpenExternally('http://example.com'), false);
});
