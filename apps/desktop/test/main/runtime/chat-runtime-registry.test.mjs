import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHAT_RUNTIME_KINDS,
  createChatRuntimeRegistry,
} from '../../../src/main/runtime/chat-runtime-registry.mjs';

function runtime(kind) {
  return {
    kind,
    async *streamChat() {
      yield kind;
    },
  };
}

test('native-only registry keeps the native runtime for the main chat', () => {
  const native = runtime('native');
  const registry = createChatRuntimeRegistry({ nativeRuntime: native });
  assert.deepEqual(registry.kinds(), ['native']);
  assert.equal(
    registry.forMainChat({ agentId: 'noema', roomId: 'room-noema' }),
    native,
  );
  assert.equal(
    registry.forMainChat({ agentId: 'specialist', roomId: 'room-noema' }),
    native,
  );
  assert.equal(registry.preferredKind, 'native');
});

test('dsh registry is preferred only for the main Noema room', () => {
  const native = runtime('native');
  const dsh = runtime('dsh');
  const registry = createChatRuntimeRegistry({
    nativeRuntime: native,
    dshRuntime: dsh,
  });
  assert.deepEqual(registry.kinds(), ['native', 'dsh']);
  assert.equal(
    registry.forMainChat({ agentId: 'noema', roomId: 'room-noema' }),
    dsh,
  );
  assert.equal(
    registry.forMainChat({ agentId: 'noema', roomId: 'room-other' }),
    native,
  );
  assert.equal(
    registry.forMainChat({ agentId: 'specialist', roomId: 'room-noema' }),
    native,
  );
  assert.equal(registry.preferredKind, 'dsh');
});

test('invalid runtime registrations are rejected', () => {
  assert.throws(
    () => createChatRuntimeRegistry({ nativeRuntime: null }),
    /native runtime/,
  );
  assert.throws(
    () =>
      createChatRuntimeRegistry({
        nativeRuntime: runtime('native'),
        dshRuntime: runtime('native'),
      }),
    /invalid dsh runtime/,
  );
  assert.throws(
    () =>
      createChatRuntimeRegistry({ nativeRuntime: runtime('native') }).get(
        'dsh',
      ),
    /not registered/,
  );
  assert.deepEqual(CHAT_RUNTIME_KINDS, ['native', 'dsh']);
});
