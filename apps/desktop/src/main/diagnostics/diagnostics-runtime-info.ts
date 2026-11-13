const MAX_VERSION_LENGTH = 80;

function safeVersion(value: unknown) {
  return typeof value === 'string' && value.length <= MAX_VERSION_LENGTH
    ? value
    : null;
}

function migrationVersion(
  db: import('better-sqlite3').Database,
  tableName: string,
) {
  const tableNames = new Set([
    'social_schema_migrations',
    'diagnostics_schema_migrations',
  ]);
  if (!tableNames.has(tableName)) return null;
  try {
    const row = db
      .prepare(`SELECT MAX(version) AS version FROM ${tableName}`)
      .get() as { version?: unknown } | undefined;
    const version = row?.version;
    return typeof version === 'number' &&
      Number.isSafeInteger(version) &&
      version >= 0
      ? version
      : null;
  } catch {
    return null;
  }
}

/**
 * Collects bounded application/runtime metadata without host paths or content.
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
}: {
  db: import('better-sqlite3').Database;
  applicationVersion: string;
  electronVersion: string | null;
  nodeVersion: string | null;
  osVersion: string | null;
  platform: string;
  architecture: string;
  isPackaged: boolean;
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
