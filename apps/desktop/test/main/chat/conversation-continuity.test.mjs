import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createSocialTestStore } from '../../../test-support/social-team.mjs';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { SOCIAL_SCHEMA_VERSION } from '../../../src/main/chat/social-chat-schema.mjs';
import {
  backfillConversationContinuity,
  recoverContinuityTurns,
} from '../../../src/main/chat/conversation-continuity.mjs';

function makeStores() {
  const db = new Database(':memory:');
  new RootStore(db);
  return { db, social: createSocialTestStore(db) };
}

function addCompleteTurn(social, text) {
  const turn = social.beginTurn({
    roomId: 'room-noema',
    agentId: 'noema',
    text,
    model: 'test-model',
  });
  social.appendAssistantDelta(turn.assistantMessageId, `answer: ${text}`);
  social.completeReply(turn.assistantMessageId);
  return turn;
}

function rebuildContinuity(db) {
  db.exec(`
    DELETE FROM conversation_active_branch;
    DELETE FROM conversation_turns;
    DELETE FROM conversation_branches;
  `);
  backfillConversationContinuity(db);
}

test('schema 39 backfills one resident timeline with explicit project lead', () => {
  const { db, social } = makeStores();
  try {
    assert.equal(SOCIAL_SCHEMA_VERSION, 43);
    const turn = addCompleteTurn(social, 'first question');
    rebuildContinuity(db);

    const state = social.continuityGetState();
    assert.equal(state.mode, 'on');
    assert.equal(state.branches.length, 1);
    assert.equal(state.activeBranch.origin, 'main');
    assert.equal(state.activeBranch.readOnly, false);
    const continuityTurn = db
      .prepare('SELECT id, status FROM conversation_turns WHERE branch_id = ?')
      .get(state.activeBranch.id);
    assert.equal(state.activeBranch.turnCount, 1);
    assert.equal(state.activeBranch.headTurnId, continuityTurn.id);
    assert.equal(continuityTurn.status, 'complete');
    assert.equal(state.activeVersion, 0);
    assert.equal(turn.roomId, 'room-noema');

    const rows = db
      .prepare(
        `SELECT role, content FROM social_messages
         WHERE room_id = 'room-noema' ORDER BY seq`,
      )
      .all();
    assert.deepEqual(
      rows.map((row) => row.role),
      ['user', 'assistant'],
    );
    assert.equal(rows[0].content, 'first question');
    assert.equal(rows[1].content, 'answer: first question');
  } finally {
    db.close();
  }
});

test('edit creates a fork without deleting the original timeline', () => {
  const { db, social } = makeStores();
  try {
    addCompleteTurn(social, 'original question');
    addCompleteTurn(social, 'follow up');
    rebuildContinuity(db);
    const state = social.continuityGetState();

    const beforeMessages = db
      .prepare(`SELECT COUNT(*) AS count FROM social_messages`)
      .get().count;
    const fork = social.continuityCreateBranch({
      fromTurnId: state.activeBranch.headTurnId,
      title: 'edited branch',
    });
    assert.equal(fork.origin, 'fork');
    assert.equal(
      fork.parentBranchId,
      social.continuityGetState().activeBranchId,
    );
    assert.equal(fork.forkedFromTurnId, state.activeBranch.headTurnId);
    assert.equal(fork.headTurnId, state.activeBranch.headTurnId);
    assert.equal(fork.readOnly, false);

    const afterMessages = db
      .prepare(`SELECT COUNT(*) AS count FROM social_messages`)
      .get().count;
    assert.equal(afterMessages, beforeMessages);
    assert.equal(social.continuityListBranches().length, 2);
  } finally {
    db.close();
  }
});

test('editing a user message forks before its turn and preserves the old branch', () => {
  const previousMode = process.env.NOEMA_CONTINUITY_MODE;
  const { db, social } = makeStores();
  try {
    addCompleteTurn(social, 'first question');
    const second = addCompleteTurn(social, 'second question');
    rebuildContinuity(db);
    const original = social.continuityGetState();
    const beforeCount = db
      .prepare('SELECT COUNT(*) AS count FROM social_messages')
      .get().count;
    const secondTurn = db
      .prepare(
        'SELECT id, parent_turn_id AS parentTurnId FROM conversation_turns WHERE user_message_id = ?',
      )
      .get(second.userMessageId);

    const edited = social.continuityCreateEditBranch({
      messageId: second.userMessageId,
      title: 'edited second turn',
    });
    assert.notEqual(edited.activeBranchId, original.activeBranchId);
    assert.equal(edited.activeBranch.headTurnId, secondTurn.parentTurnId);
    assert.equal(edited.activeBranch.turnCount, 1);
    assert.equal(edited.activeBranch.forkedFromTurnId, secondTurn.id);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM social_messages').get().count,
      beforeCount,
    );

    process.env.NOEMA_CONTINUITY_MODE = 'on';
    const alternative = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'replacement second question',
      model: 'test-model',
    });
    social.appendAssistantDelta(
      alternative.assistantMessageId,
      'replacement answer',
    );
    social.completeReply(alternative.assistantMessageId);
    const snapshot = social.getRoomSnapshot('room-noema');
    assert.deepEqual(
      snapshot.messages.map((message) => message.content),
      [
        'first question',
        'answer: first question',
        'replacement second question',
        'replacement answer',
      ],
    );
    assert.ok(
      social
        .continuityListBranches()
        .some((branch) => branch.id === original.activeBranchId),
    );
  } finally {
    if (previousMode === undefined) delete process.env.NOEMA_CONTINUITY_MODE;
    else process.env.NOEMA_CONTINUITY_MODE = previousMode;
    db.close();
  }
});

test('branch switching uses compare-and-swap versions', () => {
  const { db, social } = makeStores();
  try {
    addCompleteTurn(social, 'original question');
    rebuildContinuity(db);
    const state = social.continuityGetState();
    const fork = social.continuityCreateBranch({
      fromTurnId: state.activeBranch.headTurnId,
    });

    const switched = social.continuitySwitchBranch({
      branchId: fork.id,
      expectedVersion: state.activeVersion,
    });
    assert.equal(switched.activeBranchId, fork.id);
    assert.equal(switched.activeVersion, state.activeVersion + 1);

    assert.throws(
      () =>
        social.continuitySwitchBranch({
          branchId: state.activeBranchId,
          expectedVersion: state.activeVersion,
        }),
      /continuity_version_conflict/,
    );
  } finally {
    db.close();
  }
});

test('incomplete turns cannot be forked', () => {
  const { db, social } = makeStores();
  try {
    const interrupted = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'interrupted question',
      model: 'test-model',
    });
    social.interruptReply(interrupted.assistantMessageId);
    rebuildContinuity(db);
    const interruptedTurn = db
      .prepare(
        `SELECT id FROM conversation_turns
         WHERE status = 'interrupted' LIMIT 1`,
      )
      .get();

    assert.throws(
      () => social.continuityCreateBranch({ fromTurnId: interruptedTurn.id }),
      /continuity_turn_not_complete/,
    );
  } finally {
    db.close();
  }
});

test('editing a user message in an interrupted turn forks before it', () => {
  const { db, social } = makeStores();
  try {
    const interrupted = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'interrupted question',
      model: 'test-model',
    });
    social.interruptReply(interrupted.assistantMessageId);
    rebuildContinuity(db);
    const interruptedTurn = db
      .prepare(
        `SELECT id, parent_turn_id AS parentTurnId
         FROM conversation_turns
         WHERE status = 'interrupted' LIMIT 1`,
      )
      .get();

    const edited = social.continuityCreateEditBranch({
      messageId: interrupted.userMessageId,
      title: 'retry interrupted question',
    });
    assert.equal(edited.activeBranch.title, 'retry interrupted question');
    assert.equal(edited.activeBranch.headTurnId, interruptedTurn.parentTurnId);
    assert.equal(edited.activeBranch.forkedFromTurnId, interruptedTurn.id);
    assert.equal(edited.activeBranch.turnCount, 0);
  } finally {
    db.close();
  }
});

test('shadow mode records pending and completed continuity turns', () => {
  const { db, social } = makeStores();
  try {
    const turn = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'shadow question',
      model: 'test-model',
    });
    const pending = db
      .prepare(
        `SELECT status FROM conversation_turns
         WHERE assistant_message_id = ?`,
      )
      .get(turn.assistantMessageId);
    assert.equal(pending.status, 'pending');

    social.appendAssistantDelta(turn.assistantMessageId, 'shadow answer');
    social.completeReply(turn.assistantMessageId);

    const completed = db
      .prepare(
        `SELECT id, status, checkpoint_at AS checkpointAt
         FROM conversation_turns
         WHERE assistant_message_id = ?`,
      )
      .get(turn.assistantMessageId);
    assert.equal(completed.status, 'complete');
    assert.ok(completed.checkpointAt);

    const state = social.continuityGetState();
    assert.equal(state.activeBranch.headTurnId, completed.id);
    assert.equal(state.activeBranch.headVersion, 1);
  } finally {
    db.close();
  }
});

test('startup recovery closes continuity turns left pending by a crash', () => {
  const { db, social } = makeStores();
  try {
    const turn = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'crashed question',
      model: 'test-model',
    });
    assert.equal(
      db
        .prepare(
          'SELECT status FROM conversation_turns WHERE assistant_message_id = ?',
        )
        .get(turn.assistantMessageId).status,
      'pending',
    );

    assert.equal(recoverContinuityTurns(db), 1);
    assert.equal(
      db
        .prepare(
          'SELECT status FROM conversation_turns WHERE assistant_message_id = ?',
        )
        .get(turn.assistantMessageId).status,
      'interrupted',
    );
    assert.ok(
      social
        .getRoomSnapshot('room-noema')
        .messages.some((message) => message.content === 'crashed question'),
    );
  } finally {
    db.close();
  }
});

test('on mode reads only the active branch ancestry', () => {
  const previousMode = process.env.NOEMA_CONTINUITY_MODE;
  const { db, social } = makeStores();
  try {
    addCompleteTurn(social, 'original question');
    addCompleteTurn(social, 'follow up');
    rebuildContinuity(db);
    const firstTurn = db
      .prepare('SELECT id FROM conversation_turns ORDER BY ordinal LIMIT 1')
      .get();

    const fork = social.continuityCreateBranch({
      fromTurnId: firstTurn.id,
      title: 'alternative',
    });
    social.continuitySwitchBranch({ branchId: fork.id });
    process.env.NOEMA_CONTINUITY_MODE = 'on';

    const alternative = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'alternative question',
      model: 'test-model',
    });
    social.appendAssistantDelta(
      alternative.assistantMessageId,
      'alternative answer',
    );
    social.completeReply(alternative.assistantMessageId);

    const snapshot = social.getRoomSnapshot('room-noema');
    assert.deepEqual(
      snapshot.messages.map((message) => message.content),
      [
        'original question',
        'answer: original question',
        'alternative question',
        'alternative answer',
      ],
    );
    const context = social.getContext('room-noema');
    const contextContents = context.map((entry) => entry.content);
    assert.ok(contextContents.includes('original question'));
    assert.ok(contextContents.includes('alternative question'));
    assert.ok(!contextContents.includes('follow up'));
  } finally {
    if (previousMode === undefined) delete process.env.NOEMA_CONTINUITY_MODE;
    else process.env.NOEMA_CONTINUITY_MODE = previousMode;
    db.close();
  }
});

test('on mode keeps the current pending turn visible', () => {
  const previousMode = process.env.NOEMA_CONTINUITY_MODE;
  const { db, social } = makeStores();
  try {
    addCompleteTurn(social, 'previous question');
    rebuildContinuity(db);
    process.env.NOEMA_CONTINUITY_MODE = 'on';

    const current = social.beginTurn({
      roomId: 'room-noema',
      agentId: 'noema',
      text: 'pending question',
      model: 'test-model',
    });
    const snapshot = social.getRoomSnapshot('room-noema');
    assert.ok(
      snapshot.messages.some(
        (message) => message.content === 'pending question',
      ),
    );

    social.appendAssistantDelta(current.assistantMessageId, 'pending answer');
    social.completeReply(current.assistantMessageId);
    const completed = social.getRoomSnapshot('room-noema');
    assert.equal(
      completed.messages.filter(
        (message) => message.content === 'pending question',
      ).length,
      1,
    );
  } finally {
    if (previousMode === undefined) delete process.env.NOEMA_CONTINUITY_MODE;
    else process.env.NOEMA_CONTINUITY_MODE = previousMode;
    db.close();
  }
});

test('legacy boundaries become read-only branches and latest stays writable', () => {
  const { db, social } = makeStores();
  try {
    addCompleteTurn(social, 'old question');
    social.createConversationBoundary();
    addCompleteTurn(social, 'new question');
    rebuildContinuity(db);

    const branches = social.continuityListBranches();
    const legacy = branches.find((branch) => branch.origin === 'legacy');
    const main = branches.find((branch) => branch.origin === 'main');
    assert.equal(branches.length, 2);
    assert.equal(legacy.readOnly, true);
    assert.equal(main.readOnly, false);
    assert.equal(social.continuityGetState().activeBranchId, main.id);
    assert.throws(
      () =>
        social.continuitySwitchBranch({
          branchId: legacy.id,
          expectedVersion: social.continuityGetState().activeVersion,
        }),
      /continuity_branch_read_only/u,
    );
    assert.equal(social.continuityGetState().activeBranchId, main.id);
  } finally {
    db.close();
  }
});
