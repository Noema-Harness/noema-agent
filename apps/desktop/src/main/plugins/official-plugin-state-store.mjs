const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9.-]{0,62}[a-z0-9]$/u;
const MAX_PLUGIN_KEY_LENGTH = 128;
const MAX_PLUGIN_VALUE_LENGTH = 65_536;
const MAX_PLUGIN_ENTRIES = 1_000;

function assertPluginId(pluginId) {
  if (typeof pluginId !== 'string' || !PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new TypeError('官方插件 ID 无效。');
  }
}

function assertKey(key) {
  if (
    typeof key !== 'string' ||
    !key.trim() ||
    key.length > MAX_PLUGIN_KEY_LENGTH
  ) {
    throw new TypeError('官方插件状态键无效。');
  }
}

function serialize(value) {
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

function parse(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('official_plugin_state_corrupt');
  }
}

/** Host-owned access to namespaced official plugin state. */
export class OfficialPluginStateStore {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db) {
    this.db = db;
    this.readValue = db.prepare(
      'SELECT value_json FROM official_plugin_state WHERE plugin_id = ? AND state_key = ?',
    );
    this.writeValue = db.prepare(`
      INSERT INTO official_plugin_state(plugin_id, state_key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(plugin_id, state_key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);
    this.deleteValue = db.prepare(
      'DELETE FROM official_plugin_state WHERE plugin_id = ? AND state_key = ?',
    );
    this.readEntries = db.prepare(`
      SELECT state_key, value_json FROM official_plugin_state
      WHERE plugin_id = ? ORDER BY state_key LIMIT ?
    `);
    this.readVersion = db.prepare(
      'SELECT state_version FROM official_plugin_schemas WHERE plugin_id = ?',
    );
    this.writeVersion = db.prepare(`
      INSERT INTO official_plugin_schemas(plugin_id, state_version, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(plugin_id) DO UPDATE SET
        state_version = excluded.state_version,
        updated_at = excluded.updated_at
    `);
    this.readEnabled = db.prepare(
      'SELECT enabled FROM official_plugin_preferences WHERE plugin_id = ?',
    );
    this.writeEnabled = db.prepare(`
      INSERT INTO official_plugin_preferences(plugin_id, enabled, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(plugin_id) DO UPDATE SET
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `);
  }

  scope(pluginId) {
    assertPluginId(pluginId);
    return Object.freeze({
      get: (key) => {
        assertKey(key);
        const row = this.readValue.get(pluginId, key);
        return row ? parse(row.value_json) : undefined;
      },
      set: (key, value) => {
        assertKey(key);
        this.writeValue.run(
          pluginId,
          key,
          serialize(value),
          new Date().toISOString(),
        );
      },
      delete: (key) => {
        assertKey(key);
        return this.deleteValue.run(pluginId, key).changes > 0;
      },
      entries: () => {
        const rows = this.readEntries.all(pluginId, MAX_PLUGIN_ENTRIES + 1);
        if (rows.length > MAX_PLUGIN_ENTRIES) {
          throw new Error('official_plugin_state_entry_limit');
        }
        return rows.map(({ state_key, value_json }) => [
          state_key,
          parse(value_json),
        ]);
      },
    });
  }

  schemaVersion(pluginId) {
    assertPluginId(pluginId);
    return this.readVersion.get(pluginId)?.state_version ?? 0;
  }

  setSchemaVersion(pluginId, version) {
    assertPluginId(pluginId);
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new TypeError('官方插件状态版本无效。');
    }
    this.writeVersion.run(pluginId, version, new Date().toISOString());
  }

  enabled(pluginId) {
    assertPluginId(pluginId);
    const value = this.readEnabled.get(pluginId)?.enabled;
    return value === undefined ? null : value === 1;
  }

  setEnabled(pluginId, enabled) {
    assertPluginId(pluginId);
    if (typeof enabled !== 'boolean') {
      throw new TypeError('官方插件启用状态无效。');
    }
    this.writeEnabled.run(pluginId, enabled ? 1 : 0, new Date().toISOString());
  }

  /** Run a synchronous plugin migration and version write in one transaction. */
  migrate(pluginId, targetVersion, migration) {
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
