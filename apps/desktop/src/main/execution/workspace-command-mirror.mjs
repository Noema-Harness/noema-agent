import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  captureWorkspaceIdentity,
  compareWorkspaceIdentities,
} from '../platform/workspace-identity.ts';
import {
  assertCommandMirrorCapacity,
  MAX_COMMAND_MIRROR_BYTES,
  MAX_COMMAND_MIRROR_ENTRIES,
  MAX_COMMAND_RECOVERY_BLOB_BYTES,
} from './workspace-command-quotas.ts';
import { createWorkspaceFileDiff } from './workspace-file-diff.ts';
import {
  scanWorkspaceFileBoundary,
  MAX_WORKSPACE_FILE_SCAN_DEPTH,
} from './workspace-file-boundary.ts';

export const COMMAND_MIRROR_MANIFEST_VERSION = 2;
const SUPPORTED_COMMAND_MIRROR_MANIFEST_VERSIONS = new Set([1, 2]);

function mirrorError(code, message, effectStatus = 'not_applied') {
  const error = new Error(message);
  error.code = code;
  error.effectStatus = effectStatus;
  return error;
}

function isGitMetadataName(name) {
  return name.toLowerCase() === '.git';
}

export function normalizeCommandRelativePath(value) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.endsWith('/')
  ) {
    throw mirrorError(
      'workspace_command_path_invalid',
      '项目命令文件路径无效；没有写入工作区。',
    );
  }
  const segments = value.split('/');
  if (
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw mirrorError(
      'workspace_command_path_invalid',
      '项目命令文件路径无效；没有写入工作区。',
    );
  }
  return segments.join('/');
}

function manifestBytes(files, gitMetadataSkipped, directories = []) {
  const normalized = files
    .map((file) => ({
      path: normalizeCommandRelativePath(file.relativePath ?? file.path),
      hash: file.hash,
      size: file.size,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const normalizedDirectories = directories
    .map((directory) => ({
      path: normalizeCommandRelativePath(
        directory.relativePath ?? directory.path,
      ),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return Buffer.from(
    JSON.stringify({
      version: COMMAND_MIRROR_MANIFEST_VERSION,
      gitMetadataSkipped,
      files: normalized,
      directories: normalizedDirectories,
    }),
    'utf8',
  );
}

export function parseCommandMirrorManifest(bytes) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw mirrorError(
      'workspace_command_manifest_invalid',
      '项目命令恢复清单无效。',
    );
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !SUPPORTED_COMMAND_MIRROR_MANIFEST_VERSIONS.has(parsed.version) ||
    !Array.isArray(parsed.files) ||
    parsed.files.length > MAX_COMMAND_MIRROR_ENTRIES ||
    parsed.files.some(
      (file) =>
        !file ||
        typeof file.path !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(file.hash) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0,
    )
  ) {
    throw mirrorError(
      'workspace_command_manifest_invalid',
      '项目命令恢复清单无效。',
    );
  }
  const directories = parsed.directories ?? [];
  if (
    !Array.isArray(directories) ||
    directories.length > MAX_COMMAND_MIRROR_ENTRIES ||
    directories.some(
      (directory) =>
        !directory ||
        typeof directory.path !== 'string' ||
        normalizeCommandRelativePath(directory.path) !== directory.path,
    )
  ) {
    throw mirrorError(
      'workspace_command_manifest_invalid',
      '项目命令恢复清单无效。',
    );
  }
  return {
    version: parsed.version,
    gitMetadataSkipped: Boolean(parsed.gitMetadataSkipped),
    files: parsed.files,
    directories,
  };
}

async function walkWorkspace(
  root,
  {
    skipGitMetadata = true,
    signal,
    maxEntries = MAX_COMMAND_MIRROR_ENTRIES,
    maxDepth = MAX_WORKSPACE_FILE_SCAN_DEPTH,
  } = {},
) {
  const directories = [];
  const files = [];
  const stack = [{ absolutePath: root, depth: 0, relativePath: '' }];
  let entries = 0;
  let bytes = 0;
  let gitMetadataSkipped = false;
  while (stack.length) {
    if (signal?.aborted) {
      throw mirrorError(
        'workspace_command_mirror_cancelled',
        '项目命令副本准备已取消。',
      );
    }
    const current = stack.pop();
    if (current.depth > maxDepth) {
      throw mirrorError(
        'workspace_command_mirror_depth_exceeded',
        '项目工作区目录层级超过命令副本上限。',
      );
    }
    let stat;
    try {
      stat = await fsp.lstat(current.absolutePath);
    } catch {
      throw mirrorError(
        'workspace_command_mirror_source_unreadable',
        '项目工作区文件无法读取；命令没有启动。',
      );
    }
    entries += 1;
    if (entries > maxEntries) {
      throw mirrorError(
        'workspace_command_mirror_entries_exceeded',
        '项目工作区文件数量超过命令副本上限；命令没有启动。',
      );
    }
    if (stat.isSymbolicLink()) {
      throw mirrorError(
        'workspace_command_mirror_reparse_rejected',
        '项目工作区包含符号链接或重解析点；命令没有启动。',
      );
    }
    if (
      skipGitMetadata &&
      current.relativePath &&
      isGitMetadataName(path.basename(current.absolutePath))
    ) {
      gitMetadataSkipped = true;
      continue;
    }
    if (stat.isDirectory()) {
      if (current.relativePath) {
        directories.push({
          relativePath: current.relativePath,
          depth: current.depth,
        });
      }
      let names;
      try {
        names = await fsp.readdir(current.absolutePath);
      } catch {
        throw mirrorError(
          'workspace_command_mirror_source_unreadable',
          '项目工作区目录无法读取；命令没有启动。',
        );
      }
      for (const name of names) {
        if (
          typeof name !== 'string' ||
          !name ||
          name.includes('\0') ||
          name === '.' ||
          name === '..'
        ) {
          throw mirrorError(
            'workspace_command_mirror_source_invalid',
            '项目工作区包含无效文件名；命令没有启动。',
          );
        }
        stack.push({
          absolutePath: path.join(current.absolutePath, name),
          depth: current.depth + 1,
          relativePath: current.relativePath
            ? `${current.relativePath}/${name}`
            : name,
        });
      }
      continue;
    }
    if (!stat.isFile() || stat.nlink > 1) {
      throw mirrorError(
        stat.isFile()
          ? 'workspace_command_mirror_hardlink_rejected'
          : 'workspace_command_mirror_source_invalid',
        '项目工作区包含硬链接或不支持的文件类型；命令没有启动。',
      );
    }
    if (isGitMetadataName(path.basename(current.absolutePath))) {
      gitMetadataSkipped = true;
      continue;
    }
    if (stat.size > MAX_COMMAND_RECOVERY_BLOB_BYTES) {
      throw mirrorError(
        'workspace_command_mirror_file_too_large',
        '项目工作区文件超过命令副本单文件上限；命令没有启动。',
      );
    }
    bytes += stat.size;
    if (bytes > MAX_COMMAND_MIRROR_BYTES) {
      throw mirrorError(
        'workspace_command_mirror_bytes_exceeded',
        '项目工作区超过命令副本容量上限；命令没有启动。',
      );
    }
    files.push({
      relativePath: current.relativePath,
      absolutePath: current.absolutePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
  return { directories, files, entries, bytes, gitMetadataSkipped };
}

async function hashFile(filePath, signal) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
  for await (const chunk of stream) {
    if (signal?.aborted) {
      stream.destroy();
      throw mirrorError(
        'workspace_command_mirror_cancelled',
        '项目命令副本准备已取消。',
      );
    }
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function stableFileStat(filePath) {
  const stat = await fsp.lstat(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1) {
    throw mirrorError(
      'workspace_command_mirror_source_changed',
      '项目工作区文件在复制期间发生变化；命令没有启动。',
    );
  }
  return stat;
}

export async function measureCommandWorkspace(
  sourcePath,
  {
    expectedIdentity,
    signal,
    identityCapture = captureWorkspaceIdentity,
    freeSpace = null,
  } = {},
) {
  const initial = identityCapture(sourcePath);
  if (!initial?.ok || !initial.identity) {
    throw mirrorError(
      'workspace_command_mirror_source_unavailable',
      '项目工作区不可用；命令没有启动。',
    );
  }
  if (
    expectedIdentity &&
    !compareWorkspaceIdentities(expectedIdentity, initial.identity)
  ) {
    throw mirrorError(
      'workspace_command_mirror_source_changed',
      '项目工作区身份已变化；命令没有启动。',
    );
  }
  const walked = await walkWorkspace(sourcePath, {
    skipGitMetadata: true,
    signal,
  });
  const hashed = [];
  for (const file of walked.files) {
    const hash = await hashFile(file.absolutePath, signal);
    hashed.push({ ...file, hash });
  }
  const final = identityCapture(sourcePath);
  if (
    !final?.ok ||
    !final.identity ||
    !compareWorkspaceIdentities(initial.identity, final.identity) ||
    (expectedIdentity &&
      !compareWorkspaceIdentities(expectedIdentity, final.identity))
  ) {
    throw mirrorError(
      'workspace_command_mirror_source_changed',
      '项目工作区身份在测量期间发生变化；命令没有启动。',
    );
  }
  const freeBytes =
    freeSpace !== null
      ? await freeSpace()
      : await (async () => {
          const stats = await fsp.statfs(sourcePath, { bigint: true });
          return Number(stats.bavail * stats.bsize);
        })();
  assertCommandMirrorCapacity({
    bytes: walked.bytes,
    entries: walked.entries,
    freeBytes,
  });
  return {
    sourceIdentity: final.identity,
    directories: walked.directories,
    files: hashed,
    entries: walked.entries,
    bytes: walked.bytes,
    gitMetadataSkipped: walked.gitMetadataSkipped,
  };
}

async function copyVerifiedFile(file, destination, signal) {
  const before = await stableFileStat(file.absolutePath);
  if (before.size !== file.size) {
    throw mirrorError(
      'workspace_command_mirror_source_changed',
      '项目工作区文件在复制期间发生变化；命令没有启动。',
    );
  }
  try {
    await pipeline(
      createReadStream(file.absolutePath, { highWaterMark: 1024 * 1024 }),
      createWriteStream(destination, { flags: 'wx', flush: true }),
    );
  } catch {
    throw mirrorError(
      'workspace_command_mirror_copy_failed',
      '项目命令副本写入失败；命令没有启动。',
    );
  }
  if (signal?.aborted) {
    throw mirrorError(
      'workspace_command_mirror_cancelled',
      '项目命令副本准备已取消。',
    );
  }
  const after = await stableFileStat(file.absolutePath);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw mirrorError(
      'workspace_command_mirror_source_changed',
      '项目工作区文件在复制期间发生变化；命令没有启动。',
    );
  }
  const copied = await fsp.lstat(destination);
  if (!copied.isFile() || copied.size !== file.size) {
    throw mirrorError(
      'workspace_command_mirror_copy_failed',
      '项目命令副本校验失败；命令没有启动。',
    );
  }
  const copiedHash = await hashFile(destination, signal);
  if (copiedHash !== file.hash) {
    throw mirrorError(
      'workspace_command_mirror_copy_failed',
      '项目命令副本内容校验失败；命令没有启动。',
    );
  }
  return copiedHash;
}

export async function createCommandMirror({
  sourcePath,
  mirrorPath,
  expectedIdentity,
  signal,
  identityCapture = captureWorkspaceIdentity,
  freeSpace = null,
}) {
  if (typeof mirrorPath !== 'string' || !path.isAbsolute(mirrorPath)) {
    throw new TypeError('Command mirror path must be absolute.');
  }
  const measured = await measureCommandWorkspace(sourcePath, {
    expectedIdentity,
    signal,
    identityCapture,
    freeSpace,
  });
  try {
    await fsp.mkdir(mirrorPath, { recursive: false });
    const directories = [...measured.directories].sort(
      (left, right) =>
        left.depth - right.depth ||
        left.relativePath.localeCompare(right.relativePath),
    );
    for (const directory of directories) {
      await fsp.mkdir(
        path.join(mirrorPath, ...directory.relativePath.split('/')),
        { recursive: false },
      );
    }
    for (const file of [...measured.files].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    )) {
      const destination = path.join(
        mirrorPath,
        ...file.relativePath.split('/'),
      );
      await copyVerifiedFile(file, destination, signal);
    }
    const manifest = manifestBytes(
      measured.files,
      measured.gitMetadataSkipped,
      measured.directories,
    );
    return {
      mirrorPath,
      manifestBytes: manifest,
      manifest: parseCommandMirrorManifest(manifest),
      bytes: measured.bytes,
      entries: measured.entries,
      sourceIdentity: measured.sourceIdentity,
      gitMetadataSkipped: measured.gitMetadataSkipped,
    };
  } catch (error) {
    await fsp.rm(mirrorPath, { recursive: true, force: true }).catch(() => {});
    if (error?.code) throw error;
    throw mirrorError(
      'workspace_command_mirror_copy_failed',
      '项目命令副本创建失败；命令没有启动。',
    );
  }
}

export async function readCommandMirrorManifest(mirrorPath, { signal } = {}) {
  const walked = await walkWorkspace(mirrorPath, {
    skipGitMetadata: false,
    signal,
  });
  const files = [];
  for (const file of walked.files) {
    const hash = await hashFile(file.absolutePath, signal);
    files.push({ path: file.relativePath, hash, size: file.size });
  }
  return parseCommandMirrorManifest(
    manifestBytes(files, false, walked.directories),
  );
}

export function diffCommandMirrors(base, current) {
  const before = new Map(base.files.map((file) => [file.path, file]));
  const after = new Map(current.files.map((file) => [file.path, file]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes = [];
  for (const relativePath of paths) {
    const oldFile = before.get(relativePath);
    const newFile = after.get(relativePath);
    if (oldFile?.hash === newFile?.hash && oldFile?.size === newFile?.size) {
      continue;
    }
    changes.push({
      relativePath,
      beforeExists: Boolean(oldFile),
      afterExists: Boolean(newFile),
      beforeHash: oldFile?.hash ?? null,
      afterHash: newFile?.hash ?? null,
      beforeSize: oldFile?.size ?? 0,
      afterSize: newFile?.size ?? 0,
    });
  }
  return changes;
}

async function readLimitedFile(filePath, signal) {
  const stat = await fsp.lstat(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw mirrorError(
      'workspace_command_change_unsupported',
      '项目命令变更路径不是普通文件。',
    );
  }
  if (stat.size > MAX_COMMAND_RECOVERY_BLOB_BYTES) {
    throw mirrorError(
      'workspace_command_change_too_large',
      '项目命令变更文件超过恢复存储单文件上限。',
    );
  }
  const bytes = await fsp.readFile(filePath);
  if (signal?.aborted) {
    throw mirrorError(
      'workspace_command_mirror_cancelled',
      '项目命令变更收集已取消。',
    );
  }
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex') };
}

function binaryDiffSummary(relativePath, beforeBytes, afterBytes) {
  return [
    `--- ${beforeBytes ? `a/${relativePath}` : '/dev/null'}`,
    `+++ b/${relativePath}`,
    `二进制文件：${beforeBytes?.byteLength ?? 0} -> ${afterBytes?.byteLength ?? 0} 字节。`,
  ].join('\n');
}

function changeDiff(relativePath, beforeBytes, afterBytes) {
  try {
    return createWorkspaceFileDiff({
      relativePath,
      beforeBytes,
      afterBytes,
    });
  } catch {
    return {
      text: binaryDiffSummary(relativePath, beforeBytes, afterBytes),
      truncated: false,
    };
  }
}

export async function collectCommandMirrorChanges({
  sourcePath,
  mirrorPath,
  baseManifestBytes,
  expectedIdentity,
  signal,
  boundaryScanner = scanWorkspaceFileBoundary,
}) {
  const base = parseCommandMirrorManifest(baseManifestBytes);
  const current = await readCommandMirrorManifest(mirrorPath, { signal });
  if (
    current.files.some((file) => file.path.split('/').includes('.git')) ||
    current.directories.some((directory) =>
      directory.path.split('/').includes('.git'),
    )
  ) {
    throw mirrorError(
      'workspace_command_git_metadata_change',
      '命令试图修改 Git 元数据；变更未回写。',
    );
  }
  const diff = diffCommandMirrors(base, { files: current.files });
  if (diff.length > MAX_COMMAND_MIRROR_ENTRIES) {
    throw mirrorError(
      'workspace_command_change_path_limit',
      '项目命令变更路径超过恢复记录上限；没有写入工作区。',
    );
  }
  const currentDirectories = new Set(
    current.directories.map((directory) => directory.path),
  );
  const removedDirectories = base.directories
    .map((directory) => directory.path)
    .filter((relativePath) => !currentDirectories.has(relativePath))
    .sort(
      (left, right) =>
        right.split('/').length - left.split('/').length ||
        right.localeCompare(left),
    );
  const before = new Map(base.files.map((file) => [file.path, file]));
  const boundary = await boundaryScanner(sourcePath, { expectedIdentity });
  if (!boundary?.ok) {
    throw mirrorError(
      'workspace_command_source_boundary_failed',
      '项目工作区身份或文件边界检查未通过；没有写入工作区。',
    );
  }
  const changes = [];
  for (const item of diff) {
    const beforeFile = before.get(item.relativePath);
    let beforeBytes = null;
    let concurrent = false;
    if (beforeFile) {
      try {
        const read = await readLimitedFile(
          path.join(sourcePath, ...item.relativePath.split('/')),
          signal,
        );
        if (read.hash === beforeFile.hash) beforeBytes = read.bytes;
        else concurrent = true;
      } catch (error) {
        if (error?.code === 'ENOENT') concurrent = true;
        else throw error;
      }
    }
    const afterBytes = item.afterExists
      ? (
          await readLimitedFile(
            path.join(mirrorPath, ...item.relativePath.split('/')),
            signal,
          )
        ).bytes
      : null;
    const diffResult = changeDiff(item.relativePath, beforeBytes, afterBytes);
    changes.push({
      relativePath: item.relativePath,
      beforeBytes,
      afterBytes,
      beforeExists: item.beforeExists,
      afterExists: item.afterExists,
      concurrent,
      diffText: diffResult.text,
      diffTruncated: diffResult.truncated,
    });
  }
  return {
    changes,
    removedDirectories,
    gitMetadataSkipped: base.gitMetadataSkipped,
  };
}

async function currentFileHash(target) {
  try {
    const stat = await fsp.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { exists: true, unsupported: true, hash: null };
    }
    if (stat.size > MAX_COMMAND_RECOVERY_BLOB_BYTES) {
      return { exists: true, oversized: true, hash: null };
    }
    const bytes = await fsp.readFile(target);
    return {
      exists: true,
      hash: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, hash: null };
    throw error;
  }
}

async function atomicWriteFile(target, bytes) {
  const temporaryPath = `${target}.noema-command-${randomUUID()}`;
  const handle = await fsp.open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsp.rename(temporaryPath, target);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function prepareCommandParentDirectories(
  sourcePath,
  relativePath,
  { create },
) {
  const segments = relativePath.split('/').slice(0, -1);
  let current = sourcePath;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fsp.lstat(current);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      if (!create) {
        throw mirrorError(
          'workspace_command_target_changed',
          '项目命令目标目录已变化；没有写入工作区。',
        );
      }
      await fsp.mkdir(current);
      stat = await fsp.lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw mirrorError(
        'workspace_command_parent_unsafe',
        '项目命令目标父目录不是普通目录；没有写入工作区。',
      );
    }
  }
}

export async function removeCommandDirectories(
  sourcePath,
  directories,
  { signal } = {},
) {
  let removed = 0;
  let unknown = 0;
  for (const relativePath of directories) {
    if (signal?.aborted) return { removed, unknown: unknown + 1 };
    const target = path.resolve(
      sourcePath,
      ...normalizeCommandRelativePath(relativePath).split('/'),
    );
    const relative = path.relative(sourcePath, target);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      unknown += 1;
      continue;
    }
    try {
      const stat = await fsp.lstat(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        unknown += 1;
        continue;
      }
      await fsp.rmdir(target);
      removed += 1;
    } catch (error) {
      if (
        error?.code === 'ENOENT' ||
        error?.code === 'ENOTEMPTY' ||
        error?.code === 'ENOTDIR'
      ) {
        continue;
      }
      unknown += 1;
    }
  }
  return { removed, unknown };
}

export async function writeCommandChange({
  sourcePath,
  expectedIdentity,
  change,
  signal,
  boundaryChecked = false,
  boundaryScanner = scanWorkspaceFileBoundary,
}) {
  const relativePath = normalizeCommandRelativePath(change.relativePath);
  const target = path.resolve(sourcePath, ...relativePath.split('/'));
  const relative = path.relative(sourcePath, target);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return { status: 'conflict', code: 'workspace_command_path_escape' };
  }
  if (signal?.aborted) {
    return { status: 'unknown', code: 'workspace_command_write_cancelled' };
  }
  if (!boundaryChecked) {
    const boundary = await boundaryScanner(sourcePath, { expectedIdentity });
    if (!boundary?.ok) {
      return { status: 'conflict', code: 'workspace_command_source_boundary' };
    }
  }
  const current = await currentFileHash(target);
  if (current.unsupported || current.oversized) {
    return { status: 'conflict', code: 'workspace_command_target_unsupported' };
  }
  if (
    current.exists !== Boolean(change.beforeBytes) ||
    current.hash !==
      (change.beforeBytes
        ? createHash('sha256').update(change.beforeBytes).digest('hex')
        : null)
  ) {
    return { status: 'conflict', code: 'workspace_command_target_changed' };
  }
  try {
    await prepareCommandParentDirectories(sourcePath, relativePath, {
      create: Boolean(change.afterExists),
    });
  } catch (error) {
    return {
      status: 'conflict',
      code: error?.code ?? 'workspace_command_parent_unsafe',
    };
  }
  if (!change.afterExists) {
    try {
      await fsp.unlink(target);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return { status: 'conflict', code: 'workspace_command_delete_failed' };
      }
    }
    return { status: 'applied', actualHash: null };
  }
  const replacement = change.afterBytes;
  if (!Buffer.isBuffer(replacement)) {
    return { status: 'conflict', code: 'workspace_command_after_missing' };
  }
  try {
    await atomicWriteFile(target, replacement);
  } catch {
    return { status: 'unknown', code: 'workspace_command_write_failed' };
  }
  const verified = await currentFileHash(target);
  const expectedHash = createHash('sha256').update(replacement).digest('hex');
  if (verified.hash !== expectedHash) {
    return { status: 'unknown', code: 'workspace_command_write_unverified' };
  }
  return { status: 'applied', actualHash: expectedHash };
}
