import assert from 'node:assert/strict';
import test from 'node:test';
import { compileWindowsCommandPolicy } from '../../../src/main/execution/windows-command-policy.ts';

const capabilities = {
  filesystemDefaultDeny: true,
  filesystemReadAllowlist: true,
  filesystemWriteAllowlist: true,
  pathIdentityValidation: true,
  workingDirectoryConfinement: true,
  environmentConfinement: true,
  networkDefaultDeny: true,
  identityBoundNetworkBroker: true,
};
const fileIdentity = {
  volumeSerialNumber: '1322565339',
  fileIndex: '844424930573881',
};
const pathRoot = (path) => ({ path, fileIdentity });

function request(overrides = {}) {
  return {
    backend: {
      id: 'noema-codex-windows',
      version: '0.1.0',
      policyVersion: 3,
      capabilities,
    },
    requestId: 'test-request-identity-123456',
    workspace: pathRoot('C:\\Users\\me\\project'),
    externalAccess: [
      {
        ...pathRoot('C:\\Users\\me\\.npmrc'),
        access: 'read',
      },
      {
        ...pathRoot('D:\\artifacts\\out'),
        access: 'write',
      },
    ],
    runtimeReadRoots: [pathRoot('C:\\Program Files\\Noema\\runtime')],
    cwd: pathRoot('C:\\Users\\me\\project\\src'),
    filesystemMode: 'read-write',
    network: { mode: 'deny' },
    command: 'private command text',
    env: { SECRET: 'private environment value' },
    ...overrides,
  };
}

test('compiles workspace, external and runtime grants to the minimum roots', () => {
  const result = compileWindowsCommandPolicy(request());
  assert.equal(result.ok, true);
  assert.deepEqual(result.policy.filesystem.readRoots, [
    pathRoot('C:\\Program Files\\Noema\\runtime'),
    pathRoot('C:\\Users\\me\\.npmrc'),
    pathRoot('C:\\Users\\me\\project'),
    pathRoot('D:\\artifacts\\out'),
  ]);
  assert.deepEqual(result.policy.filesystem.writeRoots, [
    pathRoot('C:\\Users\\me\\project'),
    pathRoot('D:\\artifacts\\out'),
  ]);
  assert.equal(result.policy.filesystem.mode, 'read-write');
  assert.equal(result.policy.version, 3);
  assert.equal(result.policy.filesystem.defaultDeny, true);
  assert.equal(result.policy.requestId, 'test-request-identity-123456');
  assert.deepEqual(result.policy.environment, {
    inherit: false,
    allowNames: ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'LOCALAPPDATA'],
  });
  assert.deepEqual(result.policy.network, {
    mode: 'deny',
    identity: 'test-request-identity-123456',
  });
  assert.equal(JSON.stringify(result).includes('private command text'), false);
  assert.equal(
    JSON.stringify(result).includes('private environment value'),
    false,
  );
});

test('does not widen read-only external grants into write roots', () => {
  const result = compileWindowsCommandPolicy(
    request({
      externalAccess: [{ ...pathRoot('C:\\data\\reference'), access: 'read' }],
    }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.policy.filesystem.writeRoots, [
    pathRoot('C:\\Users\\me\\project'),
  ]);
});

test('read-only mode keeps the workspace readable with no write roots', () => {
  const result = compileWindowsCommandPolicy(
    request({
      filesystemMode: 'read-only',
      externalAccess: [{ ...pathRoot('C:\\data\\reference'), access: 'read' }],
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.policy.filesystem.mode, 'read-only');
  assert.deepEqual(result.policy.filesystem.writeRoots, []);
  assert.ok(
    result.policy.filesystem.readRoots.some(
      (root) => root.path === 'C:\\Users\\me\\project',
    ),
  );
});

test('read-only mode rejects external write grants before compiling a policy', () => {
  assert.deepEqual(
    compileWindowsCommandPolicy(request({ filesystemMode: 'read-only' })),
    { ok: false, code: 'write_access_unavailable' },
  );
});

test('rejects a missing or unknown filesystem mode', () => {
  assert.deepEqual(
    compileWindowsCommandPolicy(request({ filesystemMode: undefined })),
    { ok: false, code: 'invalid_filesystem_mode' },
  );
  assert.deepEqual(
    compileWindowsCommandPolicy(request({ filesystemMode: 'write-only' })),
    { ok: false, code: 'invalid_filesystem_mode' },
  );
});

test('rejects when required backend policy capability is absent', () => {
  const result = compileWindowsCommandPolicy(
    request({
      backend: {
        ...request().backend,
        capabilities: { ...capabilities, filesystemDefaultDeny: false },
      },
    }),
  );
  assert.deepEqual(result, {
    ok: false,
    code: 'required_backend_capability_missing',
  });
});

test('rejects unverified filesystem object identity without echoing its path', () => {
  const result = compileWindowsCommandPolicy(
    request({
      workspace: {
        path: 'C:\\private\\workspace',
        fileIdentity: undefined,
      },
    }),
  );
  assert.deepEqual(result, { ok: false, code: 'path_identity_unverified' });
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('rejects cwd outside the authorized workspace', () => {
  assert.deepEqual(
    compileWindowsCommandPolicy(
      request({
        cwd: pathRoot('C:\\Users\\me\\private'),
      }),
    ),
    { ok: false, code: 'working_directory_outside_workspace' },
  );
});

test('rejects cwd whose backend object identity is unverified', () => {
  assert.deepEqual(
    compileWindowsCommandPolicy(
      request({
        cwd: { path: 'C:\\Users\\me\\project\\src', fileIdentity: null },
      }),
    ),
    { ok: false, code: 'path_identity_unverified' },
  );
});

test('rejects runtime read roots that would widen a workspace grant', () => {
  assert.deepEqual(
    compileWindowsCommandPolicy(
      request({
        runtimeReadRoots: [pathRoot('C:\\Users\\me')],
      }),
    ),
    { ok: false, code: 'runtime_root_widens_read_access' },
  );
});

test('rejects drive roots and UNC paths as grant roots', () => {
  for (const unsafePath of ['C:\\', '\\\\server\\share\\data']) {
    assert.deepEqual(
      compileWindowsCommandPolicy(
        request({
          externalAccess: [{ ...pathRoot(unsafePath), access: 'read' }],
        }),
      ),
      { ok: false, code: 'path_identity_unverified' },
    );
  }
});

test('rejects Win32 alternate streams, device names and ambiguous components', () => {
  for (const unsafePath of [
    'D:\\artifacts\\file:stream',
    'D:\\artifacts\\trailing.',
    'D:\\artifacts\\trailing ',
    'D:\\artifacts\\CON.txt',
    'D:\\artifacts\\LPT²',
    'D:\\artifacts\\bad?name',
    'D:\\artifacts\\..\\outside',
  ]) {
    assert.deepEqual(
      compileWindowsCommandPolicy(
        request({
          externalAccess: [{ ...pathRoot(unsafePath), access: 'read' }],
        }),
      ),
      { ok: false, code: 'path_identity_unverified' },
    );
  }
});

test('requires an identity-bound network broker for prompted network access', () => {
  const result = compileWindowsCommandPolicy(
    request({
      backend: {
        ...request().backend,
        capabilities: { ...capabilities, identityBoundNetworkBroker: false },
      },
      network: { mode: 'prompt-per-destination' },
    }),
  );
  assert.deepEqual(result, {
    ok: false,
    code: 'identity_bound_network_unavailable',
  });
});
