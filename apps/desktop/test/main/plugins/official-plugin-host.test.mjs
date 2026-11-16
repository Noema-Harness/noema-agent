import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RootStore } from '../../../src/main/storage/root-store.mjs';
import { OfficialPluginHost } from '../../../src/main/plugins/official-plugin-host.mjs';
import { OfficialPluginStateStore } from '../../../src/main/plugins/official-plugin-state-store.ts';
import { officialContractSample } from '../../../src/main/plugins/official-contract-sample.ts';

function fixture(definitions = []) {
  const rootStore = new RootStore(':memory:');
  const stateStore = new OfficialPluginStateStore(rootStore.db);
  const events = [];
  const host = new OfficialPluginHost({
    definitions,
    stateStore,
    recordDiagnostic: (event) => events.push(event),
  });
  return {
    rootStore,
    stateStore,
    events,
    host,
    close: () => rootStore.db.close(),
  };
}

test('official sample migrates its namespace, starts, disables, and re-enables', async () => {
  const subject = fixture([officialContractSample]);
  let starts = 0;
  let stops = 0;
  const definition = {
    ...officialContractSample,
    start(context) {
      starts += 1;
      assert.equal(context.pluginId, 'noema.sample.contract');
      assert.equal(context.state.get('sampleReady'), true);
      assert.equal(context.db, undefined);
      return { stop: () => (stops += 1) };
    },
  };
  subject.host = new OfficialPluginHost({
    definitions: [definition],
    stateStore: subject.stateStore,
    recordDiagnostic: (event) => subject.events.push(event),
  });

  try {
    await subject.host.startAll();
    assert.equal(subject.host.getStatuses()[0].status, 'active');
    assert.equal(subject.stateStore.schemaVersion('noema.sample.contract'), 1);
    await subject.host.setEnabled('noema.sample.contract', false);
    assert.equal(subject.host.getStatuses()[0].status, 'disabled');
    assert.equal(
      subject.stateStore.scope('noema.sample.contract').get('sampleReady'),
      true,
    );
    await subject.host.setEnabled('noema.sample.contract', true);
    assert.equal(subject.host.getStatuses()[0].status, 'active');
    assert.equal(starts, 2);
    assert.equal(stops, 1);
    assert.ok(subject.events.every((event) => event.executionId));
  } finally {
    await subject.host.stopAll();
    subject.close();
  }
});

test('failed official plugin migration rolls back only its namespace and core remains available', async () => {
  const broken = {
    manifest: {
      id: 'noema.sample.broken',
      version: '1.0.0',
      hostApiVersion: 1,
      stateVersion: 1,
      capabilities: ['state'],
    },
    migrations: [
      {
        fromVersion: 0,
        toVersion: 1,
        up(state) {
          state.set('partial', true);
          throw new Error('migration failure');
        },
      },
    ],
    start() {
      throw new Error('must not start after migration failure');
    },
  };
  const healthy = {
    manifest: {
      id: 'noema.sample.healthy',
      version: '1.0.0',
      hostApiVersion: 1,
      stateVersion: 0,
      capabilities: [],
    },
    start() {},
  };
  const subject = fixture([broken, healthy]);
  try {
    await subject.host.startAll();
    const statuses = Object.fromEntries(
      subject.host.getStatuses().map((item) => [item.id, item]),
    );
    assert.equal(
      statuses['noema.sample.broken'].reasonCode,
      'migration_failed',
    );
    assert.equal(statuses['noema.sample.healthy'].status, 'active');
    assert.equal(
      subject.stateStore.scope('noema.sample.broken').get('partial'),
      undefined,
    );
    assert.equal(subject.stateStore.schemaVersion('noema.sample.broken'), 0);
  } finally {
    await subject.host.stopAll();
    subject.close();
  }
});

test('official plugin start failure is contained while unrelated plugins start', async () => {
  const broken = {
    manifest: {
      id: 'noema.sample.start-failure',
      version: '1.0.0',
      hostApiVersion: 1,
      stateVersion: 0,
      capabilities: [],
    },
    start() {
      throw new Error('private plugin error text');
    },
  };
  const healthy = {
    manifest: {
      id: 'noema.sample.start-healthy',
      version: '1.0.0',
      hostApiVersion: 1,
      stateVersion: 0,
      capabilities: [],
    },
    start() {},
  };
  const subject = fixture([broken, healthy]);
  try {
    await subject.host.startAll();
    const statuses = Object.fromEntries(
      subject.host.getStatuses().map((item) => [item.id, item]),
    );
    assert.equal(
      statuses['noema.sample.start-failure'].reasonCode,
      'start_failed',
    );
    assert.equal(statuses['noema.sample.start-healthy'].status, 'active');
    assert.equal(
      JSON.stringify(subject.events).includes('private plugin error text'),
      false,
    );
  } finally {
    await subject.host.stopAll();
    subject.close();
  }
});

test('plugins receive isolated namespaces and malformed or oversized state is rejected', () => {
  const subject = fixture();
  try {
    const first = subject.stateStore.scope('noema.sample.first');
    const second = subject.stateStore.scope('noema.sample.second');
    first.set('value', { ownedBy: 'first' });
    assert.equal(second.get('value'), undefined);
    assert.throws(() => first.set('large', 'x'.repeat(65_537)), /大小限制/u);
    assert.throws(() => first.set('', 'invalid'), /键无效/u);
  } finally {
    subject.close();
  }
});

test('unknown capabilities and dependency cycles are unavailable without throwing from host creation', async () => {
  const unknown = {
    manifest: {
      id: 'noema.sample.unknown',
      version: '1.0.0',
      hostApiVersion: 1,
      stateVersion: 0,
      capabilities: ['shell'],
    },
    start() {},
  };
  const a = {
    manifest: {
      id: 'noema.sample.a',
      version: '1.0.0',
      hostApiVersion: 1,
      stateVersion: 0,
      capabilities: [],
      dependencies: [{ id: 'noema.sample.b' }],
    },
    start() {},
  };
  const b = {
    manifest: {
      id: 'noema.sample.b',
      version: '1.0.0',
      hostApiVersion: 1,
      stateVersion: 0,
      capabilities: [],
      dependencies: [{ id: 'noema.sample.a' }],
    },
    start() {},
  };
  const subject = fixture([unknown, a, b]);
  try {
    await subject.host.startAll();
    const statuses = Object.fromEntries(
      subject.host.getStatuses().map((item) => [item.id, item]),
    );
    assert.equal(
      statuses['noema.sample.unknown'].reasonCode,
      'unknown_capability',
    );
    assert.equal(statuses['noema.sample.a'].reasonCode, 'dependency_cycle');
    assert.equal(statuses['noema.sample.b'].reasonCode, 'dependency_cycle');
  } finally {
    subject.close();
  }
});

test('bundled sample migration and state survive a host restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'noema-plugin-host-'));
  const databasePath = join(directory, 'state.db');
  const open = () => {
    const rootStore = new RootStore(databasePath);
    const stateStore = new OfficialPluginStateStore(rootStore.db);
    const host = new OfficialPluginHost({
      definitions: [officialContractSample],
      stateStore,
    });
    return { rootStore, stateStore, host };
  };
  let current = open();
  try {
    await current.host.startAll();
    assert.equal(current.stateStore.schemaVersion('noema.sample.contract'), 1);
    assert.equal(
      current.stateStore.scope('noema.sample.contract').get('sampleReady'),
      true,
    );
    await current.host.stopAll();
    current.rootStore.db.close();

    current = open();
    await current.host.startAll();
    assert.equal(current.stateStore.schemaVersion('noema.sample.contract'), 1);
    assert.equal(
      current.stateStore.scope('noema.sample.contract').get('sampleReady'),
      true,
    );
  } finally {
    await current.host.stopAll();
    current.rootStore.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('official plugin host rejects incompatible API and dependency versions before start', async () => {
  const incompatible = {
    ...officialContractSample,
    manifest: {
      ...officialContractSample.manifest,
      id: 'noema.sample.incompatible',
      hostApiVersion: 2,
    },
  };
  const dependent = {
    manifest: {
      id: 'noema.sample.dependent',
      version: '1.0.0',
      hostApiVersion: 1,
      stateVersion: 0,
      capabilities: [],
      dependencies: [{ id: 'noema.sample.contract', minVersion: '2.0.0' }],
    },
    start() {
      throw new Error('must not start with an incompatible dependency');
    },
  };
  const subject = fixture([incompatible, dependent, officialContractSample]);
  try {
    await subject.host.startAll();
    const statuses = Object.fromEntries(
      subject.host.getStatuses().map((item) => [item.id, item]),
    );
    assert.equal(
      statuses['noema.sample.incompatible'].reasonCode,
      'unsupported_host_api',
    );
    assert.equal(
      statuses['noema.sample.dependent'].reasonCode,
      'dependency_version_mismatch',
    );
    assert.equal(statuses['noema.sample.contract'].status, 'active');
  } finally {
    await subject.host.stopAll();
    subject.close();
  }
});

test('diagnostic failures cannot reject plugin startup', async () => {
  const subject = fixture([officialContractSample]);
  subject.host = new OfficialPluginHost({
    definitions: [officialContractSample],
    stateStore: subject.stateStore,
    recordDiagnostic: () => {
      throw new Error('diagnostic unavailable');
    },
  });
  try {
    await subject.host.startAll();
    assert.equal(subject.host.getStatuses()[0].status, 'active');
  } finally {
    await subject.host.stopAll();
    subject.close();
  }
});
