import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  resolveNoemaSrtWinExecutable,
  runProjectCommandInSandbox,
} from '../src/project-command-sandbox.mjs';

const usage = `Noema Windows command-sandbox integration check

Usage:
  npm run e2e:sandbox --workspace noema-desktop

Requires a provisioned Windows x64 SRT sandbox account. Uses only temporary
files and a network request whose host approval is explicitly denied.
`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(usage);
  process.exit(0);
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('This integration check requires Windows x64.');
}

const helperPath =
  process.env.NOEMA_SRT_WIN_EXE || resolveNoemaSrtWinExecutable();
if (!existsSync(helperPath)) {
  throw new Error(`The packaged Windows SRT helper is missing: ${helperPath}`);
}

const root = mkdtempSync(path.join(tmpdir(), 'noema-sandbox-e2e-'));
const workspace = path.join(root, 'workspace');
const outside = path.join(root, 'outside');
mkdirSync(workspace);
mkdirSync(outside);
const workspaceRoot = path.parse(workspace).root.toLowerCase();
const alternateDrive = Array.from(
  { length: 26 },
  (_, index) => `${String.fromCharCode(65 + index)}:\\`,
).find((drive) => drive.toLowerCase() !== workspaceRoot && existsSync(drive));
let alternateRoot;

const run = (options) =>
  runProjectCommandInSandbox({
    command: options.command,
    workspacePath: options.workspacePath ?? workspace,
    signal: new AbortController().signal,
    timeoutMs: options.timeoutMs ?? 12_000,
    additionalAccess: options.additionalAccess,
    authorizeAdditionalAccess: options.authorizeAdditionalAccess,
    authorizeNetwork: options.authorizeNetwork,
    runtimeLoader: async () => {
      const runtime = await import('@anthropic-ai/sandbox-runtime');
      return { ...runtime, VENDORED_SRT_WIN_EXE: helperPath };
    },
  });

const assertExitCode = (result, expected, label) => {
  const passed = result.output.startsWith(`退出码：${expected}`);
  assert.ok(passed, `${label} failed:\n${result.output}`);
};

const passed = [];
const failed = [];

try {
  const workspaceFile = path.join(workspace, 'workspace.txt');
  let result = await run({
    command: 'echo workspace-ok > workspace.txt',
  });
  assertExitCode(result, 0, 'workspace write');
  assert.equal(readFileSync(workspaceFile, 'utf8').trim(), 'workspace-ok');
  passed.push('workspace write is allowed');

  const outsideFile = path.join(outside, 'sentinel.txt');
  writeFileSync(outsideFile, 'unchanged');
  result = await run({
    command: `echo unauthorized > "${outsideFile}"`,
  });
  assert.notEqual(result.output.match(/退出码：(\d+)/u)?.[1], '0');
  assert.equal(readFileSync(outsideFile, 'utf8'), 'unchanged');
  passed.push('unapproved outside write is denied');

  const outsideStreamBase = path.join(outside, 'stream-base.txt');
  writeFileSync(outsideStreamBase, 'stream-base');
  const outsideStream = `${outsideStreamBase}:noema-e2e`;
  result = await run({
    command: `echo ads-escape > "${outsideStream}"`,
  });
  if (
    result.output.match(/退出码：(\d+)/u)?.[1] === '0' ||
    existsSync(outsideStream)
  ) {
    failed.push(
      'an unapproved write created an outside NTFS alternate data stream',
    );
  } else {
    assert.equal(readFileSync(outsideStreamBase, 'utf8'), 'stream-base');
    passed.push(
      'an outside NTFS alternate data stream cannot be written without approval',
    );
  }

  const junction = path.join(workspace, 'outside-link');
  symlinkSync(outside, junction, 'junction');
  result = await run({
    command: `echo junction-escape > "${path.join(junction, 'sentinel.txt')}"`,
  });
  assert.notEqual(result.output.match(/退出码：(\d+)/u)?.[1], '0');
  assert.equal(readFileSync(outsideFile, 'utf8'), 'unchanged');
  passed.push('junction cannot escape the workspace write boundary');

  const nestedDirectory = path.join(workspace, 'nested', 'deeper');
  mkdirSync(nestedDirectory, { recursive: true });
  const nestedJunction = path.join(nestedDirectory, 'outside-link');
  symlinkSync(outside, nestedJunction, 'junction');
  result = await run({
    command: `echo nested-junction-escape > "${path.join(nestedJunction, 'sentinel.txt')}"`,
  });
  assert.notEqual(result.output.match(/退出码：(\d+)/u)?.[1], '0');
  assert.equal(readFileSync(outsideFile, 'utf8'), 'unchanged');
  passed.push('nested junction cannot escape the workspace write boundary');

  const workspaceAlias = path.join(root, 'workspace-alias');
  symlinkSync(workspace, workspaceAlias, 'junction');
  result = await run({
    workspacePath: workspaceAlias,
    command: 'echo workspace-alias-ok > alias.txt',
  });
  assertExitCode(result, 0, 'junction workspace root');
  assert.equal(
    readFileSync(path.join(workspace, 'alias.txt'), 'utf8').trim(),
    'workspace-alias-ok',
  );
  passed.push('a junction workspace root resolves to its canonical workspace');

  const outsideHardlink = path.join(workspace, 'outside-hardlink.txt');
  let outsideContentAfterHardlink = 'unchanged';
  linkSync(outsideFile, outsideHardlink);
  await assert.rejects(
    run({
      command: `echo hardlink-escape > "${outsideHardlink}"`,
    }),
    (error) => error.code === 'workspace_hardlink_refused',
  );
  outsideContentAfterHardlink = readFileSync(outsideFile, 'utf8').trim();
  unlinkSync(outsideHardlink);
  assert.equal(outsideContentAfterHardlink, 'unchanged');
  passed.push('a pre-existing workspace hardlink is refused before ACL grant');

  const sandboxCreatedHardlink = path.join(
    workspace,
    'sandbox-created-link.txt',
  );
  result = await run({
    command: `mklink /H "${sandboxCreatedHardlink}" "${outsideFile}" && echo sandbox-hardlink-escape > "${sandboxCreatedHardlink}"`,
  });
  const outsideContentAfterSandboxHardlink = readFileSync(
    outsideFile,
    'utf8',
  ).trim();
  if (existsSync(sandboxCreatedHardlink)) {
    await assert.rejects(
      run({
        command: `echo sandbox-hardlink-escape > "${sandboxCreatedHardlink}"`,
      }),
      (error) => error.code === 'workspace_hardlink_refused',
    );
    unlinkSync(sandboxCreatedHardlink);
  }
  assert.equal(outsideContentAfterSandboxHardlink, outsideContentAfterHardlink);
  passed.push('a sandbox-created hardlink cannot write to its outside target');

  const outsideHardlinkFromWorkspace = path.join(
    outside,
    'workspace-hardlink.txt',
  );
  result = await run({
    command: `mklink /H "${outsideHardlinkFromWorkspace}" "${workspaceFile}"`,
  });
  if (
    result.output.match(/退出码：(\d+)/u)?.[1] === '0' ||
    existsSync(outsideHardlinkFromWorkspace)
  ) {
    failed.push('the sandbox created a hardlink outside the workspace');
  } else {
    passed.push('the sandbox cannot create a hardlink outside the workspace');
  }

  await assert.rejects(
    run({
      command: 'echo should-not-launch',
      additionalAccess: [
        {
          path: '\\\\localhost\\C$',
          access: 'read',
          reason: 'sandbox integration check',
        },
      ],
    }),
    /额外路径授权参数无效/u,
  );
  passed.push('UNC paths are rejected before sandbox launch');

  if (alternateDrive) {
    try {
      alternateRoot = mkdtempSync(
        path.join(alternateDrive, 'noema-sandbox-e2e-'),
      );
      const alternateWorkspace = path.join(alternateRoot, 'workspace');
      mkdirSync(alternateWorkspace);
      result = await run({
        workspacePath: alternateWorkspace,
        command: 'echo alternate-workspace-ok > alternate-workspace.txt',
      });
      assertExitCode(result, 0, 'alternate-drive workspace write');
      assert.equal(
        readFileSync(
          path.join(alternateWorkspace, 'alternate-workspace.txt'),
          'utf8',
        ).trim(),
        'alternate-workspace-ok',
      );
      passed.push('a workspace on another drive remains writable');

      const alternateFile = path.join(alternateRoot, 'sentinel.txt');
      writeFileSync(alternateFile, 'cross-drive-unchanged');
      result = await run({
        command: `echo unauthorized > "${alternateFile}"`,
      });
      const crossDriveContentAfterDefault = readFileSync(alternateFile, 'utf8');
      if (
        result.output.match(/退出码：(\d+)/u)?.[1] === '0' ||
        crossDriveContentAfterDefault !== 'cross-drive-unchanged'
      ) {
        failed.push(
          'unapproved cross-drive write escaped the workspace boundary and changed its sentinel',
        );
      } else {
        passed.push('unapproved cross-drive write is denied');
      }
      result = await run({
        command: `type "${alternateFile}"`,
        additionalAccess: [
          {
            path: alternateRoot,
            access: 'read',
            reason: 'sandbox integration check',
          },
        ],
        authorizeAdditionalAccess: async () => true,
      });
      assertExitCode(result, 0, 'approved cross-drive read');
      assert.ok(
        result.output.includes(crossDriveContentAfterDefault.trim()),
        'approved cross-drive read must return the observed sentinel contents',
      );
      passed.push('approved cross-drive read works');

      const approvedAlternateFile = path.join(alternateRoot, 'approved.txt');
      result = await run({
        command: `echo cross-drive-approved > "${approvedAlternateFile}"`,
        additionalAccess: [
          {
            path: alternateRoot,
            access: 'write',
            reason: 'sandbox integration check',
          },
        ],
        authorizeAdditionalAccess: async () => true,
      });
      assertExitCode(result, 0, 'approved cross-drive write');
      assert.equal(
        readFileSync(approvedAlternateFile, 'utf8').trim(),
        'cross-drive-approved',
      );
      passed.push('approved cross-drive write works');
    } catch (error) {
      failed.push(`cross-drive boundary: ${error.message}`);
    }
  }

  const approvals = [];
  result = await run({
    command: `type "${outsideFile}"`,
    additionalAccess: [
      { path: outside, access: 'read', reason: 'sandbox integration check' },
    ],
    authorizeAdditionalAccess: async (request) => {
      approvals.push(request);
      return true;
    },
  });
  assertExitCode(result, 0, 'approved outside read');
  assert.ok(
    result.output.includes(outsideContentAfterHardlink),
    'approved read must return the actual outside sentinel contents',
  );
  assert.equal(approvals.length, 1);
  passed.push('approved outside read is scoped and works');

  const approvedFile = path.join(outside, 'approved.txt');
  result = await run({
    command: `echo approved > "${approvedFile}"`,
    additionalAccess: [
      { path: outside, access: 'write', reason: 'sandbox integration check' },
    ],
    authorizeAdditionalAccess: async () => true,
  });
  assertExitCode(result, 0, 'approved outside write');
  assert.equal(readFileSync(approvedFile, 'utf8').trim(), 'approved');
  passed.push('approved outside write is scoped and works');

  const approvedNetworkRequests = [];
  result = await run({
    command: `node --use-env-proxy -e "fetch('https://example.com/').then(async response => { const body = await response.text(); console.log('HTTP', response.status, body.includes('Example Domain')); process.exit(response.ok && body.includes('Example Domain') ? 0 : 1); }).catch(error => { console.error(error); process.exit(2); })"`,
    timeoutMs: 15_000,
    authorizeNetwork: async (request) => {
      approvedNetworkRequests.push(request);
      return true;
    },
  });
  assertExitCode(result, 0, 'approved network host');
  assert.match(result.output, /HTTP 200 true/u);
  assert.ok(
    approvedNetworkRequests.some(
      ({ host, port }) => host === 'example.com' && port === 443,
    ),
    `Expected approval for example.com:443; got ${JSON.stringify(approvedNetworkRequests)}`,
  );

  const networkRequests = [];
  result = await run({
    command: `node --use-env-proxy -e "fetch('https://example.com/').then(async response => { await response.arrayBuffer(); console.log('UNEXPECTED_HTTP', response.status); process.exit(1); }).catch(error => { console.error('EXPECTED_BLOCK', error.cause?.message || error.message); process.exit(2); })"`,
    timeoutMs: 8_000,
    authorizeNetwork: async (request) => {
      networkRequests.push(request);
      return false;
    },
  });
  assert.notEqual(result.output.match(/退出码：(\d+)/u)?.[1], '0');
  assert.match(result.output, /EXPECTED_BLOCK/u);
  assert.ok(
    networkRequests.some(
      ({ host, port }) => host === 'example.com' && port === 443,
    ),
    `Expected the actual sandbox proxy to request approval for example.com:443; got ${JSON.stringify(networkRequests)}`,
  );
  passed.push(
    'an approved network host works for one command and is not reused by the next',
  );
  passed.push('unapproved network host is blocked before proxy forwarding');

  const bypassApprovals = [];
  result = await run({
    command: `node --no-use-env-proxy -e "fetch('https://example.com/').then(response => { console.log('DIRECT_HTTP', response.status); process.exit(1); }).catch(error => { console.error('DIRECT_BLOCK', error.cause?.code || error.message); process.exit(2); })"`,
    timeoutMs: 8_000,
    authorizeNetwork: async (request) => {
      bypassApprovals.push(request);
      return true;
    },
  });
  assert.notEqual(result.output.match(/退出码：(\d+)/u)?.[1], '0');
  assert.match(result.output, /DIRECT_BLOCK EACCES/u);
  assert.equal(
    bypassApprovals.length,
    0,
    'A direct socket request must not be converted into a proxy approval.',
  );
  passed.push('direct HTTPS that bypasses the proxy is denied by the OS fence');

  const delayedFile = path.join(workspace, 'after-timeout.txt');
  const powershellCommand = `Start-Sleep -Seconds 4; Set-Content -LiteralPath '${delayedFile}' -Value late`;
  result = await run({
    command: `powershell.exe -NoProfile -NonInteractive -Command "${powershellCommand}"`,
    timeoutMs: 700,
  });
  assert.equal(result.timedOut, true, `Expected timeout:\n${result.output}`);
  await delay(4_500);
  assert.equal(existsSync(delayedFile), false);
  passed.push('timeout kills child work before it can write later');

  result = await run({ command: 'echo followup-ok' });
  assertExitCode(result, 0, 'command after timeout');
  assert.match(result.output, /followup-ok/u);
  passed.push('a later command runs after timeout cleanup');

  const status = spawnSync(helperPath, ['user', 'status'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const sandboxStatus = JSON.parse(status.stdout);
  assert.equal(
    sandboxStatus.persistent_grants?.state,
    'none',
    `Persistent grants remain: ${JSON.stringify(sandboxStatus.persistent_grants)}`,
  );
  passed.push('no persistent filesystem grants remain');

  console.log(`Passed ${passed.length} Windows sandbox integration checks:`);
  for (const check of passed) console.log(`- ${check}`);
  if (failed.length > 0) {
    console.error(
      `Failed ${failed.length} Windows sandbox integration checks:`,
    );
    for (const check of failed) console.error(`- ${check}`);
    process.exitCode = 1;
  }
} finally {
  if (alternateRoot) rmSync(alternateRoot, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}
