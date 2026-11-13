import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatWorkTicketMarkdown,
  workTicketExportFileName,
} from '../../../src/shared/export/work-ticket-markdown.ts';

test('formats a ticket with result, steps and usage', () => {
  const markdown = formatWorkTicketMarkdown({
    task: {
      taskPrompt: '创建 detail.md 并回读。',
      status: 'completed',
      executionEngine: 'dsh',
      runtimeSessionId: 'session-1',
      workspacePath: 'C:\\workspace',
      model: 'deepseek-flash',
      resultText: '已完成。',
      steps: [
        { ordinal: 1, toolName: 'write', status: 'completed' },
        { ordinal: 2, toolName: 'read', status: 'completed' },
      ],
    },
    usage: { requests: 2, inputTokens: 10, outputTokens: 5 },
    exportedAt: new Date('2026-11-09T12:00:00.000Z'),
  });
  assert.match(markdown, /^# 创建 detail\.md 并回读。/u);
  assert.match(markdown, /状态：已完成/u);
  assert.match(markdown, /执行引擎：DSH/u);
  assert.match(markdown, /会话：session-1/u);
  assert.match(markdown, /- 1 · write · completed/u);
  assert.match(markdown, /2 次请求 · 输入 10 · 输出 5/u);
});

test('builds a bounded safe work-ticket file name', () => {
  const name = workTicketExportFileName(
    { taskPrompt: 'A/B: create "x"\nnext' },
    new Date('2026-11-09T12:00:00.000Z'),
  );
  assert.match(name, /^Noema-工单-A-B- create -x-2026-11-09\.md$/u);
});
