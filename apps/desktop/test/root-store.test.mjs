import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RootStore } from '../src/root-store.mjs';

function memoryStore() {
  return new RootStore(':memory:');
}

test('root store migrates idempotently and persists the selected local model', () => {
  const store = memoryStore();
  assert.doesNotThrow(() => store.migrate());
  store.setSelectedModel('qwen3.5:4b-q4_K_M');
  assert.equal(store.getSelectedModel(), 'qwen3.5:4b-q4_K_M');
  store.close();
});

test('model context includes only the newest completed turns and reports what was omitted', () => {
  const store = memoryStore();
  for (const [text, reply] of [
    ['早期主题', '早期回复'],
    ['中间主题', '中间回复'],
    ['最近主题', '最近回复'],
  ]) {
    const turn = store.beginTurn({ text, model: 'qwen3.5:4b-q4_K_M' });
    store.appendAssistant({
      id: turn.id,
      attempt: turn.attempt,
      content: reply,
    });
    store.completeTurn(turn.id, turn.attempt);
  }
  const current = store.beginTurn({
    text: '继续最近主题',
    model: 'qwen3.5:4b-q4_K_M',
  });
  const context = store.getPromptContext(current.id, {
    maxTurns: 1,
    maxCharacters: 100,
  });

  assert.equal(context.includedTurns, 1);
  assert.equal(context.omittedTurns, 2);
  assert.deepEqual(
    context.messages.map(({ role, content }) => [role, content]),
    [
      ['user', '最近主题'],
      ['assistant', '最近回复'],
      ['user', '继续最近主题'],
    ],
  );
  store.close();
});

test('a retry reuses the original user message and preserves the interrupted response', () => {
  const store = memoryStore();
  const first = store.beginTurn({
    text: '继续刚才的话题',
    model: 'qwen3.5:4b-q4_K_M',
  });
  store.appendAssistant({
    id: first.id,
    attempt: first.attempt,
    content: '第一段未完成',
  });
  store.interruptTurn(first.id, first.attempt);

  const retry = store.retryTurn(first.id, 'qwen3.5:9b');
  store.appendAssistant({
    id: retry.id,
    attempt: retry.attempt,
    content: '完整的新回复',
  });
  store.completeTurn(retry.id, retry.attempt);

  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.messages.filter((message) => message.role === 'user').length,
    1,
  );
  assert.deepEqual(
    snapshot.messages
      .filter((message) => message.role === 'assistant')
      .map((message) => [message.content, message.status]),
    [
      ['第一段未完成', 'interrupted'],
      ['完整的新回复', 'complete'],
    ],
  );
  assert.equal(store.getTurn(first.id).attempt, 2);
  assert.deepEqual(store.getPromptMessages(first.id), [
    { role: 'user', content: '继续刚才的话题' },
  ]);
  store.close();
});

test('user content is parameterized and does not execute as SQL', () => {
  const store = memoryStore();
  const injection = "'); DROP TABLE root_messages;--";
  store.beginTurn({ text: injection, model: null });
  assert.equal(store.getSnapshot().messages[0].content, injection);
  assert.equal(
    store.db.prepare('SELECT count(*) AS total FROM root_messages').get().total,
    2,
  );
  store.close();
});

test('an application restart turns an in-flight response into a recoverable interruption', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-root-store-'));
  const file = path.join(directory, 'root.sqlite3');
  try {
    let store = new RootStore(file);
    const turn = store.beginTurn({
      text: '这条回复会在应用关闭时中断',
      model: 'qwen3.5:4b-q4_K_M',
    });
    store.appendAssistant({
      id: turn.id,
      attempt: turn.attempt,
      content: '已输出部分内容',
    });
    store.close();

    store = new RootStore(file);
    assert.equal(store.recoverActiveTurns(), 1);
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.activeTurnId, null);
    assert.equal(snapshot.messages[1].status, 'interrupted');
    assert.equal(snapshot.messages[1].content, '已输出部分内容');
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
