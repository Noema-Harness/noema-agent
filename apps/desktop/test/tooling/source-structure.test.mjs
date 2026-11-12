import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { inspectSourceStructure } from '../../../../scripts/source-structure.mjs';
import {
  createDevelopmentDirectory,
  removeDevelopmentDirectory,
} from '../../test-support/development-workspace.mjs';

test('source boundaries reject process leaks, broken imports, cycles and restored flat files', () => {
  const directory = createDevelopmentDirectory('source-boundaries-');
  const sourceRoot = path.join(directory, 'src');
  function write(name, content) {
    const file = path.join(sourceRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  try {
    write('main/main.ts', "import '../shared/value';");
    write('preload/preload.ts', "import { contextBridge } from 'electron';");
    write('renderer/renderer.tsx', "import '../shared/value';");
    write('shared/value.mjs', 'export const value = 1;');
    assert.deepEqual(inspectSourceStructure(sourceRoot).errors, []);
    assert.equal(inspectSourceStructure(sourceRoot).sourceFiles, 4);

    write(
      'renderer/renderer.tsx',
      "import fs from 'node:fs'; import '../main/main'; import './missing';",
    );
    write('shared/value.mjs', "import '../main/main';");
    write('old-entry.ts', 'export const obsolete = true;');
    const errors = inspectSourceStructure(sourceRoot).errors.join('\n');
    for (const message of [
      'Platform import',
      'Cross-process import',
      'Unresolved import',
      'Shared code depends',
      'Runtime import cycle',
      'Unclassified source entry',
    ])
      assert.ok(errors.includes(message), message);

    write('main/main.ts', "import '../../test-support/fixture';");
    fs.mkdirSync(path.join(directory, 'test-support'), { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'test-support/fixture.ts'),
      'export const fixture = true;',
    );
    assert.ok(
      inspectSourceStructure(sourceRoot).errors.some((error) =>
        error.includes('Source depends on development material'),
      ),
    );
  } finally {
    removeDevelopmentDirectory(directory);
  }
});

test('production modules cannot import a quarantined runtime', () => {
  const directory = createDevelopmentDirectory('source-legacy-boundary-');
  const sourceRoot = path.join(directory, 'src');
  function write(name, content) {
    const file = path.join(sourceRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  try {
    write('main/main.ts', "import './legacy/old-runtime.mjs';");
    write('preload/preload.ts', "import { contextBridge } from 'electron';");
    write('renderer/renderer.tsx', "import '../shared/value';");
    write('shared/value.mjs', 'export const value = 1;');
    write('main/legacy/old-runtime.mjs', 'export const legacy = true;');

    const errors = inspectSourceStructure(sourceRoot).errors.join('\n');
    assert.ok(errors.includes('Production imports quarantined runtime'));
  } finally {
    removeDevelopmentDirectory(directory);
  }
});
