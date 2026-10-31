import assert from 'node:assert/strict';
import {
  mkdtempSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildWindowsWriteGrantCleanupArgs,
  buildFilesystemPolicy,
  runProjectCommandInSandbox,
  resolveNoemaSrtWinExecutable,
  resolveRequestedCommandAccess,
  windowsCommandSandboxSupport,
} from '../../../src/main/execution/project-command-sandbox.mjs';

test('Windows commands stay disabled until a backend preserves Noema network boundaries', () => {
  const win10 = windowsCommandSandboxSupport('win32', '10.0.19045');
  assert.equal(win10.supported, false);
  assert.match(win10.reason, /工作区边界绕过/u);
  assert.equal(win10.build, 19045);
  for (const release of ['10.0.26100', '10.0.26200']) {
    const support = windowsCommandSandboxSupport('win32', release);
    assert.equal(support.supported, false);
    assert.match(support.reason, /身份绑定/u);
    assert.equal(support.build, Number(release.split('.').at(-1)));
  }
  assert.equal(
    windowsCommandSandboxSupport('win32', '10.0.22631').supported,
    false,
  );
  assert.deepEqual(windowsCommandSandboxSupport('linux', '6.8.0'), {
    supported: true,
  });
  assert.equal(
    windowsCommandSandboxSupport('win32', 'unknown').supported,
    false,
  );
});

test('unsupported Windows commands fail closed before prompts or sandbox initialization', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-command-win10-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  try {
    for (const osRelease of ['10.0.19045', '10.0.22631', '10.0.26100']) {
      const harness = makeSandboxHarness();
      let permissionPrompts = 0;
      await assert.rejects(
        runProjectCommandInSandbox({
          ...sandboxTestOptions(workspace, harness),
          platform: 'win32',
          osRelease,
          supportCheck: windowsCommandSandboxSupport,
          additionalAccess: [
            { path: 'C:\\external', access: 'read', reason: 'test' },
          ],
          authorizeAdditionalAccess: async () => {
            permissionPrompts += 1;
            return true;
          },
          authorizeNetwork: async () => {
            permissionPrompts += 1;
            return true;
          },
        }),
        (error) =>
          error.code === 'command_sandbox_unavailable' &&
          error.effectStatus === 'not_applied' &&
          error.message.includes(osRelease.split('.').at(-1)),
      );
      assert.equal(permissionPrompts, 0);
      assert.equal(harness.state.runtimeLoads, 0);
      assert.equal(harness.state.resetCalls, 0);
      assert.equal(harness.state.wrappedCommands.length, 0);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows uses the patched helper from packaged resources', () => {
  assert.equal(
    resolveNoemaSrtWinExecutable({
      platform: 'win32',
      arch: 'x64',
      cwd: 'C:\\app',
      resourcesPath: 'C:\\app\\resources',
      exists: (candidate) =>
        candidate === 'C:\\app\\resources\\srt-win\\x64\\srt-win.exe',
    }),
    'C:\\app\\resources\\srt-win\\x64\\srt-win.exe',
  );
});

test('Windows development resolves the repo helper and fails closed if missing', () => {
  const expected =
    'C:\\work\\noema\\apps\\desktop\\vendor\\srt-win\\x64\\srt-win.exe';
  assert.equal(
    resolveNoemaSrtWinExecutable({
      platform: 'win32',
      arch: 'x64',
      cwd: 'C:\\work\\noema',
      resourcesPath: undefined,
      exists: (candidate) => candidate === expected,
    }),
    expected,
  );
  assert.throws(
    () =>
      resolveNoemaSrtWinExecutable({
        platform: 'win32',
        arch: 'x64',
        cwd: 'C:\\work\\noema',
        resourcesPath: undefined,
        exists: () => false,
      }),
    /helper 缺失/u,
  );
});

test('Windows command sandbox rejects unbuilt architectures', () => {
  assert.throws(
    () =>
      resolveNoemaSrtWinExecutable({
        platform: 'win32',
        arch: 'arm64',
      }),
    /只打包了 x64/u,
  );
});

test('persistent Windows grant cleanup excludes the current process from live-holder checks', () => {
  assert.deepEqual(buildWindowsWriteGrantCleanupArgs(42), [
    'acl',
    'forget',
    '--all',
    '--unless-held-by-others',
    '42',
  ]);
});

function makeSandboxHarness({
  onInitialize,
  srtWinExe = process.execPath,
} = {}) {
  const state = {
    runtimeLoads: 0,
    resetCalls: 0,
    unregisterCalls: 0,
    wrappedCommands: [],
    writeGrantCleanupCalls: 0,
  };
  const SandboxManager = {
    async reset() {
      state.resetCalls += 1;
    },
    async initialize(configuration, askForNetwork) {
      state.configuration = configuration;
      state.askForNetwork = askForNetwork;
      await onInitialize?.(configuration, askForNetwork, state);
    },
    async wrapWithSandboxArgv(command) {
      state.wrappedCommands.push(command);
      return {
        argv: [process.execPath, '-e', 'process.stdout.write("sandbox test")'],
        env: process.env,
      };
    },
    unregisterCommandNetworkLists() {
      state.unregisterCalls += 1;
    },
    annotateStderrWithSandboxFailures(_commandId, stderr) {
      return stderr;
    },
  };
  return {
    state,
    runtimeLoader: async () => {
      state.runtimeLoads += 1;
      return {
        SandboxManager,
        VENDORED_SRT_WIN_EXE: srtWinExe,
        resolveSrtWin: () => ({ exe: srtWinExe, prependArgs: [] }),
      };
    },
    clearWriteGrants: async () => {
      state.writeGrantCleanupCalls += 1;
    },
  };
}

function sandboxTestOptions(
  workspacePath,
  harness,
  signal = new AbortController().signal,
) {
  return {
    command: 'test command',
    workspacePath,
    signal,
    timeoutMs: 10_000,
    runtimeLoader: harness.runtimeLoader,
    clearWriteGrants: harness.clearWriteGrants,
    ensureAmbientProtection: async () => {},
    supportCheck: () => ({ supported: true }),
    osRelease: '10.0.22631',
  };
}

test('Windows requires ambient volume protection before sandbox initialization', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows volume protection');

  const directory = mkdtempSync(path.join(tmpdir(), 'noema-command-ambient-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const harness = makeSandboxHarness();
  const events = [];
  const runtimeLoader = async () => {
    const runtime = await harness.runtimeLoader();
    return {
      ...runtime,
      SandboxManager: {
        ...runtime.SandboxManager,
        async initialize(configuration, askForNetwork) {
          events.push('initialize');
          return runtime.SandboxManager.initialize(
            configuration,
            askForNetwork,
          );
        },
      },
    };
  };
  try {
    await runProjectCommandInSandbox({
      ...sandboxTestOptions(workspace, harness),
      runtimeLoader,
      ensureAmbientProtection: async ({ exe }) => {
        assert.equal(exe, process.execPath);
        events.push('ambient');
      },
    });
    assert.deepEqual(events, ['ambient', 'initialize']);

    const blockedHarness = makeSandboxHarness();
    await assert.rejects(
      runProjectCommandInSandbox({
        ...sandboxTestOptions(workspace, blockedHarness),
        ensureAmbientProtection: async () => {
          throw new Error('administrator repair cancelled');
        },
      }),
      (error) =>
        /administrator repair cancelled/u.test(error.message) &&
        error.effectStatus === 'not_applied',
    );
    assert.equal(blockedHarness.state.resetCalls, 0);
    assert.equal(blockedHarness.state.wrappedCommands.length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('filesystem policy grants only explicit reads and writes without machine-root ACL denies', () => {
  const policy = buildFilesystemPolicy({
    readRoots: ['C:\\work\\repo', 'C:\\tools\\node'],
    writeRoots: ['C:\\work\\repo'],
  });
  assert.deepEqual(policy, {
    allowRead: ['C:\\work\\repo', 'C:\\tools\\node'],
    allowWrite: ['C:\\work\\repo'],
    denyRead: [],
    denyWrite: [],
  });
});

test('command sandbox access requests resolve to the narrow canonical external path', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-command-policy-'));
  const workspace = path.join(directory, 'workspace');
  const external = path.join(directory, 'external');
  mkdirSync(workspace);
  mkdirSync(external);
  writeFileSync(path.join(external, 'input.txt'), 'input');
  try {
    const result = resolveRequestedCommandAccess(workspace, [
      { path: external, access: 'read', reason: '读取用户指定的输入文件' },
    ]);
    assert.deepEqual(result, [
      {
        path: realpathSync(external),
        access: 'read',
        reason: '读取用户指定的输入文件',
      },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('command sandbox does not prompt for paths already inside the workspace', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-command-policy-'));
  const workspace = path.join(directory, 'workspace');
  const child = path.join(workspace, 'assets');
  mkdirSync(child, { recursive: true });
  try {
    assert.deepEqual(
      resolveRequestedCommandAccess(workspace, [
        { path: child, access: 'write', reason: '修改项目资源' },
      ]),
      [],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('command sandbox rejects broad parent grants and nonexistent paths', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-command-policy-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  try {
    assert.throws(
      () =>
        resolveRequestedCommandAccess(workspace, [
          { path: directory, access: 'write', reason: 'test' },
        ]),
      /父目录/u,
    );
    assert.throws(() =>
      resolveRequestedCommandAccess(workspace, [
        {
          path: path.join(directory, 'missing'),
          access: 'read',
          reason: 'test',
        },
      ]),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('denying an external path stops before loading or initializing the sandbox', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-command-deny-'));
  const workspace = path.join(directory, 'workspace');
  const external = path.join(directory, 'external');
  mkdirSync(workspace);
  mkdirSync(external);
  const harness = makeSandboxHarness();
  try {
    await assert.rejects(
      runProjectCommandInSandbox({
        ...sandboxTestOptions(workspace, harness),
        additionalAccess: [
          { path: external, access: 'read', reason: '读取指定数据' },
        ],
        authorizeAdditionalAccess: async () => false,
      }),
      (error) =>
        /用户未批准/u.test(error.message) &&
        error.effectStatus === 'not_applied',
    );
    assert.equal(harness.state.runtimeLoads, 0);
    assert.equal(harness.state.resetCalls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows refuses write grants that would expose an existing hardlink', async (t) => {
  if (process.platform !== 'win32')
    return t.skip('Windows ACL identity semantics');

  const directory = mkdtempSync(path.join(tmpdir(), 'noema-command-hardlink-'));
  const workspace = path.join(directory, 'workspace');
  const external = path.join(directory, 'external');
  const outside = path.join(directory, 'outside');
  mkdirSync(workspace);
  mkdirSync(external);
  mkdirSync(outside);
  const linked = path.join(workspace, 'linked-sentinel.txt');
  const outsideOriginal = path.join(outside, 'sentinel.txt');
  writeFileSync(outsideOriginal, 'unchanged');
  linkSync(outsideOriginal, linked);
  const harness = makeSandboxHarness();
  try {
    await assert.rejects(
      runProjectCommandInSandbox(sandboxTestOptions(workspace, harness)),
      (error) =>
        error.code === 'workspace_hardlink_refused' &&
        error.effectStatus === 'not_applied' &&
        error.message.includes(linked),
    );
    assert.equal(readFileSync(outsideOriginal, 'utf8'), 'unchanged');
    assert.equal(harness.state.runtimeLoads, 0);
    assert.equal(harness.state.resetCalls, 0);

    unlinkSync(linked);
    const approvedAlias = path.join(external, 'approved-alias.txt');
    linkSync(outsideOriginal, approvedAlias);
    const approvedHarness = makeSandboxHarness();
    await assert.rejects(
      runProjectCommandInSandbox({
        ...sandboxTestOptions(workspace, approvedHarness),
        additionalAccess: [
          { path: external, access: 'write', reason: '修改获批目录' },
        ],
        authorizeAdditionalAccess: async () => true,
      }),
      (error) =>
        error.code === 'workspace_hardlink_refused' &&
        error.effectStatus === 'not_applied' &&
        error.message.includes(approvedAlias),
    );
    assert.equal(readFileSync(outsideOriginal, 'utf8'), 'unchanged');
    assert.equal(approvedHarness.state.runtimeLoads, 0);
    assert.equal(approvedHarness.state.resetCalls, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('approved paths and network requests are scoped to the current command', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-command-allow-'));
  const workspace = path.join(directory, 'workspace');
  const external = path.join(directory, 'external');
  mkdirSync(workspace);
  mkdirSync(external);
  const harness = makeSandboxHarness({
    onInitialize: async (_configuration, askForNetwork) => {
      assert.equal(
        await askForNetwork({ host: 'example.test', port: 443 }),
        true,
      );
      assert.equal(
        await askForNetwork({ host: 'example.test', port: 443 }),
        true,
      );
      assert.equal(
        await askForNetwork({ host: 'other.test', port: 443 }),
        true,
      );
    },
  });
  const accessApprovals = [];
  const networkApprovals = [];
  try {
    const result = await runProjectCommandInSandbox({
      ...sandboxTestOptions(workspace, harness),
      additionalAccess: [
        { path: external, access: 'read', reason: '读取指定数据' },
      ],
      authorizeAdditionalAccess: async (request) => {
        accessApprovals.push(request);
        return true;
      },
      authorizeNetwork: async (request) => {
        networkApprovals.push(request);
        return true;
      },
    });
    assert.equal(result.effectStatus, 'applied');
    assert.match(result.output, /sandbox test/u);
    assert.equal(accessApprovals.length, 1);
    assert.equal(networkApprovals.length, 2);
    assert.deepEqual(
      networkApprovals.map(({ host, port }) => [host, port]),
      [
        ['example.test', 443],
        ['other.test', 443],
      ],
    );
    assert.ok(
      harness.state.configuration.filesystem.allowRead.includes(external),
    );
    if (process.platform === 'win32') {
      assert.ok(
        harness.state.configuration.filesystem.allowRead.includes(
          path.dirname(realpathSync(process.execPath)),
        ),
      );
    }
    assert.ok(
      !harness.state.configuration.filesystem.allowWrite.includes(external),
    );
    assert.equal(harness.state.resetCalls, 2);
    assert.equal(harness.state.unregisterCalls, 1);
    if (process.platform === 'win32')
      assert.equal(harness.state.writeGrantCleanupCalls, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows helper is readable from a project workspace that does not contain it', async () => {
  if (process.platform !== 'win32') return;

  const directory = mkdtempSync(path.join(tmpdir(), 'noema-command-helper-'));
  const workspace = path.join(directory, 'customer-project');
  const helper = path.join(directory, 'installed-app', 'srt-win.exe');
  mkdirSync(workspace);
  const harness = makeSandboxHarness({ srtWinExe: helper });
  try {
    await runProjectCommandInSandbox(sandboxTestOptions(workspace, harness));

    assert.ok(
      harness.state.configuration.filesystem.allowRead.includes(helper),
    );
    assert.ok(
      !harness.state.configuration.filesystem.allowWrite.includes(helper),
    );
    assert.deepEqual(harness.state.configuration.filesystem.allowWrite, [
      workspace,
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an approved external write is added to one command policy and cleaned up', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-command-allow-write-'),
  );
  const workspace = path.join(directory, 'workspace');
  const external = path.join(directory, 'external');
  mkdirSync(workspace);
  mkdirSync(external);
  const harness = makeSandboxHarness();
  const approvals = [];
  try {
    const result = await runProjectCommandInSandbox({
      ...sandboxTestOptions(workspace, harness),
      additionalAccess: [
        { path: external, access: 'write', reason: '保存用户指定的交付文件' },
      ],
      authorizeAdditionalAccess: async (request) => {
        approvals.push(request);
        return true;
      },
    });

    assert.equal(result.effectStatus, 'applied');
    assert.equal(approvals.length, 1);
    assert.deepEqual(approvals[0], {
      command: 'test command',
      path: realpathSync(external),
      access: 'write',
      reason: '保存用户指定的交付文件',
    });
    assert.ok(
      harness.state.configuration.filesystem.allowRead.includes(
        realpathSync(external),
      ),
    );
    assert.ok(
      harness.state.configuration.filesystem.allowWrite.includes(
        realpathSync(external),
      ),
    );
    assert.equal(harness.state.resetCalls, 2);
    assert.equal(harness.state.unregisterCalls, 1);
    if (process.platform === 'win32')
      assert.equal(harness.state.writeGrantCleanupCalls, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stopping while an external path prompt is open never loads the sandbox', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-command-stop-ask-'));
  const workspace = path.join(directory, 'workspace');
  const external = path.join(directory, 'external');
  mkdirSync(workspace);
  mkdirSync(external);
  const controller = new AbortController();
  const harness = makeSandboxHarness();
  try {
    await assert.rejects(
      runProjectCommandInSandbox({
        ...sandboxTestOptions(workspace, harness, controller.signal),
        additionalAccess: [
          { path: external, access: 'write', reason: '写入指定结果' },
        ],
        authorizeAdditionalAccess: async () => {
          controller.abort();
          return true;
        },
      }),
      (error) =>
        error.name === 'AbortError' && error.effectStatus === 'not_applied',
    );
    assert.equal(harness.state.runtimeLoads, 0);
    assert.deepEqual(harness.state.wrappedCommands, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stopping during sandbox initialization prevents process launch and cleans up', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-command-stop-init-'),
  );
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const controller = new AbortController();
  const harness = makeSandboxHarness({
    onInitialize: async () => controller.abort(),
  });
  try {
    await assert.rejects(
      runProjectCommandInSandbox(
        sandboxTestOptions(workspace, harness, controller.signal),
      ),
      (error) =>
        error.name === 'AbortError' && error.effectStatus === 'not_applied',
    );
    assert.deepEqual(harness.state.wrappedCommands, []);
    assert.equal(harness.state.resetCalls, 2);
    assert.equal(harness.state.unregisterCalls, 1);
    if (process.platform === 'win32')
      assert.equal(harness.state.writeGrantCleanupCalls, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('initialization failure resets sandbox state and revokes pending grants', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'noema-command-init-fail-'),
  );
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const harness = makeSandboxHarness({
    onInitialize: async () => {
      throw new Error('sandbox init failed');
    },
  });
  try {
    await assert.rejects(
      runProjectCommandInSandbox(sandboxTestOptions(workspace, harness)),
      (error) =>
        /sandbox init failed/u.test(error.message) &&
        error.code === 'command_sandbox_unavailable' &&
        error.effectStatus === 'not_applied',
    );
    assert.deepEqual(harness.state.wrappedCommands, []);
    assert.equal(harness.state.resetCalls, 2);
    assert.equal(harness.state.unregisterCalls, 1);
    if (process.platform === 'win32')
      assert.equal(harness.state.writeGrantCleanupCalls, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
