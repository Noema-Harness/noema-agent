import fs from 'node:fs';
import path from 'node:path';

export const WORKSPACE_IDENTITY_VERSION = 1;

export type WorkspaceIdentity = {
  version: number;
  canonicalPath: string;
  device: string;
  fileIndex: string;
};

function safeBigInt(value: unknown) {
  if (typeof value !== 'bigint' || value <= 0n) return null;
  return value.toString(10);
}

export function captureWorkspaceIdentity(
  selectedPath: unknown,
  { realpathSync = fs.realpathSync.native, statSync = fs.statSync } = {},
) {
  if (typeof selectedPath !== 'string' || !selectedPath.trim()) {
    return { ok: false, code: 'workspace_identity_unavailable' };
  }
  try {
    const canonicalPath = realpathSync(selectedPath);
    const info = statSync(canonicalPath, { bigint: true });
    if (!info.isDirectory()) {
      return { ok: false, code: 'workspace_not_directory' };
    }
    const device = safeBigInt(info.dev);
    const fileIndex = safeBigInt(info.ino);
    if (!device || !fileIndex) {
      return { ok: false, code: 'workspace_identity_unavailable' };
    }
    const normalizedPath = path.normalize(canonicalPath);
    const identity = {
      version: WORKSPACE_IDENTITY_VERSION,
      canonicalPath: normalizedPath,
      device,
      fileIndex,
    };
    return {
      ok: true,
      identity,
      workspaceKey: `v${WORKSPACE_IDENTITY_VERSION}:${device}:${fileIndex}`,
    };
  } catch {
    return { ok: false, code: 'workspace_identity_unavailable' };
  }
}

export function isWorkspaceIdentity(value: any): value is WorkspaceIdentity {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.version === WORKSPACE_IDENTITY_VERSION &&
    typeof value.canonicalPath === 'string' &&
    value.canonicalPath.length > 0 &&
    typeof value.device === 'string' &&
    /^[1-9][0-9]{0,19}$/.test(value.device) &&
    typeof value.fileIndex === 'string' &&
    /^[1-9][0-9]{0,20}$/.test(value.fileIndex),
  );
}

export function compareWorkspaceIdentities(
  left: unknown,
  right: unknown,
  platform: string = process.platform,
) {
  if (!isWorkspaceIdentity(left) || !isWorkspaceIdentity(right)) return false;
  const pathEqual =
    platform === 'win32'
      ? left.canonicalPath.toLocaleLowerCase('en-US') ===
        right.canonicalPath.toLocaleLowerCase('en-US')
      : left.canonicalPath === right.canonicalPath;
  return (
    pathEqual &&
    left.version === right.version &&
    left.device === right.device &&
    left.fileIndex === right.fileIndex
  );
}
