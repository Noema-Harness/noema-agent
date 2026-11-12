import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCacheBreakdownLabel,
  formatMessageRoleCharactersLabel,
  formatRequestShapeLabel,
  formatTokenUsageLabel,
} from '../../../src/renderer/diagnostics/request-shape-label.mjs';

test('formats request shape measurements with explicit character units', () => {
  assert.equal(
    formatRequestShapeLabel({
      requestCharacters: 12_345,
      toolDefinitionCharacters: 2_100,
      messageCount: 9,
      toolCount: 2,
    }),
    '消息数组 JSON 12,345 字符 · 工具定义 2,100 字符 · 9 条消息 · 2 个工具',
  );
});

test('formats only fixed message role counts with character units', () => {
  assert.equal(
    formatMessageRoleCharactersLabel({
      system: 1_000,
      developer: 0,
      user: 500,
      assistant: 700,
      tool: 300,
      other: 0,
    }),
    '消息对象 JSON 字符数（系统 1,000 字符 · 开发者 0 字符 · 用户 500 字符 · 助手 700 字符 · 工具结果 300 字符 · 其他 0 字符）',
  );
  assert.equal(
    formatMessageRoleCharactersLabel(null),
    '消息对象 JSON 字符数不可用',
  );
});

test('shows missing request shape measurements as unavailable and preserves zero', () => {
  assert.equal(
    formatRequestShapeLabel({
      requestCharacters: null,
      toolDefinitionCharacters: null,
      messageCount: 0,
      toolCount: 0,
    }),
    '消息数组 JSON 不可用 字符 · 工具定义 不可用 字符 · 0 条消息 · 0 个工具',
  );
});

test('formats token usage without turning unknown values into zero', () => {
  assert.equal(
    formatTokenUsageLabel({
      usageReceived: true,
      inputTokens: 120,
      outputTokens: null,
    }),
    '输入 120 · 输出 未知',
  );
  assert.equal(
    formatTokenUsageLabel({
      usageReceived: false,
      inputTokens: null,
      outputTokens: null,
    }),
    '用量未返回',
  );
  assert.equal(
    formatTokenUsageLabel({
      usageReceived: true,
      inputTokens: 0,
      outputTokens: 0,
    }),
    '输入 0 · 输出 0',
  );
  assert.equal(
    formatTokenUsageLabel({
      usageReceived: true,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: 8,
    }),
    '输入 未知 · 输出 未知 · 推理 8',
  );
});

test('formats cache breakdown only from reported or exactly derived values', () => {
  assert.equal(
    formatCacheBreakdownLabel({
      inputTokens: 100,
      cachedInputTokens: null,
      cacheMissTokens: null,
      cacheWriteTokens: null,
    }),
    '缓存分解 未知',
  );
  assert.equal(
    formatCacheBreakdownLabel({
      inputTokens: 100,
      cachedInputTokens: 64,
      cacheMissTokens: null,
      cacheWriteTokens: null,
    }),
    '缓存命中 64 · 未命中 未知 · 写入 未知',
  );
  assert.equal(
    formatCacheBreakdownLabel({
      inputTokens: null,
      cachedInputTokens: null,
      cacheMissTokens: null,
      cacheWriteTokens: null,
    }),
    null,
  );
  assert.equal(
    formatCacheBreakdownLabel({
      inputTokens: 100,
      cachedInputTokens: null,
      cacheMissTokens: null,
      cacheWriteTokens: 0,
    }),
    '缓存命中 未知 · 未命中 未知 · 写入 0',
  );
});
