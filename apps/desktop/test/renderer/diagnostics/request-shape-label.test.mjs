import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatMessageRoleCharactersLabel,
  formatRequestShapeLabel,
} from '../../../src/renderer/diagnostics/request-shape-label.mjs';

test('formats request shape measurements with explicit character units', () => {
  assert.equal(
    formatRequestShapeLabel({
      requestCharacters: 12_345,
      toolDefinitionCharacters: 2_100,
      messageCount: 9,
      toolCount: 2,
    }),
    '请求 JSON 12,345 字符 · 工具定义 2,100 字符 · 9 条消息 · 2 个工具',
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
    '请求 JSON 不可用 字符 · 工具定义 不可用 字符 · 0 条消息 · 0 个工具',
  );
});
