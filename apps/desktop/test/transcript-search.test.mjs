import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findTranscriptMatches,
  searchTranscriptHistory,
} from '../src/transcript-search.mjs';

const messages = [
  {
    id: 'user-1',
    role: 'user',
    content: '我们之后要验证 Noema 的长期对话是否好找。',
    createdAt: '2026-10-15T08:00:00.000Z',
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    content: '检索只读取本地已保存的原文，不会修改模型上下文。',
    createdAt: '2026-10-15T08:00:01.000Z',
  },
];

test('search is case-insensitive, trims whitespace, and preserves timeline order', () => {
  assert.deepEqual(findTranscriptMatches(messages, '  NOEMA '), [
    {
      id: 'user-1',
      role: 'user',
      createdAt: '2026-10-15T08:00:00.000Z',
      snippet: '我们之后要验证 Noema 的长期对话是否好找。',
    },
  ]);
});

test('search supports direct Chinese substring matches and returns a bounded excerpt', () => {
  const longMessage = {
    ...messages[1],
    content: `${'前文'.repeat(40)}独立核验结果${'后文'.repeat(40)}`,
  };
  const [match] = findTranscriptMatches([longMessage], '核验结果');

  assert.equal(match.id, 'assistant-1');
  assert.match(match.snippet, /^…/);
  assert.match(match.snippet, /核验结果/);
  assert.match(match.snippet, /…$/);
  assert.ok(match.snippet.length < longMessage.content.length);
});

test('empty or unmatched queries do not produce results', () => {
  assert.deepEqual(findTranscriptMatches(messages, '  '), []);
  assert.deepEqual(findTranscriptMatches(messages, '不存在的词'), []);
});

test('agent history search finds a bounded source outside the recent context', () => {
  const transcript = [
    {
      ...messages[0],
      id: 'old-user-message',
      turnId: 'old-turn',
      status: 'complete',
      turnStatus: 'completed',
      content:
        '我后来让模型用体素化工具生成 Minecraft 模组模型的碰撞箱，这次才稳定。',
    },
    ...Array.from({ length: 12 }, (_, index) => ({
      ...messages[1],
      id: `recent-${index}`,
      turnId: `recent-turn-${index}`,
      status: 'complete',
      turnStatus: 'completed',
      content: `最近讨论了普通事项 ${index}。`,
    })),
    {
      ...messages[1],
      id: 'current-user-message',
      turnId: 'current-turn',
      role: 'user',
      status: 'complete',
      turnStatus: 'streaming',
      content: '我们上次聊的 Minecraft 碰撞箱是什么办法？',
    },
  ];

  const [match] = searchTranscriptHistory(transcript, 'Minecraft 碰撞箱', {
    currentTurnId: 'current-turn',
  });

  assert.equal(match.id, 'old-user-message');
  assert.equal(match.role, 'user');
  assert.match(match.snippet, /体素化工具/);
  assert.ok(match.snippet.length <= 322);
});

test('agent history search excludes the current turn and incomplete history', () => {
  const transcript = [
    {
      ...messages[0],
      id: 'unfinished',
      turnId: 'unfinished-turn',
      status: 'failed',
      turnStatus: 'failed',
      content: 'Noema 历史记忆检索设计草案',
    },
    {
      ...messages[0],
      id: 'current',
      turnId: 'current-turn',
      status: 'complete',
      turnStatus: 'streaming',
      content: 'Noema 历史记忆检索设计草案',
    },
  ];

  assert.deepEqual(
    searchTranscriptHistory(transcript, 'Noema 历史记忆检索', {
      currentTurnId: 'current-turn',
    }),
    [],
  );
});

test('agent history search returns no broad match for generic reference words', () => {
  const transcript = messages.map((message, index) => ({
    ...message,
    turnId: `turn-${index}`,
    status: 'complete',
    turnStatus: 'completed',
  }));

  assert.deepEqual(
    searchTranscriptHistory(transcript, '之前我们讨论什么', {
      currentTurnId: 'current-turn',
    }),
    [],
  );
});
