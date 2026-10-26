import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createSocialReplyNotificationHandler } from '../src/desktop-notifications.mjs';

function createNotificationClass(supported = true) {
  const notifications = [];
  class FakeNotification extends EventEmitter {
    static isSupported() {
      return supported;
    }

    constructor(options) {
      super();
      this.options = options;
      this.shown = false;
      notifications.push(this);
    }

    show() {
      this.shown = true;
    }
  }

  return { NotificationClass: FakeNotification, notifications };
}

test('notifies once for a completed reply while Noema is out of focus', () => {
  const { NotificationClass, notifications } = createNotificationClass();
  const window = {
    isDestroyed: () => false,
    isFocused: () => false,
  };
  const handle = createSocialReplyNotificationHandler({
    NotificationClass,
    getWindow: () => window,
    openMainWindow() {},
  });

  assert.equal(
    handle({ type: 'chat-turn-completed', roomId: 'private', messageId: 'm1' }),
    true,
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].shown, true);
  assert.deepEqual(notifications[0].options, {
    title: 'Noema',
    body: '有一条新回复，打开 Noema 查看。',
  });
});

test('does not notify while the window is focused or when a reply failed', () => {
  const { NotificationClass, notifications } = createNotificationClass();
  const handle = createSocialReplyNotificationHandler({
    NotificationClass,
    getWindow: () => ({ isDestroyed: () => false, isFocused: () => true }),
    openMainWindow() {},
  });

  assert.equal(
    handle({ type: 'chat-turn-completed', roomId: 'r', messageId: 'm' }),
    false,
  );
  assert.equal(
    handle({ type: 'chat-turn-failed', roomId: 'r', messageId: 'm' }),
    false,
  );
  assert.equal(notifications.length, 0);
});

test('does not show empty or unsupported notifications', () => {
  const window = { isDestroyed: () => false, isFocused: () => false };
  const empty = createNotificationClass();
  const unsupported = createNotificationClass(false);

  assert.equal(
    createSocialReplyNotificationHandler({
      NotificationClass: empty.NotificationClass,
      getWindow: () => window,
      openMainWindow() {},
    })({ type: 'chat-turn-completed', empty: true }),
    false,
  );
  assert.equal(
    createSocialReplyNotificationHandler({
      NotificationClass: unsupported.NotificationClass,
      getWindow: () => window,
      openMainWindow() {},
    })({ type: 'chat-turn-completed' }),
    false,
  );
  assert.equal(empty.notifications.length, 0);
  assert.equal(unsupported.notifications.length, 0);
});

test('notification click reopens and focuses Noema through the supplied callback', () => {
  const { NotificationClass, notifications } = createNotificationClass();
  let opened = 0;
  const handle = createSocialReplyNotificationHandler({
    NotificationClass,
    getWindow: () => null,
    openMainWindow: () => opened++,
  });

  handle({ type: 'chat-turn-completed', roomId: 'r', messageId: 'm' });
  notifications[0].emit('click');
  assert.equal(opened, 1);
});

test('notification API failures never break chat event delivery', () => {
  class BrokenNotification {
    static isSupported() {
      return true;
    }

    constructor() {
      throw new Error('desktop notification unavailable');
    }
  }
  const handle = createSocialReplyNotificationHandler({
    NotificationClass: BrokenNotification,
    getWindow: () => null,
    openMainWindow() {},
  });

  assert.equal(handle({ type: 'chat-turn-completed' }), false);
});
