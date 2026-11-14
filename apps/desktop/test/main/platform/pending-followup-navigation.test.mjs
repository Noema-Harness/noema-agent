import assert from 'node:assert/strict';
import test from 'node:test';
import { createPendingFollowupNavigationDelivery } from '../../../src/main/platform/pending-followup-navigation.mjs';

const firstTarget = { roomId: 'room-a', messageId: 'message-a' };
const secondTarget = { roomId: 'room-b', messageId: 'message-b' };

test('queues a target until the renderer is ready and dispatches it once', () => {
  const sent = [];
  const dispatched = [];
  const delivery = createPendingFollowupNavigationDelivery(
    (target) => {
      sent.push(target);
      return true;
    },
    (target) => dispatched.push(target),
  );

  assert.equal(delivery.request(firstTarget), false);
  assert.deepEqual(sent, []);
  assert.equal(delivery.markRendererReady(), true);
  assert.deepEqual(sent, [firstTarget]);
  assert.deepEqual(dispatched, [firstTarget]);
  assert.equal(delivery.markRendererReady(), false);
  assert.deepEqual(sent, [firstTarget]);
});

test('dispatches immediately after the renderer is ready', () => {
  const sent = [];
  const delivery = createPendingFollowupNavigationDelivery((target) => {
    sent.push(target);
    return true;
  });

  delivery.markRendererReady();
  assert.equal(delivery.request(firstTarget), true);
  assert.deepEqual(sent, [firstTarget]);
});

test('keeps the latest target while the renderer is unavailable', () => {
  const sent = [];
  const delivery = createPendingFollowupNavigationDelivery((target) => {
    sent.push(target);
    return true;
  });

  delivery.request(firstTarget);
  delivery.request(secondTarget);
  assert.deepEqual(sent, []);
  delivery.markRendererReady();
  assert.deepEqual(sent, [secondTarget]);
});

test('keeps a target when send fails and retries on the next ready signal', () => {
  const sent = [];
  let allowSend = false;
  const delivery = createPendingFollowupNavigationDelivery((target) => {
    sent.push(target);
    return allowSend;
  });

  delivery.markRendererReady();
  assert.equal(delivery.request(firstTarget), false);
  assert.deepEqual(sent, [firstTarget]);
  allowSend = true;
  assert.equal(delivery.markRendererReady(), true);
  assert.deepEqual(sent, [firstTarget, firstTarget]);
});

test('resetRenderer pauses delivery until the renderer is ready again', () => {
  const sent = [];
  const delivery = createPendingFollowupNavigationDelivery((target) => {
    sent.push(target);
    return true;
  });

  delivery.markRendererReady();
  delivery.resetRenderer();
  assert.equal(delivery.request(firstTarget), false);
  assert.deepEqual(sent, []);
  delivery.markRendererReady();
  assert.deepEqual(sent, [firstTarget]);
});

test('diagnostic callback failures do not block or repeat navigation', () => {
  const sent = [];
  const delivery = createPendingFollowupNavigationDelivery(
    (target) => {
      sent.push(target);
      return true;
    },
    () => {
      throw new Error('diagnostics unavailable');
    },
  );

  delivery.markRendererReady();
  assert.doesNotThrow(() => delivery.request(firstTarget));
  assert.deepEqual(sent, [firstTarget]);
  assert.equal(delivery.markRendererReady(), false);
});
