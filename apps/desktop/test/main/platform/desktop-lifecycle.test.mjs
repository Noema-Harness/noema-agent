import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  createDesktopLifecycle,
  waitForDesktopShutdown,
} from '../../../src/main/platform/desktop-lifecycle.ts';

function createWindow() {
  const window = new EventEmitter();
  window.destroyed = false;
  window.minimized = false;
  window.visible = true;
  window.isDestroyed = () => window.destroyed;
  window.isMinimized = () => window.minimized;
  window.restore = () => {
    window.minimized = false;
  };
  window.show = () => {
    window.visible = true;
  };
  window.hide = () => {
    window.visible = false;
  };
  window.focus = () => {
    window.focused = true;
  };
  return window;
}

function fakeClose(window) {
  let prevented = false;
  window.emit('close', {
    preventDefault: () => {
      prevented = true;
    },
  });
  return prevented;
}

function fakeQuerySessionEnd(window) {
  let prevented = false;
  window.emit('query-session-end', {
    preventDefault: () => {
      prevented = true;
    },
  });
  return prevented;
}

test('close hides the same window and restore does not create duplicate services', () => {
  const events = [];
  const app = {
    quitCalls: 0,
    quit() {
      this.quitCalls += 1;
    },
  };
  let window = createWindow();
  let windowCreations = 0;
  const lifecycle = createDesktopLifecycle({
    app,
    createTray: ({ onOpen, onQuit }) => ({ onOpen, onQuit, destroy() {} }),
    createWindow: () => {
      windowCreations += 1;
      window = createWindow();
      return window;
    },
    getWindow: () => window,
    recordEvent: (event) => events.push(event),
  });
  try {
    assert.equal(lifecycle.initializeTray(), true);
    lifecycle.attachWindow(window);
    assert.equal(fakeClose(window), true);
    assert.equal(window.visible, false);
    assert.equal(app.quitCalls, 0);
    lifecycle.restoreWindow();
    assert.equal(window.visible, true);
    assert.equal(window.focused, true);
    assert.equal(windowCreations, 0);
    assert.equal(lifecycle.onSecondInstance(), true);
    assert.equal(windowCreations, 0);
    assert.deepEqual(
      events.map((event) => event.operation),
      ['tray.ready', 'window.hidden', 'window.restored', 'window.restored'],
    );
  } finally {
    lifecycle.dispose();
  }
});

test('restore recreates only a destroyed window and tray exit enters app.quit', () => {
  const app = {
    quitCalls: 0,
    quit() {
      this.quitCalls += 1;
    },
  };
  let window = null;
  let windowCreations = 0;
  let tray;
  const lifecycle = createDesktopLifecycle({
    app,
    createTray: (actions) => {
      tray = { ...actions, destroy() {} };
      return tray;
    },
    createWindow: () => {
      windowCreations += 1;
      window = createWindow();
      return window;
    },
    getWindow: () => window,
  });
  lifecycle.initializeTray();
  assert.equal(tray.onOpen(), true);
  assert.equal(windowCreations, 1);
  assert.equal(tray.onOpen(), true);
  assert.equal(windowCreations, 1);
  tray.onQuit();
  assert.equal(app.quitCalls, 1);
  assert.equal(lifecycle.markQuitting(), false);
  assert.equal(lifecycle.markQuitting(), false);
  assert.equal(fakeClose(window), false);
  lifecycle.dispose();
});

test('tray initialization failure records a safe error and lets close proceed', () => {
  const events = [];
  const window = createWindow();
  const lifecycle = createDesktopLifecycle({
    app: { quit() {} },
    createTray: () => {
      throw new Error('C:\\private\\path');
    },
    createWindow: () => window,
    getWindow: () => window,
    recordEvent: (event) => events.push(event),
  });
  assert.equal(lifecycle.initializeTray(), false);
  lifecycle.attachWindow(window);
  assert.equal(fakeClose(window), false);
  assert.deepEqual(
    events.map(({ operation, errorCode }) => [operation, errorCode]),
    [['tray.error', 'tray_initialization_failed']],
  );
  assert.equal(JSON.stringify(events).includes('private'), false);
});

test('diagnostic write failure cannot block lifecycle actions', () => {
  const app = {
    quitCalls: 0,
    quit() {
      this.quitCalls += 1;
    },
  };
  const window = createWindow();
  const lifecycle = createDesktopLifecycle({
    app,
    createTray: ({ onQuit }) => ({ onQuit, destroy() {} }),
    createWindow: () => window,
    getWindow: () => window,
    recordEvent: () => {
      throw new Error('diagnostic unavailable');
    },
  });
  assert.equal(lifecycle.initializeTray(), true);
  lifecycle.attachWindow(window);
  assert.equal(fakeClose(window), true);
  assert.equal(lifecycle.restoreWindow(), true);
  assert.doesNotThrow(() => lifecycle.markQuitting());
  assert.equal(lifecycle.hasTray, true);
  lifecycle.dispose();
});

test('Windows session end is bounded by the host shutdown owner', () => {
  const events = [];
  const window = createWindow();
  let shutdownRequests = 0;
  const lifecycle = createDesktopLifecycle({
    app: { quit() {} },
    createTray: () => ({ destroy() {} }),
    createWindow: () => window,
    getWindow: () => window,
    recordEvent: (event) => events.push(event),
    onSystemSessionEnd: () => {
      shutdownRequests += 1;
    },
  });
  lifecycle.attachWindow(window);
  assert.equal(fakeQuerySessionEnd(window), true);
  assert.equal(shutdownRequests, 1);
  assert.deepEqual(
    events.map(({ operation, status }) => [operation, status]),
    [['system-session-end.requested', 'observed']],
  );
});

test('shutdown waiter distinguishes fulfilled, rejected and timed-out services', async () => {
  const completed = await waitForDesktopShutdown(
    [
      async () => 'done',
      async () => {
        throw new Error('safe to retain only as a rejected state');
      },
    ],
    100,
  );
  assert.equal(completed.type, 'settled');
  assert.deepEqual(
    completed.results.map((result) => result.status),
    ['fulfilled', 'rejected'],
  );

  const timedOut = await waitForDesktopShutdown(
    [() => new Promise(() => {})],
    5,
  );
  assert.deepEqual(timedOut, { type: 'timeout' });
});
