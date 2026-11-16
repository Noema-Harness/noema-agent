import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WorkspaceFileService } from '../../../src/main/execution/workspace-file-service.ts';

test('workspace file service lists and reads a known workspace', async () => {
  const root = realpathSync.native(
    await mkdtemp(path.join(tmpdir(), 'noema-files-')),
  );
  await mkdir(path.join(root, 'docs'));
  await writeFile(path.join(root, 'readme.txt'), 'hello', 'utf8');
  await writeFile(path.join(root, 'docs', 'note.txt'), 'note', 'utf8');
  const service = new WorkspaceFileService({
    isKnownWorkspace: (candidate) => path.resolve(candidate) === root,
  });

  const listing = await service.list({ workspacePath: root });
  assert.equal(listing.root, root);
  assert.deepEqual(
    listing.entries.map((entry) => [entry.name, entry.kind]),
    [
      ['docs', 'directory'],
      ['readme.txt', 'file'],
    ],
  );

  const file = await service.read({
    workspacePath: root,
    relativePath: 'readme.txt',
  });
  assert.equal(file.content, 'hello');
  assert.equal(file.size, 5);
});

test('workspace file service previews supported images from a known workspace', async () => {
  const root = realpathSync.native(
    await mkdtemp(path.join(tmpdir(), 'noema-files-')),
  );
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await writeFile(path.join(root, 'pixel.png'), png);
  await writeFile(path.join(root, 'note.txt'), 'note', 'utf8');
  const service = new WorkspaceFileService({
    isKnownWorkspace: (candidate) => path.resolve(candidate) === root,
  });

  const image = await service.readImage({
    workspacePath: root,
    relativePath: 'pixel.png',
  });
  assert.equal(image.mime, 'image/png');
  assert.equal(image.size, png.length);
  assert.equal(image.dataBase64, png.toString('base64'));

  await assert.rejects(
    service.readImage({
      workspacePath: root,
      relativePath: 'note.txt',
    }),
    (error) => error.code === 'workspace_file_image_unsupported',
  );
});

test('workspace file service rejects unknown roots, traversal and binary files', async () => {
  const root = realpathSync.native(
    await mkdtemp(path.join(tmpdir(), 'noema-files-')),
  );
  const outside = await mkdtemp(path.join(tmpdir(), 'noema-outside-'));
  await writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8');
  await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2, 0]));
  const service = new WorkspaceFileService({
    isKnownWorkspace: (candidate) => path.resolve(candidate) === root,
  });

  await assert.rejects(
    service.list({ workspacePath: outside }),
    (error) => error.code === 'workspace_file_unknown_root',
  );
  await assert.rejects(
    service.read({ workspacePath: root, relativePath: '../secret.txt' }),
    (error) =>
      error.code === 'workspace_file_outside' ||
      error.code === 'workspace_file_invalid_path',
  );
  await assert.rejects(
    service.read({ workspacePath: root, relativePath: 'binary.bin' }),
    (error) => error.code === 'workspace_file_binary',
  );
});

test('workspace file service searches names and text inside a known workspace', async () => {
  const root = realpathSync.native(
    await mkdtemp(path.join(tmpdir(), 'noema-files-')),
  );
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(
    path.join(root, 'src', 'app.txt'),
    'first line\nconst needle = 42;\nlast line',
    'utf8',
  );
  await writeFile(path.join(root, 'needle-name.txt'), 'nothing', 'utf8');
  await writeFile(
    path.join(root, 'node_modules', 'ignored.txt'),
    'needle should be skipped',
    'utf8',
  );
  const service = new WorkspaceFileService({
    isKnownWorkspace: (candidate) => path.resolve(candidate) === root,
  });

  const result = await service.search({
    workspacePath: root,
    query: 'needle',
  });
  assert.ok(result.matches.some((match) => match.kind === 'name'));
  assert.ok(
    result.matches.some(
      (match) =>
        match.kind === 'content' &&
        match.relativePath === 'src/app.txt' &&
        match.line === 2,
    ),
  );
  assert.ok(
    result.matches.every(
      (match) => !match.relativePath.startsWith('node_modules/'),
    ),
  );
  await assert.rejects(
    service.search({ workspacePath: root, query: '   ' }),
    (error) => error.code === 'workspace_file_invalid_query',
  );
});

test('workspace file service opens only a known workspace folder', async () => {
  const root = realpathSync.native(
    await mkdtemp(path.join(tmpdir(), 'noema-files-')),
  );
  const opened = [];
  const service = new WorkspaceFileService({
    isKnownWorkspace: (candidate) => path.resolve(candidate) === root,
    openPath: async (target) => {
      opened.push(target);
      return '';
    },
  });

  assert.deepEqual(await service.openFolder({ workspacePath: root }), { root });
  assert.deepEqual(opened, [root]);
  await assert.rejects(
    service.openFolder({ workspacePath: path.join(root, '..') }),
    (error) => error.code === 'workspace_file_unknown_root',
  );
});
