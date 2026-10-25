import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

const helperPath = resolveNoemaSrtWinExecutable();
if (!existsSync(helperPath)) {
  throw new Error(`The packaged Windows SRT helper is missing: ${helperPath}`);
}

const root = mkdtempSync(path.join(tmpdir(), 'noema-sandbox-e2e-'));
const workspace = path.join(root, 'workspace');
const outside = path.join(root, 'outside');
mkdirSync(workspace);
mkdirSync(outside);

const run = (options) =>
  runProjectCommandInSandbox({
    command: options.command,
    workspacePath: workspace,
    signal: new AbortController().signal,
    timeoutMs: options.timeoutMs ?? 12_000,
    additionalAccess: options.additionalAccess,
    authorizeAdditionalAccess: options.authorizeAdditionalAccess,
    authorizeNetwork: options.authorizeNetwork,
  });

const assertExitCode = (result, expected, label) => {
  const passed = result.output.startsWith(`退出码：${expected}`);
  assert.ok(passed, `${label} failed:\n${result.output}`);
};

const passed = [];

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

  const junction = path.join(workspace, 'outside-link');
  symlinkSync(outside, junction, 'junction');
  result = await run({
    command: `echo junction-escape > "${path.join(junction, 'sentinel.txt')}"`,
  });
  assert.notEqual(result.output.match(/退出码：(\d+)/u)?.[1], '0');
  assert.equal(readFileSync(outsideFile, 'utf8'), 'unchanged');
  passed.push('junction cannot escape the workspace write boundary');

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
  assert.match(result.output, /unchanged/u);
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

  const networkRequests = [];
  result = await run({
    command: 'curl.exe --connect-timeout 2 --max-time 5 https://example.com/',
    timeoutMs: 8_000,
    authorizeNetwork: async (request) => {
      networkRequests.push(request);
      return false;
    },
  });
  assert.notEqual(result.output.match(/退出码：(\d+)/u)?.[1], '0');
  assert.ok(
    networkRequests.some(
      ({ host, port }) => host === 'example.com' && port === 443,
    ),
    `Expected the actual sandbox proxy to request approval for example.com:443; got ${JSON.stringify(networkRequests)}`,
  );
  passed.push('unapproved network host is blocked before proxy forwarding');

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
} finally {
  rmSync(root, { recursive: true, force: true });
}
