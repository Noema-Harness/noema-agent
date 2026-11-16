import fs from 'node:fs';
import path from 'node:path';
import {
  captureWorkspaceIdentity,
  compareWorkspaceIdentities,
} from '../platform/workspace-identity.ts';
import type { WorkspaceIdentity } from '../platform/workspace-identity.ts';

export const MAX_WORKSPACE_FILE_SCAN_ENTRIES = 1_000_000;
export const MAX_WORKSPACE_FILE_SCAN_DEPTH = 256;

function scanFailure(code: string) {
  return { ok: false, code };
}

function isAborted(signal: AbortSignal | null | undefined) {
  return Boolean(signal?.aborted);
}

/**
 * Conservatively verifies the task workspace before an in-process file tool
 * reads or writes it. No paths or file identities leave this boundary.
 */
export async function scanWorkspaceFileBoundary(
  workspacePath: unknown,
  {
    expectedIdentity,
    identityCapture = captureWorkspaceIdentity,
    lstat = fs.promises.lstat,
    readdir = fs.promises.readdir,
    maxEntries = MAX_WORKSPACE_FILE_SCAN_ENTRIES,
    maxDepth = MAX_WORKSPACE_FILE_SCAN_DEPTH,
    signal,
  }: {
    expectedIdentity?: WorkspaceIdentity | null;
    identityCapture?: typeof captureWorkspaceIdentity;
    lstat?: typeof fs.promises.lstat;
    readdir?: typeof fs.promises.readdir;
    maxEntries?: number;
    maxDepth?: number;
    signal?: AbortSignal | null;
  } = {},
) {
  if (
    typeof workspacePath !== 'string' ||
    !workspacePath.length ||
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    !Number.isSafeInteger(maxDepth) ||
    maxDepth < 0
  ) {
    return scanFailure('workspace_scan_invalid_request');
  }

  const initial = identityCapture(workspacePath);
  if (!initial?.ok || !initial.identity) {
    return scanFailure('workspace_identity_unavailable');
  }
  if (
    expectedIdentity &&
    !compareWorkspaceIdentities(expectedIdentity, initial.identity)
  ) {
    return scanFailure('workspace_identity_changed');
  }

  let root;
  try {
    root = path.resolve(initial.identity.canonicalPath);
  } catch {
    return scanFailure('workspace_scan_path_invalid');
  }

  let entryCount = 0;
  const stack: { absolutePath: string; depth: number }[] = [
    { absolutePath: root, depth: 0 },
  ];
  try {
    while (stack.length) {
      if (isAborted(signal)) return scanFailure('workspace_scan_cancelled');
      const current = stack.pop() as { absolutePath: string; depth: number };
      if (current.depth > maxDepth || entryCount >= maxEntries) {
        return scanFailure('workspace_scan_limit');
      }
      const currentInfo = await lstat(current.absolutePath, { bigint: true });
      entryCount += 1;
      if (currentInfo.isSymbolicLink()) {
        return scanFailure('workspace_reparse_point_detected');
      }
      if (currentInfo.isDirectory()) {
        const names = await readdir(current.absolutePath);
        if (names.length > maxEntries - entryCount + 1) {
          return scanFailure('workspace_scan_limit');
        }
        for (const name of names) {
          if (typeof name !== 'string' || name.includes('\0')) {
            return scanFailure('workspace_scan_entry_invalid');
          }
          stack.push({
            absolutePath: path.join(current.absolutePath, name),
            depth: current.depth + 1,
          });
        }
        continue;
      }
      if (!currentInfo.isFile()) {
        return scanFailure('workspace_unsupported_entry');
      }
      if (typeof currentInfo.nlink !== 'bigint' || currentInfo.nlink < 1n) {
        return scanFailure('workspace_link_count_unavailable');
      }
      if (currentInfo.nlink > 1n) {
        return scanFailure('workspace_hard_link_detected');
      }
    }
  } catch {
    return scanFailure('workspace_scan_metadata_unavailable');
  }

  if (isAborted(signal)) return scanFailure('workspace_scan_cancelled');
  const final = identityCapture(workspacePath);
  if (!final?.ok || !final.identity) {
    return scanFailure('workspace_identity_unavailable');
  }
  if (!compareWorkspaceIdentities(initial.identity, final.identity)) {
    return scanFailure('workspace_identity_changed');
  }
  if (
    expectedIdentity &&
    !compareWorkspaceIdentities(expectedIdentity, final.identity)
  ) {
    return scanFailure('workspace_identity_changed');
  }
  return { ok: true, entryCount, identity: final.identity };
}
