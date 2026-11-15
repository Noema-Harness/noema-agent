import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFollowupNavigationTarget } from '../../../src/renderer/chat/followup-navigation.ts';

const rooms = [{ id: 'room-noema' }, { id: 'room-project-origin' }];

test('keeps a live source room and message as the navigation target', () => {
  assert.deepEqual(
    resolveFollowupNavigationTarget(rooms, {
      roomId: 'room-project-origin',
      messageId: 'message-1',
    }),
    {
      room: { id: 'room-project-origin' },
      messageId: 'message-1',
    },
  );
});

test('opens the source room without a scroll target when its message was removed', () => {
  assert.deepEqual(
    resolveFollowupNavigationTarget(rooms, {
      roomId: 'room-project-origin',
      messageId: null,
    }),
    {
      room: { id: 'room-project-origin' },
      messageId: null,
    },
  );
});

test('falls back to the main chat when the source room was removed', () => {
  assert.deepEqual(
    resolveFollowupNavigationTarget(rooms, {
      roomId: 'deleted-room',
      messageId: 'deleted-message',
    }),
    { room: { id: 'room-noema' }, messageId: null },
  );
});

test('returns no target only when the main chat is unavailable too', () => {
  assert.deepEqual(
    resolveFollowupNavigationTarget([], {
      roomId: 'deleted-room',
      messageId: null,
    }),
    { room: null, messageId: null },
  );
});
