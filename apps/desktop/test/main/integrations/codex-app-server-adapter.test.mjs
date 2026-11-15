import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractVisibleMessages,
  resolveCodexExecutable,
} from '../../../src/main/integrations/codex-app-server-adapter.ts';

test('only visible user text and assistant messages are eligible for import', () => {
  const result = extractVisibleMessages([
    {
      status: 'completed',
      items: [
        {
          type: 'userMessage',
          content: [
            { type: 'text', text: '检查这段代码。' },
            { type: 'localImage', path: 'D:\\private\\diagram.png' },
          ],
        },
        { type: 'reasoning', text: '隐藏推理不应进入快照' },
        { type: 'commandExecution', command: 'hidden command' },
        { type: 'agentMessage', text: '我发现一个空指针风险。' },
      ],
    },
    {
      status: 'inProgress',
      items: [{ type: 'agentMessage', text: '未完成的流不导入' }],
    },
  ]);

  assert.deepEqual(result.messages, [
    { role: 'user', content: '检查这段代码。' },
    { role: 'assistant', content: '我发现一个空指针风险。' },
  ]);
  assert.equal(result.omittedItems, 3);
  assert.equal(result.omittedTurns, 1);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('隐藏推理'), false);
});

test('large Codex history is kept within the preview budget by omitting older whole messages', () => {
  const result = extractVisibleMessages([
    {
      status: 'completed',
      items: [
        {
          type: 'userMessage',
          content: [{ type: 'text', text: 'old'.repeat(4_000) }],
        },
        { type: 'agentMessage', text: 'old reply'.repeat(1_500) },
        {
          type: 'userMessage',
          content: [{ type: 'text', text: 'current task'.repeat(80) }],
        },
        { type: 'agentMessage', text: 'recent'.repeat(800) },
      ],
    },
  ]);
  assert.ok(result.characterCount <= 10_000);
  assert.equal(result.omittedMessages, 2);
  assert.equal(result.messages.at(-2).role, 'user');
  assert.match(result.messages.at(-2).content, /^current task/);
  assert.equal(result.messages.at(-1).role, 'assistant');
});

test('does not import a suffix that drops the latest user request', () => {
  assert.throws(
    () =>
      extractVisibleMessages([
        {
          status: 'completed',
          items: [
            {
              type: 'userMessage',
              content: [{ type: 'text', text: 'x'.repeat(10_001) }],
            },
          ],
        },
      ]),
    /最近一条 Codex 用户消息.*超出导入上限/,
  );
  assert.throws(
    () =>
      extractVisibleMessages([
        {
          status: 'completed',
          items: [
            {
              type: 'userMessage',
              content: [{ type: 'localImage', path: 'private.png' }],
            },
          ],
        },
      ]),
    /没有可导入的完整用户文字消息/,
  );
});

test('Codex discovery is unavailable outside its known Windows desktop install unless explicitly configured', () => {
  assert.equal(
    resolveCodexExecutable({
      platform: 'linux',
      env: { LOCALAPPDATA: '/tmp' },
    }),
    null,
  );
  assert.equal(
    resolveCodexExecutable({
      platform: 'win32',
      env: { LOCALAPPDATA: 'Z:\\missing' },
    }),
    null,
  );
});
