import assert from 'node:assert/strict';
import test from 'node:test';
import {
  visibleTimelineTurn,
  visibleTimelineTurns,
} from '../../../src/shared/chat/timeline-visibility.mjs';

const user = { kind: 'message', message: { role: 'user', text: 'hello' } };
const assistant = {
  kind: 'message',
  message: { role: 'assistant', text: 'hi' },
};
const system = {
  kind: 'message',
  message: { role: 'system', text: 'context' },
};
const tool = { kind: 'tool', name: 'read_file' };

test('a turn containing only system messages disappears from the timeline', () => {
  const turns = [{ id: 'turn-1', items: [system] }];
  assert.deepEqual(visibleTimelineTurns(turns), []);
  assert.deepEqual(visibleTimelineTurn(turns[0]), { id: 'turn-1', items: [] });
});

test('user and assistant messages keep their order while system and tool items are removed', () => {
  const turns = [{ id: 'turn-1', items: [tool, system, user, assistant] }];
  assert.deepEqual(visibleTimelineTurns(turns), [
    { id: 'turn-1', items: [user, assistant] },
  ]);
});

test('empty or tool-only turns are removed without mutating the source', () => {
  const turns = [
    { id: 'empty', items: [] },
    { id: 'tools', items: [tool] },
    { id: 'messages', items: [user] },
  ];
  const before = structuredClone(turns);
  assert.deepEqual(visibleTimelineTurns(turns), [
    { id: 'messages', items: [user] },
  ]);
  assert.deepEqual(turns, before);
});

test('filtering preserves unrelated turn metadata', () => {
  const turns = [
    {
      id: 'turn-1',
      createdAt: 'now',
      status: 'running',
      items: [user, system],
    },
  ];
  assert.deepEqual(visibleTimelineTurns(turns), [
    { id: 'turn-1', createdAt: 'now', status: 'running', items: [user] },
  ]);
});
