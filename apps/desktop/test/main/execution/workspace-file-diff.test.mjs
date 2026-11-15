import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWorkspaceFileDiff,
  MAX_WORKSPACE_FILE_DIFF_BYTES,
} from '../../../src/main/execution/workspace-file-diff.ts';

test('workspace file diff reports created, modified, and deleted text files', () => {
  const created = createWorkspaceFileDiff({
    relativePath: 'new.txt',
    beforeBytes: null,
    afterBytes: Buffer.from('hello\n'),
  });
  assert.match(created.text, /--- \/dev\/null/u);
  assert.match(created.text, /\+hello/u);

  const modified = createWorkspaceFileDiff({
    relativePath: 'file.txt',
    beforeBytes: Buffer.from('before\n'),
    afterBytes: Buffer.from('after\n'),
  });
  assert.match(modified.text, /-before/u);
  assert.match(modified.text, /\+after/u);
  assert.equal(modified.addedLines, 1);
  assert.equal(modified.removedLines, 1);

  const deleted = createWorkspaceFileDiff({
    relativePath: 'gone.txt',
    beforeBytes: Buffer.from('gone'),
    afterBytes: Buffer.alloc(0),
  });
  assert.match(deleted.text, /-gone/u);
});

test('workspace file diff preserves no-final-newline changes and bounds output bytes', () => {
  const newline = createWorkspaceFileDiff({
    relativePath: 'line.txt',
    beforeBytes: Buffer.from('line'),
    afterBytes: Buffer.from('line\n'),
  });
  assert.match(newline.text, /结尾换行符/u);

  const bounded = createWorkspaceFileDiff({
    relativePath: 'large.txt',
    beforeBytes: Buffer.alloc(0),
    afterBytes: Buffer.from('字'.repeat(10_000)),
    maxBytes: 512,
  });
  assert.equal(bounded.truncated, true);
  assert.ok(Buffer.byteLength(bounded.text, 'utf8') <= 512);
});

test('workspace file diff avoids building an unbounded LCS matrix', () => {
  const manyLines = Buffer.from(
    Array.from({ length: 2_001 }, (_, n) => `${n}\n`).join(''),
  );
  const diff = createWorkspaceFileDiff({
    relativePath: 'many.txt',
    beforeBytes: Buffer.alloc(0),
    afterBytes: manyLines,
  });
  assert.match(diff.text, /比较上限/u);
  assert.ok(
    Buffer.byteLength(diff.text, 'utf8') <= MAX_WORKSPACE_FILE_DIFF_BYTES,
  );
});
