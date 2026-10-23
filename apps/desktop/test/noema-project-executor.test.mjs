import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NoemaProjectExecutor } from '../src/noema-project-executor.mjs';

function toolCall(id, name, args) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

function makeProvider(responses) {
  let index = 0;
  return {
    async *streamChat({ onToolCalls }) {
      const response = responses[index++];
      if (!response) throw new Error('Unexpected provider call');
      if (response.calls) onToolCalls(response.calls);
      if (response.text) yield response.text;
    },
    get callCount() {
      return index;
    },
  };
}

test('Noema executor performs a bounded multi-step tool loop in the selected workspace', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-project-executor-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const provider = makeProvider([
    { calls: [toolCall('call-1', 'list_files', { path: '' })] },
    {
      calls: [
        toolCall('call-2', 'write_file', {
          path: 'notes/result.txt',
          content: 'created by Noema',
        }),
      ],
    },
    { text: '已创建 notes/result.txt。' },
  ]);
  const events = [];
  try {
    const executor = new NoemaProjectExecutor({ provider });
    const handle = await executor.startTask({
      workspacePath: workspace,
      task: '创建结果文件',
      model: 'auto:noema-free',
      taskId: 'task-test',
      onEvent: (event) => events.push(event),
    });
    const outcome = await handle.done;
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.toolCallCount, 2);
    assert.equal(provider.callCount, 3);
    assert.equal(
      readFileSync(path.join(workspace, 'notes', 'result.txt'), 'utf8'),
      'created by Noema',
    );
    assert.deepEqual(
      events
        .filter((event) => event.type === 'tool-call')
        .map((event) => event.category),
      ['read', 'write'],
    );
    assert.deepEqual(
      events
        .filter((event) => event.type === 'tool-result')
        .map((event) => event.effectStatus),
      ['none', 'applied'],
    );
    const finalCheckpoint = events
      .filter((event) => event.type === 'runtime-checkpoint')
      .at(-1);
    assert.equal(finalCheckpoint.phase, 'completed');
    assert.equal(finalCheckpoint.toolCallCount, 2);
    assert.deepEqual(finalCheckpoint.messages.at(-1), {
      role: 'assistant',
      content: '已创建 notes/result.txt。',
    });
    assert.equal(
      finalCheckpoint.messages.filter((message) => message.role === 'tool')
        .length,
      2,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Noema executor rejects workspace traversal and does not repeat side effects after a tool error', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-project-executor-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const provider = makeProvider([
    {
      calls: [
        toolCall('call-escape', 'write_file', {
          path: '..\\outside.txt',
          content: 'must not write',
        }),
      ],
    },
    { text: '路径越界已拒绝，没有写入。' },
  ]);
  const events = [];
  try {
    const executor = new NoemaProjectExecutor({ provider });
    const handle = await executor.startTask({
      workspacePath: workspace,
      task: '不要越出工作区',
      model: 'auto:noema-free',
      onEvent: (event) => events.push(event),
    });
    const outcome = await handle.done;
    assert.equal(outcome.status, 'completed');
    assert.equal(provider.callCount, 2);
    assert.equal(
      events.filter((event) => event.type === 'tool-call').length,
      1,
    );
    assert.deepEqual(
      events
        .filter((event) => event.type === 'tool-result')
        .map((event) => event.effectStatus),
      ['not_applied'],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Noema executor stops without starting another model request', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-project-executor-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  let release;
  const provider = {
    async *streamChat() {
      await new Promise((resolve) => {
        release = resolve;
      });
      yield 'late response';
    },
  };
  try {
    const executor = new NoemaProjectExecutor({ provider });
    const handle = await executor.startTask({
      workspacePath: workspace,
      task: 'stop me',
      model: 'auto:noema-free',
    });
    handle.stop();
    release?.();
    const outcome = await handle.done;
    assert.equal(outcome.status, 'interrupted');
    assert.equal(outcome.toolCallCount, 0);
  } finally {
    release?.();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Noema executor does not repeat a side-effecting command with a new call ID', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noema-project-executor-'));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const command = 'echo x>>count.txt';
  const provider = makeProvider([
    { calls: [toolCall('command-1', 'run_command', { command })] },
    { calls: [toolCall('command-2', 'run_command', { command })] },
    { text: '已执行一次；重复命令被拒绝。' },
  ]);
  const events = [];
  try {
    const executor = new NoemaProjectExecutor({ provider });
    const handle = await executor.startTask({
      workspacePath: workspace,
      task: '执行一次计数命令',
      model: 'auto:noema-free',
      onEvent: (event) => events.push(event),
    });
    const outcome = await handle.done;
    assert.equal(outcome.status, 'completed');
    assert.equal(
      readFileSync(path.join(workspace, 'count.txt'), 'utf8').trim(),
      'x',
    );
    assert.equal(
      events.filter((event) => event.type === 'tool-call').length,
      1,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
