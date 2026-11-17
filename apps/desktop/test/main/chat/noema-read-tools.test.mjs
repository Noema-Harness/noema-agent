import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createNoemaReadTools } from '../../../src/main/chat/noema-read-tools.ts';

test('read tools inspect files without exposing writes', async () => {
  // Real path: macOS tmpdir() is a symlink and the tools report resolved paths.
  const home = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'noema-read-tools-home-')),
  );
  const outside = mkdtempSync(path.join(tmpdir(), 'noema-read-tools-outside-'));
  try {
    mkdirSync(path.join(home, 'src'));
    writeFileSync(
      path.join(home, 'src', 'note.txt'),
      'first line\nNEEDLE here\n',
      'utf8',
    );
    writeFileSync(path.join(outside, 'machine.txt'), 'MACHINE_SCOPE', 'utf8');
    const tools = createNoemaReadTools({ home });
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['read_file', 'list_files', 'search_text'],
    );

    const read = await byName.read_file.handler({ path: 'src/note.txt' });
    assert.equal(read.content, 'first line\nNEEDLE here\n');
    assert.equal(read.bytes, 23);

    const listed = await byName.list_files.handler({ path: 'src' });
    assert.deepEqual(listed.entries, [{ name: 'note.txt', type: 'file' }]);

    const found = await byName.search_text.handler({ query: 'NEEDLE' });
    assert.equal(found.matches.length, 1);
    assert.equal(
      found.matches[0].path,
      path.join(home, 'src', 'note.txt').replaceAll('\\', '/'),
    );
    assert.equal(found.matches[0].line, 2);

    const absolute = await byName.read_file.handler({
      path: path.join(outside, 'machine.txt'),
    });
    assert.equal(absolute.content, 'MACHINE_SCOPE');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('read tools reject missing files and directories that are not directories', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'noema-read-tools-'));
  try {
    writeFileSync(path.join(home, 'file.txt'), 'x', 'utf8');
    const tools = createNoemaReadTools({ home });
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    await assert.rejects(
      () => byName.read_file.handler({ path: 'missing.txt' }),
      /ENOENT/,
    );
    await assert.rejects(
      () => byName.list_files.handler({ path: 'file.txt' }),
      /目标不是目录/,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
