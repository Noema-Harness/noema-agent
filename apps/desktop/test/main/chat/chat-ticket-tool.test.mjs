import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createChatTicketTool } from '../../../src/main/chat/chat-ticket-tool.mjs';
import { NoemaToolSession } from '../../../src/main/mcp/noema-tool-session.mjs';

test('start_work_ticket is callable through the real MCP session', async () => {
  const calls = [];
  const session = new NoemaToolSession({
    tools: [
      createChatTicketTool({
        startTicket: async (input) => {
          calls.push(input);
          return { accepted: true };
        },
        availableAssignees: ['质量工程师'],
        resolveAssignee: (name) =>
          name === '质量工程师' ? 'agent-quality' : null,
      }),
    ],
  });
  try {
    const { url, headers } = await session.start();
    const client = new Client({ name: 'noema-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers },
    });
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: 'start_work_ticket',
        arguments: {
          task: 'write runtime-check.txt',
          assignee: '质量工程师',
        },
      });
      assert.deepEqual(JSON.parse(result.content[0].text), {
        accepted: true,
        reason: null,
      });
      assert.deepEqual(calls, [
        {
          prompt: 'write runtime-check.txt',
          workspacePath: null,
          sessionId: null,
          agentId: 'agent-quality',
        },
      ]);
    } finally {
      await client.close();
    }
  } finally {
    await session.close();
  }
});

test('a ticket cannot start without a real assignee', async () => {
  let called = false;
  const tool = createChatTicketTool({
    startTicket: async () => {
      called = true;
      return { accepted: true };
    },
    availableAssignees: ['质量工程师'],
    resolveAssignee: () => 'agent-quality',
  });
  await assert.rejects(
    () => tool.handler({ task: 'write the report' }),
    /请指定承接成员/u,
  );
  assert.equal(called, false);
});

test('an explicit assignee is resolved to a real member before starting work', async () => {
  const calls = [];
  const tool = createChatTicketTool({
    startTicket: async (input) => {
      calls.push(input);
      return { accepted: true };
    },
    resolveAssignee: (name) => (name === '质量工程师' ? 'agent-quality' : null),
  });
  await tool.handler({ task: 'write the report', assignee: '质量工程师' });
  assert.equal(calls[0].agentId, 'agent-quality');
  await assert.rejects(
    () => tool.handler({ task: 'write the report', assignee: '不存在' }),
    /没有找到成员/u,
  );
});

test('continuing a ticket requires a workspace before invoking the owner', async () => {
  let called = false;
  const tool = createChatTicketTool({
    startTicket: async () => {
      called = true;
      return { accepted: true };
    },
  });
  await assert.rejects(
    () =>
      tool.handler({
        task: 'continue the ticket',
        session_id: 'session-1',
      }),
    /需要工作文件夹/u,
  );
  assert.equal(called, false);
});
