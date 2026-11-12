import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conversationExportFileName,
  formatConversationMarkdown,
} from '../../../src/shared/export/conversation-markdown.mjs';

test('formats a conversation with members, roles and failures', () => {
  const markdown = formatConversationMarkdown({
    room: { title: '测试对话' },
    members: [
      { id: 'agent-1', name: '前端工程师' },
      { id: 'agent-2', name: '质量工程师' },
    ],
    messages: [
      {
        role: 'user',
        content: '做一个页面。',
        status: 'complete',
        createdAt: '2026-11-09T10:00:00.000Z',
      },
      {
        role: 'assistant',
        senderAgentId: 'agent-1',
        content: '已完成。',
        status: 'complete',
        createdAt: '2026-11-09T10:01:00.000Z',
      },
      {
        role: 'assistant',
        senderAgentId: 'agent-2',
        content: '',
        status: 'failed',
        errorMessage: '模型超时',
        createdAt: '2026-11-09T10:02:00.000Z',
      },
    ],
    exportedAt: new Date('2026-11-09T10:03:00.000Z'),
  });

  assert.match(markdown, /^# 测试对话/mu);
  assert.match(markdown, /成员：前端工程师、质量工程师/u);
  assert.match(markdown, /## 你/u);
  assert.match(markdown, /## 前端工程师/u);
  assert.match(markdown, /这条回复失败：模型超时/u);
  assert.match(markdown, /已完成。/u);
});

test('builds a safe file name', () => {
  assert.equal(
    conversationExportFileName(
      { title: '项目: A/B?' },
      new Date('2026-11-09T00:00:00.000Z'),
    ),
    'Noema-项目- A-B-2026-11-09.md',
  );
});
