import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WindowsRunnerCapabilityNameStore } from '../../../src/main/execution/windows-runner-capability-name-store.ts';

async function withUserDataPath(run) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'noema-runner-capability-sids-'),
  );
  try {
    return await run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function identity(
  volumeSerialNumber = '1322565339',
  fileIndex = '844424930573881',
) {
  return { volumeSerialNumber, fileIndex };
}

function recordPath(store, fileIdentity, access = 'write') {
  const key = `${fileIdentity.volumeSerialNumber}:${fileIdentity.fileIndex}:${access}`;
  const digest = crypto.createHash('sha256').update(key).digest('hex');
  return path.join(store.recordsDirectoryPath, `${digest}.json`);
}

test('capability name remains stable per verified filesystem object across store instances', async () => {
  await withUserDataPath((userDataPath) => {
    const first = new WindowsRunnerCapabilityNameStore({ userDataPath });
    const second = new WindowsRunnerCapabilityNameStore({ userDataPath });
    const rootIdentity = identity();
    const name = first.getOrCreate(rootIdentity, 'write');
    const readName = first.getOrCreate(rootIdentity, 'read');
    assert.notEqual(readName, name);
    assert.match(name, /^Noema\.Write\.[a-f0-9]{64}$/u);
    assert.match(readName, /^Noema\.Read\.[a-f0-9]{64}$/u);
    assert.equal(second.getOrCreate(rootIdentity, 'write'), name);
    assert.equal(second.getOrCreate(rootIdentity, 'read'), readName);
    assert.notEqual(
      second.getOrCreate(identity('1322565339', '844424930573882'), 'write'),
      name,
    );

    const stored = JSON.parse(
      fs.readFileSync(recordPath(first, rootIdentity, 'write'), 'utf8'),
    );
    assert.deepEqual(stored, {
      version: 3,
      access: 'write',
      ...rootIdentity,
      capabilityName: name,
    });
    assert.equal(JSON.stringify(stored).includes(userDataPath), false);
  });
});

test('capability name store rejects malformed object identities', async () => {
  await withUserDataPath((userDataPath) => {
    const store = new WindowsRunnerCapabilityNameStore({ userDataPath });
    for (const invalid of [
      null,
      { ...identity(), extra: true },
      { volumeSerialNumber: '0', fileIndex: '1' },
      { volumeSerialNumber: '4294967296', fileIndex: '1' },
      { volumeSerialNumber: '1', fileIndex: '18446744073709551616' },
      { volumeSerialNumber: 1n, fileIndex: 2n },
    ]) {
      assert.throws(() => store.getOrCreate(invalid, 'write'), {
        code: 'capability_sid_identity_invalid',
      });
    }
    assert.equal(fs.existsSync(store.recordsDirectoryPath), false);
  });
});

test('capability name store fails closed on a linked or malformed record', async () => {
  await withUserDataPath((userDataPath) => {
    const store = new WindowsRunnerCapabilityNameStore({ userDataPath });
    const rootIdentity = identity();
    const name = store.getOrCreate(rootIdentity, 'write');
    const file = recordPath(store, rootIdentity, 'write');
    const alias = `${file}.alias`;
    fs.linkSync(file, alias);
    assert.throws(() => store.getOrCreate(rootIdentity, 'write'), {
      code: 'capability_sid_record_untrusted',
    });
    fs.unlinkSync(alias);

    fs.writeFileSync(file, '{malformed');
    assert.throws(() => store.getOrCreate(rootIdentity, 'write'), {
      code: 'capability_sid_record_invalid',
    });
    assert.notEqual(name, '');
  });
});

test('capability name store rejects reparse-backed registry directories', async () => {
  await withUserDataPath((userDataPath) => {
    const store = new WindowsRunnerCapabilityNameStore({ userDataPath });
    fs.mkdirSync(store.runnerDirectoryPath);
    const target = path.join(userDataPath, 'capability-target');
    fs.mkdirSync(target);
    fs.symlinkSync(target, store.recordsDirectoryPath, 'junction');
    assert.throws(() => store.getOrCreate(identity(), 'write'), {
      code: 'capability_sid_directory_untrusted',
    });
  });
});

test('capability name access mode is mandatory and restricted to read or write', async () => {
  await withUserDataPath((userDataPath) => {
    const store = new WindowsRunnerCapabilityNameStore({ userDataPath });
    assert.throws(() => store.getOrCreate(identity()), {
      code: 'capability_sid_access_invalid',
    });
    assert.throws(() => store.getOrCreate(identity(), 'read_write'), {
      code: 'capability_sid_access_invalid',
    });
    assert.equal(fs.existsSync(store.recordsDirectoryPath), false);
  });
});
