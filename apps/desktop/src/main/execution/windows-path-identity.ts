import { stat } from 'node:fs/promises';

const MAX_VOLUME_SERIAL = 4_294_967_295n;
const MAX_FILE_INDEX = 18_446_744_073_709_551_615n;

/**
 * Capture the native identity for an existing filesystem object from the
 * trusted main process. Native admission reopens it without following
 * reparse points and compares that handle identity before backend preparation.
 */
export async function captureWindowsPathIdentity(
  path: unknown,
  { statPath = stat, expectedType = 'either' } = {},
) {
  if (!['either', 'file', 'directory'].includes(expectedType)) {
    return { ok: false, code: 'path_identity_unavailable' };
  }
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, code: 'path_identity_unavailable' };
  }
  try {
    const info = await statPath(path, { bigint: true });
    const typeMatches =
      expectedType === 'either'
        ? info.isDirectory() || info.isFile()
        : expectedType === 'directory'
          ? info.isDirectory()
          : info.isFile();
    if (!typeMatches) {
      return { ok: false, code: 'path_identity_unavailable' };
    }
    const volume = info.dev;
    const index = info.ino;
    if (
      typeof volume !== 'bigint' ||
      typeof index !== 'bigint' ||
      volume <= 0n ||
      volume > MAX_VOLUME_SERIAL ||
      index <= 0n ||
      index > MAX_FILE_INDEX
    ) {
      return { ok: false, code: 'path_identity_unavailable' };
    }
    return {
      ok: true,
      root: {
        path,
        fileIdentity: {
          volumeSerialNumber: volume.toString(),
          fileIndex: index.toString(),
        },
      },
    };
  } catch {
    return { ok: false, code: 'path_identity_unavailable' };
  }
}

export async function captureWindowsDirectoryIdentity(
  path: unknown,
  options: { statPath?: typeof stat } = {},
) {
  return captureWindowsPathIdentity(path, {
    ...options,
    expectedType: 'directory',
  });
}
