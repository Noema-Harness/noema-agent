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

test('reports follow-up navigation only after dispatch and isolates diagnostic failure', () => {
  const sent = [];
  const dispatched = [];
  const delivery = createPendingFollowupNavigationDelivery(
    (target) => {
      sent.push(target);
      return true;
    },
    (target) => {
      dispatched.push(target);
      throw new Error('diagnostics unavailable');
    },
  );

  delivery.request({
    roomId: 'room-noema',
    messageId: 'message-1',
    followupExecutionId: 'followup-execution-1',
  });
  assert.deepEqual(dispatched, []);
  assert.equal(delivery.markRendererReady(), true);
  assert.deepEqual(sent, [
    {
      roomId: 'room-noema',
      messageId: 'message-1',
      followupExecutionId: 'followup-execution-1',
    },
  ]);
  assert.deepEqual(dispatched, sent);
});
