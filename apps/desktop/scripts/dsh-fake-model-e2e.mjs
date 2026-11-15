/**
 * Real-machine check of the DSH execution path without a model key.
 *
 * Runs Noema's DSH adapter against a real DSH install, with a local fake
 * OpenAI-compatible model that asks DSH's shell tool to run one command, and
 * asserts what the sandbox let through:
 *   1. workspace-write: `ls` returns the workspace listing;
 *   2. workspace-write: `touch a.txt` creates a file in the workspace;
 *   3. read-only: `touch a.txt` is denied and the workspace is unchanged;
 *   4. workspace-write: writing into the user's home (outside the workspace and
 *      the temp directory) is denied.
 *
 * Needs DSH on PATH (`npm i -g @deepseek-ai/dsh`) and Node 24.21+. Usage:
 *   node scripts/dsh-fake-model-e2e.mjs
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import http from 'node:http';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import {
  DshHeadlessAdapter,
  resolveDshHeadlessRuntime,
} from '../src/main/integrations/dsh-headless-adapter.mjs';
import { hostPlatform } from '../src/main/platform/host-platform.ts';

const shellTool = hostPlatform().dshShellTool === 'tool-bash' ? 'bash' : 'pwsh';

/** One chat-completions turn: ask for the shell command, then echo its output. */
function fakeModel(command) {
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const json = body ? JSON.parse(body) : {};
      if (!request.url?.endsWith('/chat/completions')) {
        response.writeHead(404).end();
        return;
      }
      const tool = (json.tools ?? []).find(
        (candidate) => candidate.function?.name === shellTool,
      );
      const toolResult = (json.messages ?? [])
        .filter((message) => message.role === 'tool')
        .at(-1);
      let delta;
      let finishReason;
      if (!toolResult) {
        const schema = tool?.function?.parameters ?? {};
        const args = { command };
        for (const name of schema.required ?? []) {
          if (!(name in args)) args[name] = 'Noema DSH end-to-end check';
        }
        delta = {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: shellTool, arguments: JSON.stringify(args) },
            },
          ],
        };
        finishReason = 'tool_calls';
      } else {
        const content =
          typeof toolResult.content === 'string'
            ? toolResult.content
            : JSON.stringify(toolResult.content);
        delta = { role: 'assistant', content: `TOOL OUTPUT >>> ${content}` };
        finishReason = 'stop';
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const choice of [
        { index: 0, delta, finish_reason: null },
        { index: 0, delta: {}, finish_reason: finishReason },
      ]) {
        response.write(
          `data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [choice], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
        );
      }
      response.end('data: [DONE]\n\n');
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server)),
  );
}

async function run({ runtime, mode, command }) {
  const server = await fakeModel(command);
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-dsh-e2e-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  mkdirSync(path.join(workspace, 'seed-dir'));
  try {
    const adapter = new DshHeadlessAdapter({
      runtime,
      userDataPath: path.join(directory, 'user-data'),
      providerBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      getApiKey: () => 'fake-key',
      getPermissionMode: () => mode,
    });
    const events = [];
    const handle = await adapter.startTask({
      workspacePath: workspace,
      task: `Run ${command} in the workspace.`,
      model: 'fake-model',
      timeoutMs: 120_000,
      onEvent: (event) => events.push(event),
    });
    const outcome = await handle.done;
    return {
      outcome,
      shellCalls: events.filter(
        (event) => event.type === 'tool-call' && event.tool === shellTool,
      ).length,
      workspace: readdirSync(workspace).sort(),
    };
  } finally {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

const runtime = await resolveDshHeadlessRuntime({ resourcesPath: undefined });
console.log(
  `DSH ${runtime.version} (${runtime.source}) with ${runtime.nodeExecutable}`,
);

const listed = await run({ runtime, mode: 'workspace-write', command: 'ls' });
assert.equal(listed.outcome.status, 'completed');
assert.equal(listed.shellCalls, 1);
assert.match(listed.outcome.result, /seed-dir/);
console.log('ok 1 workspace-write runs ls and returns the workspace listing');

const written = await run({
  runtime,
  mode: 'workspace-write',
  command: 'touch a.txt',
});
assert.deepEqual(written.workspace, ['a.txt', 'seed-dir']);
console.log('ok 2 workspace-write creates a file inside the workspace');

const readOnly = await run({
  runtime,
  mode: 'read-only',
  command: 'touch a.txt',
});
assert.deepEqual(readOnly.workspace, ['seed-dir']);
assert.match(readOnly.outcome.result, /denied|not permitted/i);
console.log('ok 3 read-only denies a workspace write');

const outside = path.join(homedir(), `.noema-dsh-e2e-${process.pid}.txt`);
try {
  const escaped = await run({
    runtime,
    mode: 'workspace-write',
    command: `touch ${outside}`,
  });
  assert.equal(
    existsSync(outside),
    false,
    'sandbox let a write reach the home directory',
  );
  assert.match(escaped.outcome.result, /denied|not permitted/i);
  console.log('ok 4 workspace-write denies a write outside the workspace');
} finally {
  rmSync(outside, { force: true });
}
