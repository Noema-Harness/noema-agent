import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('social-work E2E help exits before creating fixtures or calling a model', () => {
  const e2eRoot = mkdtempSync(path.join(tmpdir(), 'noema-social-work-help-'));
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/social-work-e2e.mjs', '--help'],
      {
        cwd: desktopDirectory,
        encoding: 'utf8',
        env: {
          ...process.env,
          NOEMA_E2E_ROOT_DIR: e2eRoot,
          NOEMA_E2E_MODEL: 'invalid should not be parsed',
        },
      },
    );

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Default mode sends a synthetic project request/u,
    );
    assert.match(result.stdout, /Use --synthetic for an offline fixture run/u);
    assert.deepEqual(readdirSync(e2eRoot), []);
  } finally {
    rmSync(e2eRoot, { recursive: true, force: true });
  }
});
