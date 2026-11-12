import { randomUUID } from 'node:crypto';

const DEFAULT_HOST_API_VERSION = 1;
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9.-]{0,62}[a-z0-9]$/u;
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const ALLOWED_CAPABILITIES = new Set(['state', 'diagnostics']);
const LIFECYCLE_TIMEOUT_MS = 10_000;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,79}$/u;

function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = VERSION_PATTERN.exec(value);
  return match ? match.slice(1, 4).map(Number) : null;
}

function versionAtLeast(actual, minimum) {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

function withTimeout(value, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(value),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('official_plugin_timeout')),
        timeoutMs,
      );
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function isPlainRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateDefinition(definition, hostApiVersion) {
  const manifest = definition?.manifest;
  if (!isPlainRecord(manifest)) return 'invalid_manifest';
  if (
    typeof manifest.id !== 'string' ||
    !PLUGIN_ID_PATTERN.test(manifest.id) ||
    !parseVersion(manifest.version) ||
    !Number.isSafeInteger(manifest.hostApiVersion) ||
    !Number.isSafeInteger(manifest.stateVersion) ||
    manifest.stateVersion < 0 ||
    !Array.isArray(manifest.capabilities) ||
    typeof definition.start !== 'function'
  ) {
    return 'invalid_manifest';
  }
  if (manifest.hostApiVersion !== hostApiVersion) return 'unsupported_host_api';
  if (
    manifest.capabilities.some(
      (capability) => !ALLOWED_CAPABILITIES.has(capability),
    )
  ) {
    return 'unknown_capability';
  }
  if (
    !Array.isArray(manifest.dependencies ?? []) ||
    (manifest.dependencies ?? []).some(
      (dependency) =>
        !isPlainRecord(dependency) ||
        typeof dependency.id !== 'string' ||
        !PLUGIN_ID_PATTERN.test(dependency.id) ||
        (dependency.minVersion !== undefined &&
          !parseVersion(dependency.minVersion)),
    )
  ) {
    return 'invalid_manifest';
  }
  if (manifest.stateVersion > 0 && !manifest.capabilities.includes('state')) {
    return 'invalid_manifest';
  }
  if (
    manifest.enabledByDefault !== undefined &&
    typeof manifest.enabledByDefault !== 'boolean'
  ) {
    return 'invalid_manifest';
  }
  return null;
}

/**
 * Runs trusted, application-registered business plugins. A declared capability
 * narrows the host context; it is not an OS security boundary for in-process code.
 */
export class OfficialPluginHost {
  /**
   * @param {{
   *   definitions?: object[],
   *   stateStore: import('./official-plugin-state-store.mjs').OfficialPluginStateStore,
   *   recordDiagnostic?: (event: Record<string, unknown>) => void,
   *   hostApiVersion?: number
   * }} options
   */
  constructor({
    definitions = [],
    stateStore,
    recordDiagnostic,
    hostApiVersion = DEFAULT_HOST_API_VERSION,
  }) {
    if (!Array.isArray(definitions)) throw new TypeError('官方插件列表无效。');
    if (!stateStore) throw new TypeError('官方插件状态存储不可用。');
    this.stateStore = stateStore;
    this.recordDiagnostic =
      typeof recordDiagnostic === 'function' ? recordDiagnostic : () => {};
    this.hostApiVersion = hostApiVersion;
    this.definitions = new Map();
    this.statuses = new Map();
    this.stopHandlers = new Map();
    this.startOrder = [];
    this.locks = new Map();

    for (const [index, definition] of definitions.entries()) {
      const id = definition?.manifest?.id;
      const key =
        typeof id === 'string' && PLUGIN_ID_PATTERN.test(id)
          ? id
          : `invalid-${index}`;
      if (this.definitions.has(key)) {
        this.statuses.set(
          key,
          this.statusRecord(
            key,
            definition,
            'unavailable',
            'duplicate_plugin_id',
          ),
        );
        continue;
      }
      this.definitions.set(key, definition);
      const reasonCode = validateDefinition(definition, hostApiVersion);
      this.statuses.set(
        key,
        this.statusRecord(
          key,
          definition,
          reasonCode ? 'unavailable' : 'registered',
          reasonCode,
        ),
      );
    }

    this.resolveDependencies();
  }

  statusRecord(id, definition, status, reasonCode = null) {
    return {
      id,
      version:
        typeof definition?.manifest?.version === 'string'
          ? definition.manifest.version
          : null,
      status,
      reasonCode,
    };
  }

  resolveDependencies() {
    const visiting = new Set();
    const visited = new Set();
    const order = [];

    const visit = (id) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        this.setStatus(id, 'unavailable', 'dependency_cycle');
        return;
      }
      const definition = this.definitions.get(id);
      const status = this.statuses.get(id);
      if (!definition || status?.status === 'unavailable') return;

      visiting.add(id);
      for (const dependency of definition.manifest.dependencies ?? []) {
        const target = this.definitions.get(dependency.id);
        const targetStatus = this.statuses.get(dependency.id);
        if (!target || !targetStatus || targetStatus.status === 'unavailable') {
          this.setStatus(id, 'unavailable', 'missing_dependency');
          continue;
        }
        if (
          dependency.minVersion &&
          !versionAtLeast(target.manifest.version, dependency.minVersion)
        ) {
          this.setStatus(id, 'unavailable', 'dependency_version_mismatch');
          continue;
        }
        visit(dependency.id);
        if (
          this.statuses.get(dependency.id)?.reasonCode === 'dependency_cycle'
        ) {
          this.setStatus(id, 'unavailable', 'dependency_cycle');
        }
      }
      visiting.delete(id);
      visited.add(id);
      if (this.statuses.get(id)?.status !== 'unavailable') order.push(id);
    };

    for (const id of this.definitions.keys()) visit(id);
    this.resolvedOrder = order;
  }

  getStatuses() {
    return [...this.statuses.values()].map((status) => ({ ...status }));
  }

  setStatus(id, status, reasonCode = null) {
    const current = this.statuses.get(id);
    if (!current) return;
    this.statuses.set(id, { ...current, status, reasonCode });
  }

  emitDiagnostic(id, operation, status, errorCode = undefined) {
    try {
      const safeErrorCode =
        typeof errorCode === 'string' && ERROR_CODE_PATTERN.test(errorCode)
          ? errorCode
          : undefined;
      this.recordDiagnostic({
        executionId: randomUUID(),
        module: 'official_plugin_host',
        operation,
        status,
        ...(safeErrorCode ? { errorCode: safeErrorCode } : {}),
        details: { pluginId: id, phase: operation.replace('plugin.', '') },
      });
    } catch {
      // Diagnostics never changes plugin lifecycle outcomes.
    }
  }

  async applyMigrations(id, definition) {
    const targetVersion = definition.manifest.stateVersion;
    let currentVersion = this.stateStore.schemaVersion(id);
    if (currentVersion > targetVersion)
      throw new Error('official_plugin_schema_newer');
    if (targetVersion === 0) return;
    const migrations = [...(definition.migrations ?? [])].sort(
      (left, right) => left.fromVersion - right.fromVersion,
    );
    while (currentVersion < targetVersion) {
      const migration = migrations.find(
        (candidate) => candidate.fromVersion === currentVersion,
      );
      if (
        !migration ||
        migration.toVersion !== currentVersion + 1 ||
        typeof migration.up !== 'function'
      ) {
        throw new Error('official_plugin_migration_missing');
      }
      this.stateStore.migrate(id, migration.toVersion, ({ state }) => {
        const result = migration.up(state);
        if (result && typeof result.then === 'function') {
          throw new Error('official_plugin_migration_async');
        }
      });
      currentVersion = migration.toVersion;
      this.emitDiagnostic(id, 'plugin.migrate', 'completed');
    }
  }

  contextFor(id, definition) {
    const capabilities = new Set(definition.manifest.capabilities);
    const context = {
      pluginId: id,
      hostApiVersion: this.hostApiVersion,
    };
    if (capabilities.has('state')) context.state = this.stateStore.scope(id);
    if (capabilities.has('diagnostics')) {
      context.diagnostics = Object.freeze({
        record: (event) => {
          if (!isPlainRecord(event)) return;
          const status = ['started', 'completed', 'failed', 'timeout'].includes(
            event.status,
          )
            ? event.status
            : 'failed';
          const errorCode =
            typeof event.errorCode === 'string' ? event.errorCode : undefined;
          this.emitDiagnostic(id, 'plugin.runtime', status, errorCode);
        },
      });
    }
    return Object.freeze(context);
  }

  async startPlugin(id) {
    const definition = this.definitions.get(id);
    const current = this.statuses.get(id);
    if (!definition || !current || current.status === 'unavailable')
      return current;
    if (current.status === 'active') return current;
    let persistedEnabled;
    try {
      persistedEnabled = this.stateStore.enabled(id);
    } catch {
      this.setStatus(id, 'failed', 'plugin_state_unavailable');
      this.emitDiagnostic(
        id,
        'plugin.start',
        'failed',
        'plugin_state_unavailable',
      );
      return this.statuses.get(id);
    }
    if (
      persistedEnabled === false ||
      (persistedEnabled === null &&
        definition.manifest.enabledByDefault === false)
    ) {
      this.setStatus(id, 'disabled', 'disabled');
      return this.statuses.get(id);
    }
    for (const dependency of definition.manifest.dependencies ?? []) {
      const dependencyStatus = this.statuses.get(dependency.id);
      if (!dependencyStatus || dependencyStatus.status !== 'active') {
        this.setStatus(id, 'unavailable', 'dependency_unavailable');
        return this.statuses.get(id);
      }
    }

    this.setStatus(id, 'starting');
    this.emitDiagnostic(id, 'plugin.start', 'started');
    if (definition.manifest.capabilities.includes('state')) {
      try {
        await this.applyMigrations(id, definition);
      } catch {
        this.setStatus(id, 'failed', 'migration_failed');
        this.emitDiagnostic(id, 'plugin.migrate', 'failed', 'migration_failed');
        return this.statuses.get(id);
      }
    }
    try {
      const result = await withTimeout(
        definition.start(this.contextFor(id, definition)),
        LIFECYCLE_TIMEOUT_MS,
      );
      if (
        result &&
        typeof result === 'object' &&
        typeof result.stop === 'function'
      ) {
        this.stopHandlers.set(id, result.stop);
      }
      this.startOrder.push(id);
      this.setStatus(id, 'active');
      this.emitDiagnostic(id, 'plugin.start', 'completed');
    } catch (error) {
      const timeout = error?.message === 'official_plugin_timeout';
      const reasonCode = timeout ? 'start_timeout' : 'start_failed';
      this.setStatus(id, 'failed', reasonCode);
      this.emitDiagnostic(id, 'plugin.start', 'failed', reasonCode);
    }
    return this.statuses.get(id);
  }

  async startAll() {
    for (const id of this.resolvedOrder ?? []) await this.startPlugin(id);
    return this.getStatuses();
  }

  async stopPlugin(id, { persistDisabled = false } = {}) {
    const current = this.statuses.get(id);
    if (!current) return current;
    if (persistDisabled) this.stateStore.setEnabled(id, false);
    if (current.status !== 'active') {
      if (persistDisabled) this.setStatus(id, 'disabled', 'disabled');
      return this.statuses.get(id);
    }
    this.setStatus(id, 'stopping');
    this.emitDiagnostic(id, 'plugin.stop', 'started');
    const stop = this.stopHandlers.get(id);
    try {
      if (stop) await withTimeout(stop(), LIFECYCLE_TIMEOUT_MS);
      this.stopHandlers.delete(id);
      this.startOrder = this.startOrder.filter((startedId) => startedId !== id);
      this.setStatus(
        id,
        persistDisabled ? 'disabled' : 'registered',
        persistDisabled ? 'disabled' : null,
      );
      this.emitDiagnostic(id, 'plugin.stop', 'completed');
    } catch (error) {
      const timeout = error?.message === 'official_plugin_timeout';
      const reasonCode = timeout ? 'stop_timeout' : 'stop_failed';
      this.setStatus(id, 'failed', reasonCode);
      this.emitDiagnostic(
        id,
        'plugin.stop',
        timeout ? 'timeout' : 'failed',
        reasonCode,
      );
    }
    return this.statuses.get(id);
  }

  async setEnabled(id, enabled) {
    const definition = this.definitions.get(id);
    if (!definition || typeof enabled !== 'boolean')
      throw new TypeError('官方插件启用请求无效。');
    const previous = this.locks.get(id) ?? Promise.resolve();
    const operation = previous.then(async () => {
      if (enabled) {
        this.stateStore.setEnabled(id, true);
        for (const [pluginId, status] of this.statuses) {
          if (
            status.reasonCode === 'dependency_unavailable' ||
            status.reasonCode === 'disabled'
          ) {
            this.setStatus(pluginId, 'registered');
          } else if (pluginId === id && status.status === 'failed') {
            this.setStatus(pluginId, 'registered');
          }
        }
        await this.startAll();
        return this.statuses.get(id);
      }
      for (const dependentId of [...this.startOrder].reverse()) {
        if (dependentId === id || !this.dependsOn(dependentId, id)) continue;
        const dependentStatus = await this.stopPlugin(dependentId);
        if (dependentStatus?.status === 'failed') {
          this.setStatus(id, 'failed', 'stop_failed');
          return this.statuses.get(id);
        }
        this.setStatus(dependentId, 'unavailable', 'dependency_unavailable');
      }
      return this.stopPlugin(id, { persistDisabled: true });
    });
    this.locks.set(
      id,
      operation.catch(() => {}),
    );
    return operation;
  }

  dependsOn(pluginId, targetId, visited = new Set()) {
    if (visited.has(pluginId)) return false;
    visited.add(pluginId);
    const definition = this.definitions.get(pluginId);
    for (const dependency of definition?.manifest?.dependencies ?? []) {
      if (
        dependency.id === targetId ||
        this.dependsOn(dependency.id, targetId, visited)
      ) {
        return true;
      }
    }
    return false;
  }

  async stopAll() {
    for (const id of [...this.startOrder].reverse()) {
      await this.stopPlugin(id);
    }
    return this.getStatuses();
  }
}

export const OFFICIAL_PLUGIN_HOST_LIMITS = Object.freeze({
  lifecycleTimeoutMs: LIFECYCLE_TIMEOUT_MS,
});
