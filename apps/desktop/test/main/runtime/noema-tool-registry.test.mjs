import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NoemaToolRegistry,
  createNoemaToolRegistry,
} from '../../../src/main/runtime/noema-tool-registry.ts';

function tool(name = 'sample_tool') {
  return {
    name,
    description: 'sample',
    inputSchema: { type: 'object', properties: {} },
    handler: async (args) => ({ echoed: args }),
  };
}

test('registry owns tool definitions and executes handlers', async () => {
  const registry = createNoemaToolRegistry([tool()]);
  assert.deepEqual(
    registry.list().map((item) => item.name),
    ['sample_tool'],
  );
  assert.deepEqual(await registry.execute('sample_tool', { value: 1 }), {
    echoed: { value: 1 },
  });
  assert.equal(registry.get('sample_tool')?.name, 'sample_tool');
});

test('registry rejects duplicates and malformed tools', () => {
  const registry = new NoemaToolRegistry([tool()]);
  assert.throws(() => registry.register(tool()), /already registered/);
  assert.throws(() => registry.register({ ...tool('Bad-Name') }), /invalid/);
  assert.throws(
    () => registry.register({ ...tool('no_handler'), handler: null }),
    /handler/,
  );
  assert.throws(
    () => registry.register({ ...tool('no_schema'), inputSchema: null }),
    /schema/,
  );
});

test('registry fails closed for unknown tools', async () => {
  const registry = createNoemaToolRegistry([tool()]);
  await assert.rejects(() => registry.execute('missing', {}), /unknown tool/);
});
