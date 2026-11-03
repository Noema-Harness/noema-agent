import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindowsRunnerCapabilityGrants } from '../../../src/main/execution/windows-runner-capability-grants.mjs';

const workspace = {
  path: 'C:\\work\\project',
  fileIdentity: { volumeSerialNumber: '55', fileIndex: '101' },
};
const readonlyRoot = {
  path: 'D:\\reference\\book.pdf',
  fileIdentity: { volumeSerialNumber: '77', fileIndex: '202' },
};
const policy = {
  version: 2,
  filesystem: {
    readRoots: [workspace, readonlyRoot],
    writeRoots: [workspace],
    defaultDeny: true,
  },
};

function statFor(root, { directory = false } = {}) {
  return {
    dev: BigInt(root.fileIdentity.volumeSerialNumber),
    ino: BigInt(root.fileIdentity.fileIndex),
    isDirectory: () => directory,
    isFile: () => !directory,
  };
}

function dependencies({ stats = new Map(), failSid = false } = {}) {
  const calls = [];
  return {
    calls,
    capabilityNameStore: {
      getOrCreate(identity, access) {
        calls.push({ identity, access });
        if (failSid)
          throw Object.assign(new Error('unavailable'), {
            code: 'capability_sid_record_untrusted',
          });
        return access === 'write'
          ? 'Noema.Write.1111111111111111111111111111111111111111111111111111111111111111'
          : 'Noema.Read.2222222222222222222222222222222222222222222222222222222222222222';
      },
    },
    statPath: async (value, options) => {
      assert.deepEqual(options, { bigint: true });
      const stat = stats.get(value.toLowerCase());
      if (!stat) throw new Error('missing fixture');
      return stat;
    },
  };
}

test('compiles one effective capability name per root and upgrades writable roots', async () => {
  const deps = dependencies({
    stats: new Map([
      [workspace.path.toLowerCase(), statFor(workspace, { directory: true })],
      [readonlyRoot.path.toLowerCase(), statFor(readonlyRoot)],
    ]),
  });
  const result = await createWindowsRunnerCapabilityGrants(policy, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(result.grants, [
    {
      path: workspace.path,
      fileIdentity: workspace.fileIdentity,
      access: 'write',
      isDirectory: true,
      capabilityName:
        'Noema.Write.1111111111111111111111111111111111111111111111111111111111111111',
    },
    {
      path: readonlyRoot.path,
      fileIdentity: readonlyRoot.fileIdentity,
      access: 'read',
      isDirectory: false,
      capabilityName:
        'Noema.Read.2222222222222222222222222222222222222222222222222222222222222222',
    },
  ]);
  assert.deepEqual(
    deps.calls.map(({ access }) => access),
    ['write', 'read'],
  );
});

test('rejects write roots outside the read allowlist before creating capability names', async () => {
  const deps = dependencies();
  assert.deepEqual(
    await createWindowsRunnerCapabilityGrants(
      {
        version: 2,
        filesystem: {
          readRoots: [workspace],
          writeRoots: [readonlyRoot],
          defaultDeny: true,
        },
      },
      deps,
    ),
    { ok: false, code: 'capability_grant_policy_invalid' },
  );
  assert.equal(deps.calls.length, 0);
});

test('rejects stale native identity and object aliases before creating capability names', async () => {
  const stale = dependencies({
    stats: new Map([
      [
        workspace.path.toLowerCase(),
        statFor(readonlyRoot, { directory: true }),
      ],
    ]),
  });
  assert.equal(
    (
      await createWindowsRunnerCapabilityGrants(
        {
          version: 2,
          filesystem: {
            readRoots: [workspace],
            writeRoots: [workspace],
            defaultDeny: true,
          },
        },
        stale,
      )
    ).code,
    'path_identity_unavailable',
  );
  assert.equal(stale.calls.length, 0);

  const aliasPolicy = {
    version: 2,
    filesystem: {
      readRoots: [
        workspace,
        { ...readonlyRoot, fileIdentity: workspace.fileIdentity },
      ],
      writeRoots: [workspace],
      defaultDeny: true,
    },
  };
  const alias = dependencies({
    stats: new Map([
      [workspace.path.toLowerCase(), statFor(workspace, { directory: true })],
      [readonlyRoot.path.toLowerCase(), statFor(workspace)],
    ]),
  });
  assert.equal(
    (await createWindowsRunnerCapabilityGrants(aliasPolicy, alias)).code,
    'path_identity_alias',
  );
  assert.equal(alias.calls.length, 0);
});

test('fails closed when the persisted capability name cannot be read or created', async () => {
  const deps = dependencies({
    failSid: true,
    stats: new Map([
      [workspace.path.toLowerCase(), statFor(workspace, { directory: true })],
    ]),
  });
  assert.deepEqual(
    await createWindowsRunnerCapabilityGrants(
      {
        version: 2,
        filesystem: {
          readRoots: [workspace],
          writeRoots: [workspace],
          defaultDeny: true,
        },
      },
      deps,
    ),
    { ok: false, code: 'capability_sid_record_untrusted' },
  );
});

test('rejects malformed or repeated capability names returned by the registry owner', async () => {
  const stats = new Map([
    [workspace.path.toLowerCase(), statFor(workspace, { directory: true })],
    [readonlyRoot.path.toLowerCase(), statFor(readonlyRoot)],
  ]);
  const malformed = dependencies({ stats });
  malformed.capabilityNameStore.getOrCreate = () => 'S-1-1-0';
  assert.equal(
    (await createWindowsRunnerCapabilityGrants(policy, malformed)).code,
    'capability_sid_record_invalid',
  );

  const repeated = dependencies({ stats });
  repeated.capabilityNameStore.getOrCreate = () =>
    'Noema.Read.1111111111111111111111111111111111111111111111111111111111111111';
  assert.equal(
    (await createWindowsRunnerCapabilityGrants(policy, repeated)).code,
    'capability_sid_record_invalid',
  );
});
