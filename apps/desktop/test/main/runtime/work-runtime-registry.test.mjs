import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkRuntimeRegistry } from '../../../src/main/runtime/work-runtime-registry.mjs';

function fakeRuntime(name) {
  return { name, startTask() {}, continueTask() {} };
}

test('a DSH work runtime is selectable as a replaceable implementation', () => {
  const dsh = fakeRuntime('dsh');
  const registry = createWorkRuntimeRegistry({ dshRuntime: dsh });
  assert.deepEqual(registry.kinds(), ['dsh']);
  assert.equal(registry.has('dsh'), true);
  assert.equal(registry.preferredKind(), 'dsh');
  assert.equal(registry.forTicket(), dsh);
});

test('native is used when DSH is unavailable', () => {
  const native = fakeRuntime('native');
  const registry = createWorkRuntimeRegistry({ nativeRuntime: native });
  assert.deepEqual(registry.kinds(), ['native']);
  assert.equal(registry.preferredKind(), 'native');
  assert.equal(registry.forTicket({ preferred: 'dsh' }), native);
});

test('DSH is preferred when both runtimes are available', () => {
  const dsh = fakeRuntime('dsh');
  const native = fakeRuntime('native');
  const registry = createWorkRuntimeRegistry({
    dshRuntime: dsh,
    nativeRuntime: native,
  });
  assert.equal(registry.forTicket({ preferred: 'dsh' }), dsh);
  assert.equal(registry.forTicket({ preferred: 'native' }), native);
});

test('a missing work runtime resolves to unavailable, not a hard failure', () => {
  const registry = createWorkRuntimeRegistry();
  assert.equal(registry.has('dsh'), false);
  assert.equal(registry.preferredKind(), null);
  assert.equal(registry.forTicket(), null);
});

test('unknown work runtimes fail closed', () => {
  const registry = createWorkRuntimeRegistry({
    dshRuntime: fakeRuntime('dsh'),
  });
  assert.throws(() => registry.get('codex'), /Unknown work runtime/);
});
