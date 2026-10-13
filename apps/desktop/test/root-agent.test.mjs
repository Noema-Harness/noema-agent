import assert from 'node:assert/strict';
import test from 'node:test';
import { FreeLLMAPIError } from '../src/freellmapi-client.mjs';
import { RootAgent } from '../src/root-agent.mjs';
import { RootStore } from '../src/root-store.mjs';

function createSecretStore(configured = true) {
  return {
    value: configured ? 'test-key' : null,
    isConfigured() {
      return this.value !== null;
    },
    get() {
      return this.value;
    },
    set(value) {
      this.value = value;
    },
    setConfiguration({ apiKey, baseUrl }) {
      this.value = apiKey;
      this.baseUrl = baseUrl;
    },
    clear() {
      this.value = null;
    },
  };
}

test('streams a FreeLLMAPI response into the persistent root turn', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('free-router');
  let sent;
  const events = [];
  const provider = {
    baseUrl: 'http://127.0.0.1:31415/v1',
    listModels: async () => [
      { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
    ],
    async *streamChat(input) {
      sent = input;
      yield '你好';
      yield '，这里是 Noema。';
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
    emit: (event) => events.push(event),
  });
  const { turnId } = agent.sendMessage({ text: '你好' });
  await agent.active.done;

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.messages.length, 2);
  assert.equal(snapshot.messages[1].content, '你好，这里是 Noema。');
  assert.equal(snapshot.messages[1].turnStatus, 'completed');
  assert.equal(sent.model, 'free-router');
  assert.equal(sent.messages.at(-1).content, '你好');
  assert.ok(!('numCtx' in sent));
  assert.ok(
    events.some(
      (event) => event.type === 'turn-completed' && event.turnId === turnId,
    ),
  );
  store.close();
});

test('preserves a failed user message and retries it without duplicating the user turn', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('retired-model');
  const provider = {
    listModels: async () => [
      { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
    ],
    async *streamChat() {
      yield '可用免费模型回复';
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
  });
  const { turnId } = agent.sendMessage({ text: '这条消息不能丢' });
  await agent.active.done;
  assert.equal(store.getTurn(turnId).status, 'failed');

  agent.retryTurn({ turnId, model: 'free-router' });
  await agent.active.done;
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.messages.filter((message) => message.role === 'user').length,
    1,
  );
  assert.equal(snapshot.messages.at(-1).content, '可用免费模型回复');
  assert.equal(store.getTurn(turnId).status, 'completed');
  store.close();
});

test('stopping a response records an interruption and preserves partial text', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('free-router');
  const provider = {
    listModels: async () => [
      { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
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
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
  });
  const { turnId } = agent.sendMessage({ text: '停止这条回复' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await agent.stopTurn(turnId), true);
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.messages[1].status, 'interrupted');
  assert.equal(snapshot.messages[1].content, '先保存这一段');
  store.close();
});

test('preserves a user turn on free-provider rate limits without changing routes', async () => {
  const store = new RootStore(':memory:');
  store.setSelectedModel('nvidia/nemotron-3-super-120b-a12b:free');
  let requestedModel;
  const provider = {
    listModels: async () => [
      {
        name: 'nvidia/nemotron-3-super-120b-a12b:free',
        label: 'Nemotron 3 Super 120B · 免费',
      },
    ],
    async *streamChat({ model }) {
      requestedModel = model;
      yield await Promise.reject(
        new FreeLLMAPIError(
          'rate_limited',
          'FreeLLMAPI 免费模型额度暂时受限。稍后重试。',
          429,
        ),
      );
    },
  };
  const agent = new RootAgent({
    store,
    provider,
    secretStore: createSecretStore(),
  });
  agent.sendMessage({ text: '这条消息要在限流后保留' });
  await agent.active.done;

  const snapshot = store.getSnapshot();
  assert.equal(requestedModel, 'nvidia/nemotron-3-super-120b-a12b:free');
  assert.equal(
    snapshot.messages.filter((message) => message.role === 'user').length,
    1,
  );
  assert.equal(snapshot.messages[0].content, '这条消息要在限流后保留');
  assert.equal(snapshot.messages.at(-1).turnStatus, 'failed');
  assert.equal(
    snapshot.messages.at(-1).errorMessage,
    'FreeLLMAPI 免费模型额度暂时受限。稍后重试。',
  );
  store.close();
});

test('stores FreeLLMAPI connection status without exposing the API key', async () => {
  const store = new RootStore(':memory:');
  const secretStore = createSecretStore(false);
  const provider = {
    baseUrl: 'http://127.0.0.1:3001/v1',
    setBaseUrl(value) {
      this.baseUrl = value;
    },
    listModels: async () => [
      { name: 'free-router', label: 'FreeLLMAPI 免费路由' },
    ],
  };
  const agent = new RootAgent({ store, provider, secretStore });
  const state = await agent.configureProvider({
    baseUrl: 'http://127.0.0.1:31415',
    apiKey: 'sensitive-test-key',
  });
  assert.equal(secretStore.get(), 'sensitive-test-key');
  assert.equal(secretStore.baseUrl, 'http://127.0.0.1:31415/v1');
  assert.equal(state.connected, true);
  assert.equal(state.providerConfigured, true);
  assert.equal(state.providerBaseUrl, 'http://127.0.0.1:31415/v1');
  assert.equal(
    JSON.stringify(await agent.getUiState()).includes('sensitive-test-key'),
    false,
  );
  store.close();
});
