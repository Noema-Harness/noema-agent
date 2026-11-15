import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  createSocialReplyNotificationHandler,
  createUserFollowupNotificationHandler,
} from '../../../src/main/platform/desktop-notifications.ts';

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
    handle({
      type: 'chat-turn-completed',
      roomId: 'private',
      messageId: 'm1',
      notifyUser: true,
    }),
    true,
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].shown, true);
  assert.deepEqual(notifications[0].options, {
    title: 'Noema',
    body: '有一条回复等你查看。',
    groupId: 'noema-replies',
    silent: true,
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
  let target = null;
  const handle = createSocialReplyNotificationHandler({
    NotificationClass,
    getWindow: () => null,
    openMainWindow: (next) => {
      opened++;
      target = next;
    },
  });

  handle({ type: 'chat-turn-completed', roomId: 'r', messageId: 'm' });
  assert.equal(notifications.length, 0);
  handle({
    type: 'chat-turn-completed',
    roomId: 'r',
    messageId: 'm',
    notifyUser: true,
  });
  notifications[0].emit('click');
  assert.equal(opened, 1);
  assert.deepEqual(target, { roomId: 'r', messageId: 'm' });
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

  assert.equal(
    handle({ type: 'chat-turn-completed', notifyUser: true }),
    false,
  );
});

test('suppresses internal and duplicate completed turns', () => {
  const { NotificationClass, notifications } = createNotificationClass();
  const handle = createSocialReplyNotificationHandler({
    NotificationClass,
    getWindow: () => null,
    openMainWindow() {},
  });
  const event = {
    type: 'chat-turn-completed',
    roomId: 'agent-session',
    messageId: 'm1',
    notifyUser: true,
  };
  assert.equal(handle({ ...event, notifyUser: false }), false);
  assert.equal(handle(event), true);
  assert.equal(handle(event), false);
  assert.equal(notifications.length, 1);
});

test('silent end-to-end clients never emit operating-system banners', () => {
  const { NotificationClass, notifications } = createNotificationClass();
  const handle = createSocialReplyNotificationHandler({
    NotificationClass,
    getWindow: () => null,
    openMainWindow() {},
    disabled: true,
  });

  assert.equal(
    handle({
      type: 'chat-turn-completed',
      roomId: 'room-noema',
      messageId: 'e2e-reply',
      notifyUser: true,
    }),
    false,
  );
  assert.equal(notifications.length, 0);
});

test('due follow-up notification click returns its stored source to Noema', () => {
  const { NotificationClass, notifications } = createNotificationClass();
  let destination = null;
  const handle = createUserFollowupNotificationHandler({
    NotificationClass,
    openMainWindow() {},
    openFollowupSource: (source) => {
      destination = source;
    },
  });

  assert.equal(
    handle({
      type: 'user-followup-due',
      id: 'followup-1',
      title: '跟进报价',
      body: '看看报价是否发来。',
      sourceRoomId: 'room-noema',
      sourceMessageId: 'source-message-1',
    }),
    true,
  );
  assert.deepEqual(notifications[0].options, {
    title: '跟进报价',
    body: '看看报价是否发来。',
    groupId: 'noema-followups',
    silent: true,
  });
  notifications[0].emit('click');
  assert.deepEqual(destination, {
    followupId: 'followup-1',
    sourceRoomId: 'room-noema',
    sourceMessageId: 'source-message-1',
  });
});

test('manual follow-up notification click opens Noema without a source', () => {
  const { NotificationClass, notifications } = createNotificationClass();
  let opened = 0;
  const handle = createUserFollowupNotificationHandler({
    NotificationClass,
    openMainWindow: () => opened++,
  });
  handle({
    type: 'user-followup-due',
    id: 'manual-followup',
    title: '手动提醒',
    body: '查看一下。',
  });
  notifications[0].emit('click');
  assert.equal(opened, 1);
});

test('does not notify for malformed, unrelated, unsupported, or silent-test events', () => {
  const { NotificationClass, notifications } = createNotificationClass();
  const handle = createUserFollowupNotificationHandler({
    NotificationClass,
    openMainWindow() {},
  });

  assert.equal(handle({ type: 'user-followup-due', id: 'x' }), false);
  assert.equal(handle({ type: 'chat-turn-completed', id: 'x' }), false);
  assert.equal(
    createUserFollowupNotificationHandler({
      NotificationClass,
      openMainWindow() {},
      disabled: true,
    })({
      type: 'user-followup-due',
      id: 'followup-1',
      title: '标题',
      body: '正文',
    }),
    false,
  );
  assert.equal(notifications.length, 0);
});
