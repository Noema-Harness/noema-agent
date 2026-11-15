const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9.-]{0,62}[a-z0-9]$/u;
const MAX_PLUGIN_KEY_LENGTH = 128;
const MAX_PLUGIN_VALUE_LENGTH = 65_536;
const MAX_PLUGIN_ENTRIES = 1_000;

function assertPluginId(pluginId: unknown) {
  if (typeof pluginId !== 'string' || !PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new TypeError('官方插件 ID 无效。');
  }
}

function assertKey(key: unknown) {
  if (
    typeof key !== 'string' ||
    !key.trim() ||
    key.length > MAX_PLUGIN_KEY_LENGTH
  ) {
    throw new TypeError('官方插件状态键无效。');
  }
}

function serialize(value: unknown) {
  let result;
  try {
    result = JSON.stringify(value);
  } catch {
    throw new TypeError('官方插件状态值无法序列化。');
  }
  if (result === undefined || result.length > MAX_PLUGIN_VALUE_LENGTH) {
    throw new TypeError('官方插件状态值超出大小限制。');
  }
  return result;
}

function parse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('official_plugin_state_corrupt');
  }
}

/** Host-owned access to namespaced official plugin state. */
type Statement<
  BindParameters extends unknown[],
  Result = unknown,
> = import('better-sqlite3').Statement<BindParameters, Result>;

export type OfficialPluginStateScope = Readonly<{
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => boolean;
  entries: () => Array<[string, unknown]>;
}>;

export type OfficialPluginMigration = (input: {
  fromVersion: number;
  state: OfficialPluginStateScope;
}) => void;

export class OfficialPluginStateStore {
  declare db: import('better-sqlite3').Database;
  declare readValue: Statement<[string, string], { value_json: string }>;
  declare writeValue: Statement<[string, string, string, string]>;
  declare deleteValue: Statement<[string, string]>;
  declare readEntries: Statement<
    [string, number],
    { state_key: string; value_json: string }
  >;
  declare readVersion: Statement<[string], { state_version: number }>;
  declare writeVersion: Statement<[string, number, string]>;
  declare readEnabled: Statement<[string], { enabled: number }>;
  declare writeEnabled: Statement<[string, number, string]>;

  constructor(db: import('better-sqlite3').Database) {
    this.db = db;
    this.readValue = db.prepare<[string, string], { value_json: string }>(
      'SELECT value_json FROM official_plugin_state WHERE plugin_id = ? AND state_key = ?',
    );
    this.writeValue = db.prepare<[string, string, string, string]>(`
      INSERT INTO official_plugin_state(plugin_id, state_key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(plugin_id, state_key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);
    this.deleteValue = db.prepare<[string, string]>(
      'DELETE FROM official_plugin_state WHERE plugin_id = ? AND state_key = ?',
    );
    this.readEntries = db.prepare<
      [string, number],
      { state_key: string; value_json: string }
    >(`
      SELECT state_key, value_json FROM official_plugin_state
      WHERE plugin_id = ? ORDER BY state_key LIMIT ?
    `);
    this.readVersion = db.prepare<[string], { state_version: number }>(
      'SELECT state_version FROM official_plugin_schemas WHERE plugin_id = ?',
    );
    this.writeVersion = db.prepare<[string, number, string]>(`
      INSERT INTO official_plugin_schemas(plugin_id, state_version, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(plugin_id) DO UPDATE SET
        state_version = excluded.state_version,
        updated_at = excluded.updated_at
    `);
    this.readEnabled = db.prepare<[string], { enabled: number }>(
      'SELECT enabled FROM official_plugin_preferences WHERE plugin_id = ?',
    );
    this.writeEnabled = db.prepare<[string, number, string]>(`
      INSERT INTO official_plugin_preferences(plugin_id, enabled, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(plugin_id) DO UPDATE SET
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `);
  }

  scope(pluginId: string): OfficialPluginStateScope {
    assertPluginId(pluginId);
    return Object.freeze({
      get: (key: string) => {
        assertKey(key);
        const row = this.readValue.get(pluginId, key);
        return row ? parse(row.value_json) : undefined;
      },
      set: (key: string, value: unknown) => {
        assertKey(key);
        this.writeValue.run(
          pluginId,
          key,
          serialize(value),
          new Date().toISOString(),
        );
      },
      delete: (key: string) => {
        assertKey(key);
        return this.deleteValue.run(pluginId, key).changes > 0;
      },
      entries: () => {
        const rows = this.readEntries.all(pluginId, MAX_PLUGIN_ENTRIES + 1);
        if (rows.length > MAX_PLUGIN_ENTRIES) {
          throw new Error('official_plugin_state_entry_limit');
        }
        return rows.map(({ state_key, value_json }): [string, unknown] => [
          state_key,
          parse(value_json),
        ]);
      },
    });
  }

  schemaVersion(pluginId: string): number {
    assertPluginId(pluginId);
    return this.readVersion.get(pluginId)?.state_version ?? 0;
  }

  setSchemaVersion(pluginId: string, version: number) {
    assertPluginId(pluginId);
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new TypeError('官方插件状态版本无效。');
    }
    this.writeVersion.run(pluginId, version, new Date().toISOString());
  }

  enabled(pluginId: string) {
    assertPluginId(pluginId);
    const value = this.readEnabled.get(pluginId)?.enabled;
    return value === undefined ? null : value === 1;
  }

  setEnabled(pluginId: string, enabled: boolean) {
    assertPluginId(pluginId);
    if (typeof enabled !== 'boolean') {
      throw new TypeError('官方插件启用状态无效。');
    }
    this.writeEnabled.run(pluginId, enabled ? 1 : 0, new Date().toISOString());
  }

  /** Run a synchronous plugin migration and version write in one transaction. */
  migrate(
    pluginId: string,
    targetVersion: number,
    migration: OfficialPluginMigration,
  ) {
    assertPluginId(pluginId);
    if (typeof migration !== 'function') {
      throw new TypeError('官方插件迁移无效。');
    }
    const run = this.db.transaction(() => {
      const fromVersion = this.schemaVersion(pluginId);
      migration({ fromVersion, state: this.scope(pluginId) });
      this.setSchemaVersion(pluginId, targetVersion);
    });
    run.immediate();
  }
}

export const OFFICIAL_PLUGIN_STORAGE_LIMITS = Object.freeze({
  maxEntries: MAX_PLUGIN_ENTRIES,
  maxKeyLength: MAX_PLUGIN_KEY_LENGTH,
  maxValueLength: MAX_PLUGIN_VALUE_LENGTH,
});
