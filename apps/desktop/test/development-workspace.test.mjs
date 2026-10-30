import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createDevelopmentDirectory,
  removeDevelopmentDirectory,
} from '../test-support/development-workspace.mjs';

test('development cleanup preserves the root, siblings and linked outside data', () => {
  const old = process.env.NOEMA_E2E_ROOT_DIR;
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-artifact-boundary-'),
  );
  process.env.NOEMA_E2E_ROOT_DIR = path.join(temporary, 'owned');
  try {
    const owned = createDevelopmentDirectory('run-');
    const outside = path.join(temporary, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), 'preserve');
    assert.throws(
      () => removeDevelopmentDirectory(process.env.NOEMA_E2E_ROOT_DIR),
      /outside/u,
    );
    assert.throws(() => removeDevelopmentDirectory(outside), /outside/u);
    const link = path.join(process.env.NOEMA_E2E_ROOT_DIR, 'external');
    fs.symlinkSync(
      outside,
      link,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.throws(() => removeDevelopmentDirectory(link), /linked/u);
    removeDevelopmentDirectory(owned);
    assert.equal(fs.existsSync(owned), false);
    assert.equal(
      fs.readFileSync(path.join(outside, 'keep'), 'utf8'),
      'preserve',
    );
  } finally {
    if (old === undefined) delete process.env.NOEMA_E2E_ROOT_DIR;
    else process.env.NOEMA_E2E_ROOT_DIR = old;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
