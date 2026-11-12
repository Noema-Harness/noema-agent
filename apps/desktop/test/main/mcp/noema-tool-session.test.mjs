import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { NoemaToolSession } from '../../../src/main/mcp/noema-tool-session.mjs';

function echoTool() {
  return {
    name: 'echo',
    description: 'Return the supplied text.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    handler: ({ text }) => ({ text }),
  };
}

test('tool session starts one authenticated MCP endpoint and reuses it', async () => {
  const session = new NoemaToolSession({ tools: [echoTool()] });
  try {
    const first = await session.start();
    const second = await session.start();
    assert.equal(first, second);
    assert.equal(session.running, true);
    assert.equal(session.descriptor.serverName, 'noema');
    assert.match(session.descriptor.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/u);
    assert.match(
      session.descriptor.headers.Authorization,
      /^Bearer [0-9a-f-]{36}$/u,
    );

    const client = new Client({ name: 'noema-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(session.descriptor.url),
      { requestInit: { headers: session.descriptor.headers } },
    );
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: 'echo',
        arguments: { text: 'session' },
      });
      assert.deepEqual(JSON.parse(result.content[0].text), { text: 'session' });
    } finally {
      await client.close();
    }
  } finally {
    await session.close();
  }
  assert.equal(session.running, false);
  assert.equal(session.descriptor, null);
});

test('tool session restarts after close', async () => {
  const session = new NoemaToolSession({ tools: [echoTool()] });
  const first = await session.start();
  await session.close();
  const second = await session.start();
  try {
    assert.notEqual(first.url, second.url);
    assert.equal(session.running, true);
  } finally {
    await session.close();
  }
});
