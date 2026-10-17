import fs from 'node:fs';
import path from 'node:path';

const MAX_CHECKS = 16;
const MAX_RELATIVE_PATH_LENGTH = 500;
const MAX_EXPECTED_TEXT_LENGTH = 2_000;
const MAX_VERIFICATION_FILE_BYTES = 2_000_000;

/** @typedef {{kind:'file_exists',path:string}|{kind:'file_contains'|'file_equals',path:string,text:string}} WorkspaceVerificationCheck */

/** @param {unknown} checks @returns {WorkspaceVerificationCheck[]} */
export function normalizeWorkspaceVerificationChecks(checks) {
  if (checks === undefined || checks === null) return [];
  if (!Array.isArray(checks) || checks.length > MAX_CHECKS) {
    throw new TypeError(`最多允许 ${MAX_CHECKS} 项 Noema 文件验收条件。`);
  }
  return checks.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Noema 文件验收条件结构无效。');
    }
    const check = /** @type {Record<string, unknown>} */ (value);
    if (!['file_exists', 'file_contains', 'file_equals'].includes(check.kind)) {
      throw new TypeError('Noema 只支持文件存在、包含文本或精确文本验收。');
    }
    if (
      typeof check.path !== 'string' ||
      !check.path.trim() ||
      check.path.length > MAX_RELATIVE_PATH_LENGTH ||
      check.path.includes('\0') ||
      path.isAbsolute(check.path) ||
      /^[a-z]:/i.test(check.path)
    ) {
      throw new TypeError('验收路径必须是工作区内的相对路径。');
    }
    const normalizedPath = path.normalize(check.path.trim());
    if (
      normalizedPath === '.' ||
      normalizedPath === '..' ||
      normalizedPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(normalizedPath)
    ) {
      throw new TypeError('验收路径不能离开工作区。');
    }
    if (check.kind === 'file_exists') {
      if (Object.keys(check).some((key) => !['kind', 'path'].includes(key))) {
        throw new TypeError('文件存在验收不能包含额外参数。');
      }
      return { kind: 'file_exists', path: normalizedPath };
    }
    if (
      typeof check.text !== 'string' ||
      check.text.length > MAX_EXPECTED_TEXT_LENGTH ||
      (check.kind === 'file_contains' && !check.text.trim()) ||
      Object.keys(check).some((key) => !['kind', 'path', 'text'].includes(key))
    ) {
      throw new TypeError('文本验收需要一段有界的预期文本。');
    }
    return {
      kind: check.kind,
      path: normalizedPath,
      text: check.text,
    };
  });
}

/** @param {string} workspacePath @param {unknown} rawChecks */
export function verifyWorkspaceChecks(workspacePath, rawChecks) {
  const checks = normalizeWorkspaceVerificationChecks(rawChecks);
  if (checks.length === 0) {
    return { status: 'not_planned', checks: [], repairable: false };
  }
  let workspaceRealPath;
  try {
    workspaceRealPath = fs.realpathSync(workspacePath);
    if (!fs.statSync(workspaceRealPath).isDirectory()) {
      throw new Error('Workspace is not a directory');
    }
  } catch {
    return {
      status: 'unavailable',
      checks: checks.map((check) => ({
        ...check,
        status: 'unavailable',
        reason: 'workspace_unavailable',
      })),
      repairable: false,
    };
  }

  const results = checks.map((check) => verifyOne(workspaceRealPath, check));
  const hasUnavailable = results.some(
    (result) => result.status === 'unavailable',
  );
  const failed = results.some((result) => result.status === 'failed');
  return {
    status: hasUnavailable ? 'unavailable' : failed ? 'failed' : 'verified',
    checks: results,
    repairable:
      !hasUnavailable &&
      failed &&
      results.every(
        (result) =>
          result.status === 'verified' ||
          ['file_missing', 'text_mismatch'].includes(result.reason),
      ),
  };
}

/**
 * @param {string} workspaceRealPath
 * @param {WorkspaceVerificationCheck} check
 */
function verifyOne(workspaceRealPath, check) {
  const targetPath = path.resolve(workspaceRealPath, check.path);
  const relative = path.relative(workspaceRealPath, targetPath);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return {
      ...check,
      status: 'unavailable',
      reason: 'path_outside_workspace',
    };
  }

  let cursor = workspaceRealPath;
  const segments = relative.split(path.sep);
  for (let index = 0; index < segments.length; index++) {
    cursor = path.join(cursor, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { ...check, status: 'failed', reason: 'file_missing' };
      }
      return { ...check, status: 'unavailable', reason: 'path_unreadable' };
    }
    if (stat.isSymbolicLink()) {
      return { ...check, status: 'unavailable', reason: 'symlink_not_checked' };
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      return { ...check, status: 'failed', reason: 'parent_not_directory' };
    }
  }

  try {
    const stat = fs.lstatSync(targetPath);
    if (!stat.isFile()) {
      return { ...check, status: 'failed', reason: 'not_a_file' };
    }
    if (check.kind === 'file_exists') {
      return { ...check, status: 'verified', reason: 'file_exists' };
    }
    if (stat.size > MAX_VERIFICATION_FILE_BYTES) {
      return { ...check, status: 'unavailable', reason: 'file_too_large' };
    }
    const content = fs.readFileSync(targetPath, 'utf8');
    const matches =
      check.kind === 'file_equals'
        ? content === check.text
        : content.includes(check.text);
    return {
      ...check,
      status: matches ? 'verified' : 'failed',
      reason: matches ? 'text_matches' : 'text_mismatch',
    };
  } catch {
    return { ...check, status: 'unavailable', reason: 'file_unreadable' };
  }
}
