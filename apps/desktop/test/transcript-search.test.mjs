import assert from 'node:assert/strict';
import test from 'node:test';
import { findTranscriptMatches } from '../src/transcript-search.mjs';

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
