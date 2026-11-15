import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { scanWorkspaceFileBoundary } from './workspace-file-boundary.mjs';
import { createWorkspaceFileDiff } from './workspace-file-diff.ts';

const MAX_GIT_REVIEW_FILES = 200;
const MAX_GIT_STATUS_BYTES = 1024 * 1024;
const MAX_GIT_DIFF_BYTES = 1024 * 1024;
const MAX_GIT_FILE_BYTES = 1_000_000;
const MAX_GIT_REVIEW_MS = 10_000;

function unavailable(reason) {
  return { available: false, reason, files: [] };
}

function runGit(workspacePath, args, timeout) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^GIT_/iu.test(key)) delete env[key];
  }
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
    GIT_EXTERNAL_DIFF: '',
  });
  return new Promise((resolve) => {
    execFile(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.pager=cat',
        '-c',
        'diff.external=',
        '-c',
        'diff.renames=false',
        ...args,
      ],
      {
        cwd: workspacePath,
        encoding: null,
        env,
        timeout,
        maxBuffer: MAX_GIT_DIFF_BYTES,
        windowsHide: true,
        shell: false,
      },
      (error, stdout, stderr) => {
        resolve({
          error: error ?? null,
          status: error
            ? Number.isInteger(error.code)
              ? error.code
              : null
            : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

function decodeStatus(bytes) {
  if (!Buffer.isBuffer(bytes))
    throw new TypeError('Git status bytes are missing.');
  const text = bytes.toString('utf8');
  const records = text.split('\0');
  const files = [];
  for (const record of records) {
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') {
      throw new Error('Git returned an unsupported status record.');
    }
    files.push({ status: record.slice(0, 2), relativePath: record.slice(3) });
  }
  return files;
}

function resolveFile(workspacePath, relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Git returned a path outside the selected workspace.');
  }
  const target = path.resolve(workspacePath, ...normalized.split('/'));
  const relative = path.relative(workspacePath, target);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Git returned a path outside the selected workspace.');
  }
  return { normalized, target };
}

function nativeUntrackedDiff(workspacePath, relativePath) {
  const { normalized, target } = resolveFile(workspacePath, relativePath);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return {
      text: '未跟踪路径不是普通文件；无法显示文本差异。',
      truncated: false,
    };
  }
  if (stat.size > MAX_GIT_FILE_BYTES) {
    return { text: '文件超过 1 MB 文本差异上限。', truncated: true };
  }
  const bytes = fs.readFileSync(target);
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return {
      text: '未跟踪文件不是 UTF-8 文本；不显示内容。',
      truncated: false,
    };
  }
  const diff = createWorkspaceFileDiff({
    relativePath: normalized,
    beforeBytes: null,
    afterBytes: bytes,
  });
  return { text: diff.text, truncated: diff.truncated };
}

/** Returns a fixed-argument, read-only view of the selected workspace's Git state. */
export async function reviewWorkspaceGitState({
  workspacePath,
  expectedIdentity,
  workspaceFileBoundaryScanner = scanWorkspaceFileBoundary,
  spawnSyncImpl = runGit,
  now = Date.now,
} = {}) {
  const started = now();
  const boundary = await workspaceFileBoundaryScanner(workspacePath, {
    expectedIdentity,
  });
  if (!boundary?.ok) return unavailable('workspace_boundary');
  const repository = await spawnSyncImpl(
    workspacePath,
    ['rev-parse', '--is-inside-work-tree'],
    2_000,
  );
  if (repository.error?.code === 'ETIMEDOUT') return unavailable('git_timeout');
  if (repository.error || repository.status !== 0)
    return unavailable('not_a_repository');
  if (repository.stdout.toString('utf8').trim() !== 'true')
    return unavailable('not_a_repository');

  const status = await spawnSyncImpl(
    workspacePath,
    [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--no-renames',
      '--',
      '.',
    ],
    3_000,
  );
  if (status.error?.code === 'ETIMEDOUT') return unavailable('git_timeout');
  if (status.error || status.status !== 0)
    return unavailable('git_status_failed');
  if (
    !Buffer.isBuffer(status.stdout) ||
    status.stdout.byteLength > MAX_GIT_STATUS_BYTES
  ) {
    return unavailable('git_status_limit');
  }

  let changed;
  try {
    changed = decodeStatus(status.stdout);
  } catch {
    return unavailable('git_status_unsupported');
  }
  if (changed.length > MAX_GIT_REVIEW_FILES)
    return unavailable('git_file_limit');
  const files = [];
  let totalDiffBytes = 0;
  for (const item of changed) {
    const elapsed = now() - started;
    if (elapsed >= MAX_GIT_REVIEW_MS) return unavailable('git_timeout');
    let filePath;
    try {
      filePath = resolveFile(workspacePath, item.relativePath);
    } catch {
      return unavailable('git_path_unsupported');
    }
    let diff;
    if (item.status === '??') {
      try {
        diff = nativeUntrackedDiff(workspacePath, item.relativePath);
      } catch {
        return unavailable('git_file_read_failed');
      }
    } else {
      const remainingMs = Math.max(1, MAX_GIT_REVIEW_MS - (now() - started));
      const pathspec = `:(literal)${filePath.normalized}`;
      const result = await spawnSyncImpl(
        workspacePath,
        [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--no-color',
          '--no-renames',
          'HEAD',
          '--',
          pathspec,
        ],
        Math.min(2_000, remainingMs),
      );
      if (result.error?.code === 'ETIMEDOUT') return unavailable('git_timeout');
      if (result.error || result.status !== 0)
        return unavailable('git_diff_failed');
      if (!Buffer.isBuffer(result.stdout))
        return unavailable('git_diff_failed');
      diff = {
        text: result.stdout.toString('utf8'),
        truncated: false,
      };
      if (result.stdout.byteLength > MAX_GIT_DIFF_BYTES)
        return unavailable('git_diff_limit');
    }
    totalDiffBytes += Buffer.byteLength(diff.text, 'utf8');
    if (totalDiffBytes > MAX_GIT_DIFF_BYTES)
      return unavailable('git_diff_limit');
    files.push({
      relativePath: filePath.normalized,
      status: item.status,
      diffText: diff.text,
      diffTruncated: diff.truncated,
    });
  }
  const finalBoundary = await workspaceFileBoundaryScanner(workspacePath, {
    expectedIdentity,
  });
  if (!finalBoundary?.ok) return unavailable('workspace_boundary');
  return {
    available: true,
    source: 'current_workspace',
    files,
  };
}
