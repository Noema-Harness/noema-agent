import { createHash } from 'node:crypto';

export const MAX_WORKSPACE_FILE_DIFF_BYTES = 64 * 1024;
const MAX_DIFF_LINES = 2_000;

export function workspaceFileContentHash(bytes) {
  if (!Buffer.isBuffer(bytes))
    throw new TypeError('File content must be a Buffer.');
  return createHash('sha256').update(bytes).digest('hex');
}

function truncateUtf8(value, maxBytes) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= maxBytes) return { text: value, truncated: false };
  const suffix = '\n… 差异已截断。';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  let prefix = bytes.subarray(0, maxBytes - suffixBytes);
  while (prefix.length) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(prefix);
      break;
    } catch {
      prefix = prefix.subarray(0, -1);
    }
  }
  return {
    text: `${prefix.toString('utf8')}${suffix}`,
    truncated: true,
  };
}

function decodeLines(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const trailingNewline = text.endsWith('\n');
  const lines = text.split(/\r?\n/u);
  if (trailingNewline) lines.pop();
  if (!text.length) lines.length = 0;
  return { text, lines, trailingNewline };
}

/** Build a deterministic, bounded unified-style text diff without Git helpers. */
export function createWorkspaceFileDiff({
  relativePath,
  beforeBytes,
  afterBytes,
  maxBytes = MAX_WORKSPACE_FILE_DIFF_BYTES,
}) {
  if (
    typeof relativePath !== 'string' ||
    !relativePath.length ||
    !Buffer.isBuffer(afterBytes) ||
    (beforeBytes !== null && !Buffer.isBuffer(beforeBytes)) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 256 ||
    maxBytes > MAX_WORKSPACE_FILE_DIFF_BYTES
  ) {
    throw new TypeError('Workspace file diff request is invalid.');
  }
  const before = beforeBytes ?? Buffer.alloc(0);
  const oldFile = decodeLines(before);
  const newFile = decodeLines(afterBytes);
  const oldLines = oldFile.lines;
  const newLines = newFile.lines;
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    const summary = [
      `--- ${beforeBytes === null ? '/dev/null' : `a/${relativePath}`}`,
      `+++ b/${relativePath}`,
      `差异行数超过 ${MAX_DIFF_LINES} 行比较上限。`,
      `旧文件：${before.byteLength} 字节；新文件：${afterBytes.byteLength} 字节。`,
    ].join('\n');
    return {
      ...truncateUtf8(summary, maxBytes),
      addedLines: null,
      removedLines: null,
    };
  }

  const columns = newFile.lines.length + 1;
  const scores = new Uint32Array((oldLines.length + 1) * columns);
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (
      let newIndex = newFile.lines.length - 1;
      newIndex >= 0;
      newIndex -= 1
    ) {
      const cell = oldIndex * columns + newIndex;
      scores[cell] =
        oldLines[oldIndex] === newLines[newIndex]
          ? scores[(oldIndex + 1) * columns + newIndex + 1] + 1
          : Math.max(
              scores[(oldIndex + 1) * columns + newIndex],
              scores[oldIndex * columns + newIndex + 1],
            );
    }
  }

  const operations = [];
  let oldIndex = 0;
  let newIndex = 0;
  let addedLines = 0;
  let removedLines = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      operations.push(` ${oldLines[oldIndex]}`);
      oldIndex += 1;
      newIndex += 1;
    } else if (
      oldIndex < oldLines.length &&
      (newIndex >= newLines.length ||
        scores[(oldIndex + 1) * columns + newIndex] >=
          scores[oldIndex * columns + newIndex + 1])
    ) {
      operations.push(`-${oldLines[oldIndex]}`);
      oldIndex += 1;
      removedLines += 1;
    } else {
      operations.push(`+${newLines[newIndex]}`);
      newIndex += 1;
      addedLines += 1;
    }
  }
  if (oldFile.trailingNewline !== newFile.trailingNewline) {
    operations.push('\\ 文件结尾换行符已变化');
  }
  const diff = [
    `--- ${beforeBytes === null ? '/dev/null' : `a/${relativePath}`}`,
    `+++ b/${relativePath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...operations,
  ].join('\n');
  return {
    ...truncateUtf8(diff, maxBytes),
    addedLines,
    removedLines,
  };
}
