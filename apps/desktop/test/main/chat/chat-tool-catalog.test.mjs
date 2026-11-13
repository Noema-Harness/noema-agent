import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createChatToolDefinitions } from '../../../src/main/chat/chat-tool-catalog.ts';
import { NoemaToolSession } from '../../../src/main/mcp/noema-tool-session.ts';

const EXPECTED_TOOL_NAMES = [
  'complete_project',
  'create_project_team',
  'delegate_to_specialist',
  'manage_member_assets',
  'manage_personal_memory',
  'manage_project_plan',
  'project_group',
  'read_project_source',
  'request_project_review',
  'research_public_sources',
  'schedule_followup',
  'start_project_work',
  'start_work_ticket',
];

test('chat tool catalog exposes every Noema action with its schema', () => {
  const tools = createChatToolDefinitions({
    agents: [{ id: 'agent-1' }],
    projects: [{ id: 'project-1' }],
    projectWorkReady: true,
    projectSourceUrls: ['https://example.com/source'],
    executeTool: () => ({ ok: true }),
  });
  assert.deepEqual(tools.map((tool) => tool.name).sort(), EXPECTED_TOOL_NAMES);
  for (const tool of tools) {
    assert.equal(typeof tool.description, 'string');
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(typeof tool.handler, 'function');
  }
});

test('a Noema action is callable through the loopback MCP session', async () => {
  const calls = [];
  const tools = createChatToolDefinitions({
    agents: [{ id: 'agent-1' }],
    projects: [{ id: 'project-1' }],
    projectWorkReady: true,
    projectSourceUrls: ['https://example.com/source'],
    executeTool: (name, args) => {
      calls.push({ name, args });
      return { accepted: true, name };
    },
  });
  const session = new NoemaToolSession({ tools });
  const client = new Client({ name: 'noema-test', version: '1.0.0' });
  try {
    const descriptor = await session.start();
    const transport = new StreamableHTTPClientTransport(
      new URL(descriptor.url),
      { requestInit: { headers: descriptor.headers } },
    );
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, EXPECTED_TOOL_NAMES.length);

    const result = await client.callTool({
      name: 'start_work_ticket',
      arguments: { task: 'create a file' },
    });
    assert.deepEqual(JSON.parse(result.content[0].text), {
      accepted: true,
      name: 'start_work_ticket',
    });
    assert.deepEqual(calls, [
      { name: 'start_work_ticket', args: { task: 'create a file' } },
    ]);
  } finally {
    await client.close();
    await session.close();
  }
});
