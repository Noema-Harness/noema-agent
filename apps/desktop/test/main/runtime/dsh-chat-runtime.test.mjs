import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DshChatRuntime,
  renderChatTask,
} from '../../../src/main/runtime/dsh-chat-runtime.ts';

function adapterWith(result, calls = []) {
  return {
    async startTask(input) {
      calls.push(input);
      return {
        started: Promise.resolve({ sessionId: 'session-1' }),
        done: Promise.resolve(result),
        stop() {
          return true;
        },
      };
    },
  };
}

test('renders a bounded, role-labelled conversation for DSH', () => {
  const task = renderChatTask([
    { role: 'system', content: 'stable instructions' },
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ]);
  assert.match(task, /系统：/u);
  assert.match(task, /用户：\nhello/u);
  assert.match(task, /Noema：\nhi/u);
});

test('DSH chat runtime yields the completed final text', async () => {
  const calls = [];
  const runtime = new DshChatRuntime({
    adapter: adapterWith(
      { status: 'completed', result: 'final answer' },
      calls,
    ),
    workspacePath: 'C:\\workspace',
    model: 'deepseek-flash',
  });
  const chunks = [];
  for await (const chunk of runtime.streamChat({
    messages: [{ role: 'user', content: 'hello' }],
  })) {
    chunks.push(chunk);
  }
  assert.deepEqual(chunks, ['final answer']);
  assert.equal(calls.length, 1);
  assert.match(calls[0].task, /hello/u);
  assert.equal(calls[0].model, 'deepseek-flash');
  assert.equal(calls[0].profile, 'noema');
});

test('DSH chat runtime reuses the session and sends only the next user turn', async () => {
  const calls = [];
  const sessions = [];
  const runtime = new DshChatRuntime({
    adapter: adapterWith(
      { status: 'completed', result: 'first answer' },
      calls,
    ),
    workspacePath: 'C:\\workspace',
    model: 'deepseek-flash',
    onSessionId: (id) => sessions.push(id),
  });
  for await (const _ of runtime.streamChat({
    messages: [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second question' },
    ],
  })) {
    // consume
  }
  assert.deepEqual(sessions, ['session-1']);
  assert.equal(calls[0].sessionId, null);
  assert.match(calls[0].task, /first question/u);

  for await (const _ of runtime.streamChat({
    messages: [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second question' },
    ],
  })) {
    // consume
  }
  assert.equal(calls[1].sessionId, 'session-1');
  assert.match(calls[1].task, /second question/u);
  assert.doesNotMatch(calls[1].task, /first question/u);

  runtime.resetSession();
  for await (const _ of runtime.streamChat({
    messages: [
      { role: 'user', content: 'old polluted question' },
      { role: 'assistant', content: 'old polluted answer' },
      { role: 'user', content: 'clean question' },
    ],
  })) {
    // consume
  }
  assert.equal(calls[2].sessionId, null);
  assert.match(calls[2].task, /clean question/u);
  assert.doesNotMatch(calls[2].task, /old polluted/u);
});

test('DSH chat runtime attaches the Noema MCP tool session', async () => {
  const calls = [];
  const descriptor = {
    serverName: 'noema',
    url: 'http://127.0.0.1:1234/mcp',
    headers: { Authorization: 'Bearer token' },
  };
  const runtime = new DshChatRuntime({
    adapter: adapterWith(
      { status: 'completed', result: 'final answer' },
      calls,
    ),
    workspacePath: 'C:\\workspace',
    model: 'deepseek-flash',
    toolSession: { descriptor },
  });
  for await (const _ of runtime.streamChat({
    messages: [{ role: 'user', content: 'hello' }],
  })) {
    // consume
  }
  assert.deepEqual(calls[0].mcpServers, [descriptor]);
});

test('DSH chat runtime fails closed on an unsuccessful run', async () => {
  const runtime = new DshChatRuntime({
    adapter: adapterWith({
      status: 'failed',
      errorCode: 'dsh_provider_rejected',
      errorMessage: 'provider rejected',
    }),
    workspacePath: 'C:\\workspace',
    model: 'deepseek-flash',
  });
  await assert.rejects(async () => {
    for await (const _ of runtime.streamChat({
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      // consume
    }
  }, /provider rejected/u);
});
