import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AGENT_RUNTIME_CORE_VERSION,
  createAgentRuntimeCore,
  createAgentRuntimePair,
} from '../../../src/main/agents/agent-runtime-core.mjs';

function fakeRuntime() {
  return {
    kind: 'fake',
    async *streamChat() {
      yield 'ok';
    },
  };
}

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'noema-agent-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('creates an immutable core and keeps Noema and executor isolated', async (t) => {
  const root = await temporaryRoot(t);
  const pair = await createAgentRuntimePair({
    userDataPath: root,
    noemaRuntime: fakeRuntime(),
    executorRuntime: fakeRuntime(),
  });

  assert.equal(AGENT_RUNTIME_CORE_VERSION, 1);
  assert.equal(pair.noema.core.version, 1);
  assert.equal(pair.noema.core.agentId, 'noema');
  assert.equal(pair.noema.core.role, 'personal');
  assert.equal(pair.noema.core.workspacePath, null);
  assert.equal(pair.executor.core.agentId, 'noema-executor');
  assert.equal(pair.executor.core.role, 'executor');
  assert.notEqual(pair.noema.core.homePath, pair.executor.core.homePath);
  assert.notEqual(
    pair.noema.core.memoryNamespace,
    pair.executor.core.memoryNamespace,
  );
  assert.ok(pair.executor.core.workspacePath.endsWith('workspace'));
  assert.ok(Object.isFrozen(pair.noema.core));
  assert.ok(Object.isFrozen(pair.noema.core.grants));
  assert.equal(pair.noema.core.grants.externalFiles, false);
  assert.equal(pair.executor.core.grants.externalFiles, true);

  await pair.noema.appendEvent({
    type: 'turn.started',
    payload: { turnId: 'turn-1' },
  });
  assert.equal((await pair.noema.readEvents()).length, 1);
  assert.deepEqual(await pair.executor.readEvents(), []);
});

test('persists append-only events and resumes sequence after restart', async (t) => {
  const root = await temporaryRoot(t);
  const input = {
    agentId: 'noema',
    role: 'personal',
    name: 'Noema',
    homePath: join(root, 'noema'),
    workspacePath: null,
    runtime: fakeRuntime(),
  };

  const first = await createAgentRuntimeCore(input);
  const one = await first.appendEvent({
    type: 'turn.started',
    payload: { turnId: 'turn-1' },
  });
  const two = await first.appendEvent({
    type: 'tool.called',
    payload: { name: 'read_file' },
  });
  assert.equal(one.seq, 1);
  assert.equal(two.seq, 2);

  const reopened = await createAgentRuntimeCore(input);
  assert.deepEqual(
    (await reopened.readEvents()).map((event) => event.seq),
    [1, 2],
  );
  const three = await reopened.appendEvent({
    type: 'turn.completed',
    payload: { turnId: 'turn-1' },
  });
  assert.equal(three.seq, 3);
  assert.deepEqual(
    (await reopened.readEvents({ after: 1, limit: 1 })).map(
      (event) => event.type,
    ),
    ['tool.called'],
  );
});

test('serializes concurrent appends into a monotonic event log', async (t) => {
  const root = await temporaryRoot(t);
  const core = await createAgentRuntimeCore({
    agentId: 'noema',
    role: 'personal',
    name: 'Noema',
    homePath: join(root, 'noema'),
    runtime: fakeRuntime(),
  });

  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      core.appendEvent({
        type: 'tool.called',
        payload: { index },
      }),
    ),
  );

  const events = await core.readEvents();
  assert.equal(events.length, 12);
  assert.deepEqual(
    events.map((event) => event.seq),
    Array.from({ length: 12 }, (_, index) => index + 1),
  );
});

test('delegates to the backend with the immutable agent environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'noema-agent-core-'));
  try {
    let received = null;
    const effectiveRuntime = {
      kind: 'fake',
      async *streamChat(options) {
        received = options;
        yield 'ok';
      },
    };
    const core = await createAgentRuntimeCore({
      agentId: 'noema-executor',
      role: 'executor',
      name: '执行者',
      homePath: join(root, 'executor'),
      workspacePath: join(root, 'executor', 'workspace'),
      grants: { projectWork: true },
      runtime: effectiveRuntime,
    });

    const chunks = [];
    for await (const chunk of core.streamChat({
      agentId: 'spoofed',
      memoryNamespace: 'spoofed',
      temperature: 0.2,
    })) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, ['ok']);
    assert.deepEqual(received, {
      agentId: 'noema-executor',
      memoryNamespace: 'agent:noema-executor',
      workspacePath: join(root, 'executor', 'workspace'),
      temperature: 0.2,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects invalid descriptors and event input', async (t) => {
  const root = await temporaryRoot(t);
  await assert.rejects(
    createAgentRuntimeCore({
      agentId: 'Bad ID',
      role: 'personal',
      name: 'Noema',
      homePath: join(root, 'bad'),
      runtime: fakeRuntime(),
    }),
    /invalid agentId/,
  );
  await assert.rejects(
    createAgentRuntimeCore({
      agentId: 'noema',
      role: 'personal',
      name: 'Noema',
      homePath: 'relative',
      runtime: fakeRuntime(),
    }),
    /homePath must be absolute/,
  );
  await assert.rejects(
    createAgentRuntimeCore({
      agentId: 'noema',
      role: 'personal',
      name: 'Noema',
      homePath: join(root, 'noema'),
      runtime: { kind: 'fake' },
    }),
    /streamChat/,
  );

  const core = await createAgentRuntimeCore({
    agentId: 'noema',
    role: 'personal',
    name: 'Noema',
    homePath: join(root, 'noema'),
    runtime: fakeRuntime(),
  });
  await assert.rejects(
    core.appendEvent({ type: 'TurnStarted' }),
    /invalid event type/,
  );
  await assert.rejects(core.readEvents({ after: -1 }), /after/);
  assert.deepEqual(await core.readEvents(), []);
});
