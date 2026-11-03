const MAX_VERSION_LENGTH = 80;

function safeVersion(value) {
  return typeof value === 'string' && value.length <= MAX_VERSION_LENGTH
    ? value
    : null;
}

function migrationVersion(db, tableName) {
  const tableNames = new Set([
    'social_schema_migrations',
    'diagnostics_schema_migrations',
  ]);
  if (!tableNames.has(tableName)) return null;
  try {
    const version = db
      .prepare(`SELECT MAX(version) AS version FROM ${tableName}`)
      .get()?.version;
    return Number.isSafeInteger(version) && version >= 0 ? version : null;
  } catch {
    return null;
  }
}

/**
 * Collects bounded application/runtime metadata without host paths or content.
 * @param {{db:import('better-sqlite3').Database,applicationVersion:string,electronVersion:string|null,nodeVersion:string|null,osVersion:string|null,platform:string,architecture:string,isPackaged:boolean}} input
 */
export function collectDiagnosticsRuntimeInfo({
  db,
  applicationVersion,
  electronVersion,
  nodeVersion,
  osVersion,
  platform,
  architecture,
  isPackaged,
}) {
  return {
    applicationVersion: safeVersion(applicationVersion),
    electronVersion: safeVersion(electronVersion),
    nodeVersion: safeVersion(nodeVersion),
    osVersion: safeVersion(osVersion),
    platform: safeVersion(platform),
    architecture: safeVersion(architecture),
    isPackaged: isPackaged === true,
    socialSchemaVersion: migrationVersion(db, 'social_schema_migrations'),
    diagnosticsSchemaVersion: migrationVersion(
      db,
      'diagnostics_schema_migrations',
    ),
  };
}
