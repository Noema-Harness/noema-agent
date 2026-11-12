import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCommandMirrorCapacity,
  MAX_COMMAND_MIRROR_BYTES,
  MAX_COMMAND_MIRROR_ENTRIES,
  MIN_COMMAND_FREE_SPACE_BYTES,
} from '../../../src/main/execution/workspace-command-quotas.mjs';

const freeBytes = MAX_COMMAND_MIRROR_BYTES + MIN_COMMAND_FREE_SPACE_BYTES;

test('command mirror preflight accepts the measured profile boundary', () => {
  assert.deepEqual(
    assertCommandMirrorCapacity({
      bytes: MAX_COMMAND_MIRROR_BYTES,
      entries: MAX_COMMAND_MIRROR_ENTRIES,
      freeBytes,
    }),
    {
      bytes: MAX_COMMAND_MIRROR_BYTES,
      entries: MAX_COMMAND_MIRROR_ENTRIES,
      remainingFreeBytes: MIN_COMMAND_FREE_SPACE_BYTES,
    },
  );
});

test('command mirror preflight refuses oversized or malformed measurements', () => {
  assert.throws(
    () =>
      assertCommandMirrorCapacity({
        bytes: MAX_COMMAND_MIRROR_BYTES + 1,
        entries: 1,
        freeBytes,
      }),
    (error) => error.code === 'workspace_command_mirror_bytes_exceeded',
  );
  assert.throws(
    () =>
      assertCommandMirrorCapacity({
        bytes: 1,
        entries: MAX_COMMAND_MIRROR_ENTRIES + 1,
        freeBytes,
      }),
    (error) => error.code === 'workspace_command_mirror_entries_exceeded',
  );
  assert.throws(
    () =>
      assertCommandMirrorCapacity({
        bytes: 1,
        entries: 1,
        freeBytes: '1',
      }),
    (error) => error.code === 'workspace_command_mirror_capacity_invalid',
  );
});

test('command mirror preflight preserves the free-space reserve', () => {
  assert.throws(
    () =>
      assertCommandMirrorCapacity({
        bytes: 1024,
        entries: 1,
        freeBytes: 1024 + MIN_COMMAND_FREE_SPACE_BYTES - 1,
      }),
    (error) => error.code === 'workspace_command_mirror_free_space_exceeded',
  );
  assert.doesNotThrow(() =>
    assertCommandMirrorCapacity({
      bytes: 1024,
      entries: 1,
      freeBytes: 1024 + MIN_COMMAND_FREE_SPACE_BYTES,
    }),
  );
});
