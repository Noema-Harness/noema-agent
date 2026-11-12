/**
 * Hard limits for the command mirror and its durable recovery store.
 *
 * The defaults were measured against the current Noema workspace on
 * 2026-11-07: 10,067 MiB and 194,547 ordinary files excluding `.git`
 * (11,961 MiB and 206,299 files including `.git`). The mirror limit leaves
 * room for normal workspace growth; the recovery limits bound the data that
 * can be staged before a per-path write is allowed.
 *
 * These are refusal limits, not truncation limits: a command that would
 * exceed them must fail preparation and must never drop a changed path.
 */
export const MAX_COMMAND_RECOVERY_BLOB_BYTES = 512 * 1024 * 1024;
export const MAX_COMMAND_TASK_RECOVERY_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_COMMAND_APP_RECOVERY_BYTES = 8 * 1024 * 1024 * 1024;
export const MAX_COMMAND_CHANGE_PATHS = 2_000;
export const MAX_COMMAND_DIFF_BYTES = 64 * 1024;
export const MAX_COMMAND_MIRROR_BYTES = 12 * 1024 * 1024 * 1024;
export const MAX_COMMAND_MIRROR_ENTRIES = 500_000;
export const MIN_COMMAND_FREE_SPACE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Refuse a command mirror before any process is spawned when the measured
 * workspace cannot fit the accepted mirror profile or the free-space reserve.
 *
 * @param {{ bytes: number, entries: number, freeBytes: number }} input
 * @returns {{ bytes: number, entries: number, remainingFreeBytes: number }}
 */
export function assertCommandMirrorCapacity({ bytes, entries, freeBytes }) {
  for (const [name, value] of Object.entries({ bytes, entries, freeBytes })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      const error = new Error(
        `Command mirror capacity input is invalid: ${name}.`,
      );
      error.code = 'workspace_command_mirror_capacity_invalid';
      throw error;
    }
  }
  if (bytes > MAX_COMMAND_MIRROR_BYTES) {
    const error = new Error(
      'Command mirror bytes exceed the accepted profile.',
    );
    error.code = 'workspace_command_mirror_bytes_exceeded';
    throw error;
  }
  if (entries > MAX_COMMAND_MIRROR_ENTRIES) {
    const error = new Error(
      'Command mirror entries exceed the accepted profile.',
    );
    error.code = 'workspace_command_mirror_entries_exceeded';
    throw error;
  }
  const remainingFreeBytes = freeBytes - bytes;
  if (remainingFreeBytes < MIN_COMMAND_FREE_SPACE_BYTES) {
    const error = new Error(
      'Command mirror would consume the free-space reserve.',
    );
    error.code = 'workspace_command_mirror_free_space_exceeded';
    throw error;
  }
  return { bytes, entries, remainingFreeBytes };
}
