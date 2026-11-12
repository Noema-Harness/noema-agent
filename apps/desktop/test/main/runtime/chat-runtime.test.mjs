import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNativeChatRuntime,
  resolveChatRuntime,
} from '../../../src/main/runtime/chat-runtime.mjs';

test('native chat runtime forwards stream options to the provider', async () => {
  const calls = [];
  const runtime = createNativeChatRuntime({
    provider: {
      async *streamChat(options) {
        calls.push(options);
        yield 'hello';
      },
    },
  });
  const chunks = [];
  for await (const chunk of runtime.streamChat({ model: 'test-model' })) {
    chunks.push(chunk);
  }
  assert.deepEqual(chunks, ['hello']);
  assert.deepEqual(calls, [{ model: 'test-model' }]);
});

test('an explicit chat runtime wins over the provider', async () => {
  const runtime = {
    async *streamChat() {
      yield 'runtime';
    },
  };
  const resolved = resolveChatRuntime({
    runtime,
    provider: {
      async *streamChat() {
        yield 'provider';
      },
    },
  });
  const chunks = [];
  for await (const chunk of resolved.streamChat({})) chunks.push(chunk);
  assert.deepEqual(chunks, ['runtime']);
});

test('a malformed runtime fails closed', () => {
  assert.throws(
    () => resolveChatRuntime({ runtime: {}, provider: {} }),
    /must expose streamChat/u,
  );
});
