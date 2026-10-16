import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateQuickCaptureWindow,
  focusPrimaryWindow,
  finishQuickCaptureWindow,
  registerQuickCaptureShortcut,
} from '../src/quick-capture-shortcut.mjs';

test('restores and focuses Noema while remembering whether it should return to another app', () => {
  const calls = [];
  const returnToPrevious = activateQuickCaptureWindow({
    isDestroyed: () => false,
    isFocused: () => false,
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  });

  assert.equal(returnToPrevious, true);
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
});

test('keeps Noema visible when quick capture was opened from its own window', () => {
  const calls = [];
  const window = {
    isDestroyed: () => false,
    isFocused: () => true,
    isMinimized: () => false,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    minimize: () => calls.push('minimize'),
  };

  assert.equal(activateQuickCaptureWindow(window), false);
  assert.equal(finishQuickCaptureWindow(window, false), true);
  assert.deepEqual(calls, ['show', 'focus']);
});

test('minimizes Noema after an external quick capture and ignores a destroyed window', () => {
  const calls = [];
  const window = {
    isDestroyed: () => false,
    minimize: () => calls.push('minimize'),
  };
  assert.equal(finishQuickCaptureWindow(window, true), true);
  assert.deepEqual(calls, ['minimize']);
  assert.equal(
    finishQuickCaptureWindow({ isDestroyed: () => true }, true),
    false,
  );
});

test('registers the platform shortcut and unregisters only its own registration', () => {
  const calls = [];
  const onQuickCapture = () => calls.push('opened');
  const shortcutApi = {
    register: (accelerator, callback) => {
      calls.push(['register', accelerator]);
      assert.equal(callback, onQuickCapture);
      return true;
    },
    unregister: (accelerator) => calls.push(['unregister', accelerator]),
  };

  const registration = registerQuickCaptureShortcut({
    shortcutApi,
    platform: 'win32',
    onQuickCapture,
  });
  assert.equal(registration.accelerator, 'Control+Alt+N');
  assert.equal(registration.registered, true);
  onQuickCapture();
  registration.unregister();
  assert.deepEqual(calls, [
    ['register', 'Control+Alt+N'],
    'opened',
    ['unregister', 'Control+Alt+N'],
  ]);
});

test('a second launch restores and focuses the primary Noema window', () => {
  const calls = [];
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
  assert.equal(focusPrimaryWindow(window), true);
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
  assert.equal(focusPrimaryWindow({ isDestroyed: () => true }), false);
});

test('reports a shortcut conflict without unregistering a binding it does not own', () => {
  const calls = [];
  const registration = registerQuickCaptureShortcut({
    shortcutApi: {
      register: (accelerator) => {
        calls.push(['register', accelerator]);
        return false;
      },
      unregister: (accelerator) => calls.push(['unregister', accelerator]),
    },
    platform: 'darwin',
    onQuickCapture: () => {},
  });

  assert.equal(registration.accelerator, 'Command+Alt+N');
  assert.equal(registration.registered, false);
  registration.unregister();
  assert.deepEqual(calls, [['register', 'Command+Alt+N']]);
});
