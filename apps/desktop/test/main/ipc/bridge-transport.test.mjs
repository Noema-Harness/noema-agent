import assert from 'node:assert/strict';
import test from 'node:test';
import { createBridgeRouter } from '../../../src/main/ipc/bridge-router.ts';
import { createBridge } from '../../../src/shared/bridge/create-bridge.ts';

function fakeTransport() {
  const calls = [];
  const listeners = new Map();
  return {
    calls,
    async invoke(channel, ...args) {
      calls.push([channel, args]);
      return { channel };
    },
    on(channel, listener) {
      const group = listeners.get(channel) ?? new Set();
      group.add(listener);
      listeners.set(channel, group);
      return () => group.delete(listener);
    },
    emit(channel, payload) {
      for (const listener of listeners.get(channel) ?? []) listener(payload);
    },
    listenerCount(channel) {
      return listeners.get(channel)?.size ?? 0;
    },
  };
}

test('the router refuses duplicate channels and unknown dispatches', async () => {
  const router = createBridgeRouter();
  router.handle('noema:social-state', () => 'ok');
  assert.equal(router.has('noema:social-state'), true);
  assert.deepEqual(router.channels, ['noema:social-state']);
  assert.throws(
    () => router.handle('noema:social-state', () => 'again'),
    /already registered/,
  );
  await assert.rejects(
    router.dispatch('noema:missing'),
    /unknown bridge channel/,
  );
});

test('the router forwards arguments positionally', async () => {
  const router = createBridgeRouter();
  router.handle('noema:social-room', (...args) => args);
  assert.deepEqual(
    await router.dispatch('noema:social-room', ['room-1', { limit: 5 }]),
    ['room-1', { limit: 5 }],
  );
});

test('the bridge maps each method to its channel and argument list', async () => {
  const transport = fakeTransport();
  const bridge = createBridge(transport, { appVersion: '1.2.3' });

  assert.equal(bridge.appVersion, '1.2.3');

  await bridge.getSocialRoom('room-1', { limit: 5 });
  assert.deepEqual(transport.calls.at(-1), [
    'noema:social-room',
    ['room-1', { limit: 5 }],
  ]);

  await bridge.sendSocialMessage({
    roomId: 'room-1',
    agentId: 'agent-1',
    text: 'hello',
  });
  assert.deepEqual(transport.calls.at(-1), [
    'noema:social-send',
    [{ roomId: 'room-1', agentId: 'agent-1', text: 'hello' }],
  ]);

  await bridge.controlWindow('state');
  assert.deepEqual(transport.calls.at(-1), ['noema:window-control', ['state']]);
});

test('member asset methods use their own channels and positional arguments', async () => {
  const transport = fakeTransport();
  const bridge = createBridge(transport, { appVersion: '1.0.0' });

  await bridge.listSocialAgentAssets('agent-1');
  assert.deepEqual(transport.calls.at(-1), [
    'noema:social-agent-assets',
    ['agent-1'],
  ]);

  await bridge.getSocialAgentAsset('agent-1', 'experiences/a.md');
  assert.deepEqual(transport.calls.at(-1), [
    'noema:social-agent-asset',
    ['agent-1', 'experiences/a.md'],
  ]);

  await bridge.listSocialAgentAssetRevisions('agent-1', 'experiences/a.md');
  assert.deepEqual(transport.calls.at(-1), [
    'noema:social-agent-asset-history',
    ['agent-1', 'experiences/a.md'],
  ]);

  await bridge.deleteSocialAgentAsset({
    agentId: 'agent-1',
    path: 'experiences/a.md',
    expectedRevision: 2,
  });
  assert.deepEqual(transport.calls.at(-1), [
    'noema:social-agent-asset-delete',
    [{ agentId: 'agent-1', path: 'experiences/a.md', expectedRevision: 2 }],
  ]);

  await bridge.restoreSocialAgentAsset({
    agentId: 'agent-1',
    path: 'experiences/a.md',
    revision: 1,
    expectedRevision: 0,
  });
  assert.deepEqual(transport.calls.at(-1), [
    'noema:social-agent-asset-restore',
    [
      {
        agentId: 'agent-1',
        path: 'experiences/a.md',
        revision: 1,
        expectedRevision: 0,
      },
    ],
  ]);
});

test('memory methods use their own channels and defaults', async () => {
  const transport = fakeTransport();
  const bridge = createBridge(transport, { appVersion: '1.0.0' });

  await bridge.listAgentMemories();
  assert.deepEqual(transport.calls.at(-1), ['noema:agent-memories', [{}]]);

  await bridge.listAgentMemories({ agentId: 'noema', status: 'candidate' });
  assert.deepEqual(transport.calls.at(-1), [
    'noema:agent-memories',
    [{ agentId: 'noema', status: 'candidate' }],
  ]);

  const created = {
    agentId: 'noema',
    kind: 'fact',
    content: '每周五下午做发布检查。',
    trust: 'agent',
  };
  await bridge.createAgentMemory(created);
  assert.deepEqual(transport.calls.at(-1), [
    'noema:agent-memory-create',
    [created],
  ]);

  await bridge.confirmAgentMemory('memory-1');
  assert.deepEqual(transport.calls.at(-1), [
    'noema:agent-memory-confirm',
    ['memory-1'],
  ]);

  await bridge.retractAgentMemory({ id: 'memory-1', reason: '不再成立' });
  assert.deepEqual(transport.calls.at(-1), [
    'noema:agent-memory-retract',
    [{ id: 'memory-1', reason: '不再成立' }],
  ]);

  await bridge.supersedeAgentMemory({ id: 'memory-1', content: '改成周四。' });
  assert.deepEqual(transport.calls.at(-1), [
    'noema:agent-memory-supersede',
    [{ id: 'memory-1', content: '改成周四。' }],
  ]);

  await bridge.listAgentMemoryAudit('memory-1');
  assert.deepEqual(transport.calls.at(-1), [
    'noema:agent-memory-audit',
    ['memory-1'],
  ]);
});

test('the bridge subscribes and unsubscribes through the transport', () => {
  const transport = fakeTransport();
  const bridge = createBridge(transport, { appVersion: '1.2.3' });
  const seen = [];

  const unsubscribe = bridge.onSocialEvent((event) => seen.push(event));
  assert.equal(transport.listenerCount('noema:social-event'), 1);

  transport.emit('noema:social-event', { kind: 'state' });
  assert.deepEqual(seen, [{ kind: 'state' }]);

  unsubscribe();
  assert.equal(transport.listenerCount('noema:social-event'), 0);
});

test('desktop-only probe channels stay opt-in', () => {
  const plain = createBridge(fakeTransport(), { appVersion: '1.0.0' });
  assert.equal(plain.testArmSocialWorkReverseSnapshot, undefined);

  const probed = createBridge(fakeTransport(), {
    appVersion: '1.0.0',
    includeSocialWorkRaceProbe: true,
  });
  assert.equal(typeof probed.testArmSocialWorkReverseSnapshot, 'function');
});

test('a router-backed transport serves the bridge without Electron', async () => {
  const router = createBridgeRouter();
  router.handle('noema:social-state', () => ({ agents: [], rooms: [] }));
  const transport = {
    invoke: (channel, ...args) => router.dispatch(channel, args),
    on: () => () => {},
  };
  const bridge = createBridge(transport, { appVersion: '0.0.0' });

  assert.deepEqual(await bridge.getSocialState(), { agents: [], rooms: [] });
});
