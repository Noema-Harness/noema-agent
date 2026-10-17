import fs from 'node:fs';
import path from 'node:path';

/**
 * Keeps one SQLite-consistent snapshot before the first social-chat migration.
 * @param {{db:import('better-sqlite3').Database,databasePath:string}} input
 */
export async function backupBeforeSocialChatMigration({ db, databasePath }) {
  if (
    typeof databasePath !== 'string' ||
    !databasePath.trim() ||
    databasePath === ':memory:' ||
    !path.isAbsolute(databasePath) ||
    !fs.existsSync(databasePath)
  ) {
    return null;
  }
  const schemaExists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'social_schema_migrations'",
    )
    .get();
  if (schemaExists) return null;

  const backupPath = path.join(
    path.dirname(databasePath),
    'noema-before-social-chat-v1.sqlite3',
  );
  if (fs.existsSync(backupPath)) return backupPath;
  await db.backup(backupPath);
  return backupPath;
}
