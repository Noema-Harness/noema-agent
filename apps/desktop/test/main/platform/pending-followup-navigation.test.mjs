import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingFollowupNavigationDelivery } from '../../../src/main/platform/pending-followup-navigation.mjs';

test('holds the latest notification target until the social renderer is ready', () => {
  const sent = [];
  const delivery = createPendingFollowupNavigationDelivery((target) => {
    sent.push(target);
    return true;
  });

  assert.equal(
    delivery.request({ roomId: 'room-old', messageId: 'message-old' }),
    false,
  );
  assert.equal(
    delivery.request({ roomId: 'room-current', messageId: 'message-current' }),
    false,
  );
  assert.deepEqual(sent, []);
  assert.equal(delivery.markRendererReady(), true);
  assert.deepEqual(sent, [
    { roomId: 'room-current', messageId: 'message-current' },
  ]);
  assert.equal(delivery.markRendererReady(), false);
});

test('retains a target when the renderer is unavailable and sends it after recovery', () => {
  const sent = [];
  let available = false;
  const delivery = createPendingFollowupNavigationDelivery((target) => {
    if (!available) return false;
    sent.push(target);
    return true;
  });
  delivery.markRendererReady();

  assert.equal(
    delivery.request({ roomId: 'room-noema', messageId: 'm1' }),
    false,
  );
  delivery.resetRenderer();
  available = true;
  assert.equal(delivery.markRendererReady(), true);
  assert.deepEqual(sent, [{ roomId: 'room-noema', messageId: 'm1' }]);
});
