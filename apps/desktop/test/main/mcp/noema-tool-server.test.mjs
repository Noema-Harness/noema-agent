import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { NoemaToolServer } from '../../../src/main/mcp/noema-tool-server.ts';

test('MCP server exposes only declared tools and returns their result', async () => {
  const server = new NoemaToolServer({
    tools: [
      {
        name: 'echo',
        description: 'Return the supplied text.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        handler: ({ text }) => ({ text }),
      },
    ],
  });
  await server.start();
  const client = new Client({ name: 'noema-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: {
      headers: { authorization: `Bearer ${server.token}` },
    },
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      ['echo'],
    );
    const result = await client.callTool({
      name: 'echo',
      arguments: { text: 'hello' },
    });
    assert.deepEqual(JSON.parse(result.content[0].text), { text: 'hello' });
  } finally {
    await client.close();
    await server.close();
  }
});

test('MCP server rejects requests without its bearer token', async () => {
  const server = new NoemaToolServer({
    tools: [
      {
        name: 'echo',
        description: 'Return the supplied text.',
        inputSchema: { type: 'object', properties: {} },
        handler: () => 'ok',
      },
    ],
  });
  await server.start();
  try {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});
