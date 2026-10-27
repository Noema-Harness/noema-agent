import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatStore } from '../src/social-chat-store.mjs';
import {
  FIRST_MEETING_LETTER,
  firstMeetingContext,
} from '../src/first-meeting.mjs';

test('first meeting survives reopening and never fabricates a conversation', () => {
  const db = new Database(':memory:');
  try {
    new RootStore(db);
    const store = new SocialChatStore(db);
    assert.equal(store.getFirstMeetingState().stage, 'letter');
    assert.equal(store.getFirstMeetingContext(), '');
    const read = store.advanceFirstMeeting('read');
    assert.equal(read.stage, 'encounter');
    assert.ok(read.introducedAt);
    const reopened = new SocialChatStore(db);
    assert.deepEqual(reopened.getFirstMeetingState(), read);
    const entered = reopened.advanceFirstMeeting('enter');
    assert.equal(entered.stage, 'complete');
    assert.equal(entered.introducedAt, read.introducedAt);
    assert.deepEqual(reopened.advanceFirstMeeting('read'), entered);
    assert.equal(reopened.getRoomSnapshot('room-noema').messages.length, 0);
    assert.match(reopened.getFirstMeetingContext(), /不是你的发言/u);
    assert.ok(
      reopened.getFirstMeetingContext().includes(FIRST_MEETING_LETTER[0]),
    );
    assert.throws(() => reopened.advanceFirstMeeting('reset'), /无法识别/u);
  } finally {
    db.close();
  }
});

test('existing user history is not gated or silently assigned a meeting', () => {
  const db = new Database(':memory:');
  try {
    new RootStore(db);
    const store = new SocialChatStore(db);
    store.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: '旧的真实对话。',
      model: 'test',
    });
    assert.equal(store.getFirstMeetingState().stage, 'complete');
    assert.equal(store.getFirstMeetingState().introducedAt, null);
    assert.equal(store.getFirstMeetingContext(), '');
    assert.equal(
      store
        .getRoomSnapshot('room-noema')
        .messages.filter((m) => m.role === 'user').length,
      1,
    );
  } finally {
    db.close();
  }
});

test('creator introduction leaves the prompt after early turns; orientation stays bounded', () => {
  const state = { version: 1, introducedAt: '2026-10-28T00:00:00.000Z' };
  assert.ok(firstMeetingContext(state, 2).includes(FIRST_MEETING_LETTER[0]));
  const later = firstMeetingContext(state, 9);
  assert.match(later, /理解先于有用/u);
  assert.ok(!later.includes(FIRST_MEETING_LETTER[0]));
  assert.ok(later.length < 300);
});
