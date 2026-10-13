import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RootStore } from '../src/root-store.mjs';

function memoryStore() {
  return new RootStore(':memory:');
}

test('root store migrates idempotently and persists the selected model', () => {
  const store = memoryStore();
  assert.doesNotThrow(() => store.migrate());
  store.setSelectedModel('free-router');
  assert.equal(store.getSelectedModel(), 'free-router');
  store.close();
});

test('background task records DSH ownership and a separate root event response', () => {
  const store = memoryStore();
  const turn = store.beginTurn({
    text: '把这个文件修改交给后台',
    model: 'free-router',
  });
  const task = store.createBackgroundTask({
    id: 'task-1',
    sourceTurnId: turn.id,
    workspacePath: 'D:\\Scratch',
    model: 'free-router',
    prompt: 'Only edit the selected file.',
  });

  assert.equal(task.status, 'starting');
  assert.equal(task.sessionId, null);
  store.setBackgroundTaskSession(task.id, 'session-1');
  store.updateBackgroundTaskProgress(task.id, {
    phase: 'step_start',
    toolCallCount: 1,
  });
  const running = store.getBackgroundTask(task.id);
  assert.equal(running.sessionId, 'session-1');
  assert.equal(running.status, 'running');
  assert.equal(running.toolCallCount, 1);

  store.finishBackgroundTask(task.id, {
    status: 'completed',
    resultText: 'Edited one file.',
    exitCode: 0,
    sessionId: 'session-1',
    toolCallCount: 1,
  });
  assert.equal(store.getNextPendingBackgroundEvent().id, task.id);
  assert.equal(
    store.beginBackgroundEventResponse(task.id, 'free-router'),
    true,
  );
  store.appendBackgroundEventResponse(task.id, 'Noema received the result.');
  store.completeBackgroundEventResponse(task.id);

  const finished = store.getBackgroundTask(task.id);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.eventStatus, 'delivered');
  assert.equal(finished.noemaResponseStatus, 'complete');
  assert.equal(finished.noemaResponse, 'Noema received the result.');
  assert.equal(store.getNextPendingBackgroundEvent(), null);
  store.close();
});

test('future root context retains a delivered worker event as system data, not a user turn', () => {
  const store = memoryStore();
  const dispatchedTurn = store.beginTurn({
    text: '把 README 的安装说明交给后台处理。',
    model: 'auto:noema-free',
  });
  store.appendAssistant({
    id: dispatchedTurn.id,
    attempt: dispatchedTurn.attempt,
    content: '任务已交给后台 DSH agent。',
  });
  store.completeTurn(dispatchedTurn.id, dispatchedTurn.attempt);
  const task = store.createBackgroundTask({
    id: 'task-context',
    sourceTurnId: dispatchedTurn.id,
    workspacePath: 'D:\\Scratch',
    model: 'auto:noema-free',
    prompt: '只修改 README 安装说明。',
  });
  store.finishBackgroundTask(task.id, {
    status: 'completed',
    resultText: 'README 第 1 行已更新。',
    sessionId: 'session-context',
    toolCallCount: 1,
  });
  store.beginBackgroundEventResponse(task.id, 'auto:noema-free');
  store.appendBackgroundEventResponse(task.id, '安装说明已更新。');
  store.completeBackgroundEventResponse(task.id);

  const next = store.beginTurn({
    text: '刚才后台任务做完了吗？',
    model: 'auto:noema-free',
  });
  const context = store.getPromptContext(next.id);
  assert.deepEqual(
    context.messages.map((message) => message.role),
    ['user', 'assistant', 'system', 'user'],
  );
  assert.match(context.messages[2].content, /background_task_result/);
  assert.match(context.messages[2].content, /安装说明已更新/);
  assert.equal(context.messages[2].content.includes('D:\\Scratch'), false);
  assert.equal(context.messages[2].role, 'system');
  assert.ok(context.historyCharacters > 0);
  store.close();
});

test('model context includes only the newest completed turns and reports what was omitted', () => {
  const store = memoryStore();
  for (const [text, reply] of [
    ['早期主题', '早期回复'],
    ['中间主题', '中间回复'],
    ['最近主题', '最近回复'],
  ]) {
    const turn = store.beginTurn({ text, model: 'free-router' });
    store.appendAssistant({
      id: turn.id,
      attempt: turn.attempt,
      content: reply,
    });
    store.completeTurn(turn.id, turn.attempt);
  }
  const current = store.beginTurn({
    text: '继续最近主题',
    model: 'free-router',
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
    model: 'free-router',
  });
  store.appendAssistant({
    id: first.id,
    attempt: first.attempt,
    content: '第一段未完成',
  });
  store.interruptTurn(first.id, first.attempt);

  const retry = store.retryTurn(
    first.id,
    'nvidia/nemotron-3-super-120b-a12b:free',
  );
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
      model: 'free-router',
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

test('an application restart interrupts a running DSH worker and queues its event', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-worker-store-'));
  const file = path.join(directory, 'root.sqlite3');
  try {
    let store = new RootStore(file);
    const turn = store.beginTurn({
      text: '委派一个后台任务',
      model: 'free-router',
    });
    const task = store.createBackgroundTask({
      id: 'task-restart',
      sourceTurnId: turn.id,
      workspacePath: 'D:\\Scratch',
      model: 'free-router',
      prompt: 'Inspect the test file.',
    });
    store.setBackgroundTaskSession(task.id, 'session-restart');
    store.close();

    store = new RootStore(file);
    assert.equal(store.recoverActiveTurns(), 1);
    const recovered = store.getBackgroundTask(task.id);
    assert.equal(recovered.status, 'interrupted');
    assert.equal(recovered.eventStatus, 'pending');
    assert.equal(recovered.sessionId, 'session-restart');
    assert.equal(store.getNextPendingBackgroundEvent().id, task.id);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
