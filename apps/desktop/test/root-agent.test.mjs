import assert from 'node:assert/strict';
import test from 'node:test';
import { RootAgent } from '../src/root-agent.mjs';
import { RootStore } from '../src/root-store.mjs';

test('streams a local response into the persistent root turn', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('qwen3.5:4b-q4_K_M');
  let sent;
  const events = [];
  const ollama = {
    listModels: async () => [
      { name: 'qwen3.5:4b-q4_K_M', size: 1, modifiedAt: null },
    ],
    async *streamChat(input) {
      sent = input;
      yield '你好';
      yield '，这里是 Noema。';
    },
  };
  const agent = new RootAgent({
    store,
    ollama,
    emit: (event) => events.push(event),
  });
  const { turnId } = agent.sendMessage({ text: '你好' });
  await agent.active.done;

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.messages.length, 2);
  assert.equal(snapshot.messages[1].content, '你好，这里是 Noema。');
  assert.equal(snapshot.messages[1].turnStatus, 'completed');
  assert.equal(sent.model, 'qwen3.5:4b-q4_K_M');
  assert.equal(sent.messages.at(-1).content, '你好');
  assert.equal(sent.numCtx, 16_384);
  assert.ok(
    events.some(
      (event) => event.type === 'turn-completed' && event.turnId === turnId,
    ),
  );
  store.close();
});

test('preserves a failed user message and retries it without duplicating the user turn', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('qwen3:missing');
  const ollama = {
    listModels: async () => [
      { name: 'qwen3.5:4b-q4_K_M', size: 1, modifiedAt: null },
    ],
    async *streamChat() {
      yield '可用模型回复';
    },
  };
  const agent = new RootAgent({ store, ollama });
  const { turnId } = agent.sendMessage({ text: '这条消息不能丢' });
  await agent.active.done;
  assert.equal(store.getTurn(turnId).status, 'failed');

  agent.retryTurn({ turnId, model: 'qwen3.5:4b-q4_K_M' });
  await agent.active.done;
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.messages.filter((message) => message.role === 'user').length,
    1,
  );
  assert.equal(snapshot.messages.at(-1).content, '可用模型回复');
  assert.equal(store.getTurn(turnId).status, 'completed');
  store.close();
});

test('stopping a response records an interruption and preserves partial text', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('qwen3.5:4b-q4_K_M');
  const ollama = {
    listModels: async () => [
      { name: 'qwen3.5:4b-q4_K_M', size: 1, modifiedAt: null },
    ],
    async *streamChat({ signal }) {
      yield '先保存这一段';
      await new Promise((resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    },
  };
  const agent = new RootAgent({ store, ollama });
  const { turnId } = agent.sendMessage({ text: '停止这条回复' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await agent.stopTurn(turnId), true);
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.messages[1].status, 'interrupted');
  assert.equal(snapshot.messages[1].content, '先保存这一段');
  store.close();
});
