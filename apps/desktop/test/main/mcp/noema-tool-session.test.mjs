import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { NoemaToolSession } from '../../../src/main/mcp/noema-tool-session.ts';

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

// The server binds an ephemeral port; a fetch client refuses the handful of
// ports the WHATWG fetch spec blocks ("bad port"). Restarting with a fresh
// ephemeral port is the only reliable way to keep this test from flaking.
const BAD_PORT_ATTEMPTS = 5;

async function withReachableSession(run) {
  for (let attempt = 1; ; attempt += 1) {
    const session = new NoemaToolSession({ tools: [echoTool()] });
    try {
      await session.start();
      const value = await run(session);
      await session.close();
      return value;
    } catch (error) {
      await session.close().catch(() => {});
      const message = String(error?.cause?.message ?? error?.message ?? '');
      if (!message.includes('bad port') || attempt >= BAD_PORT_ATTEMPTS)
        throw error;
    }
  }
}

test('tool session starts one authenticated MCP endpoint and reuses it', async () => {
  let session = null;
  await withReachableSession(async (started) => {
    session = started;
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
  });
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
