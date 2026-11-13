import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { SOCIAL_SCHEMA_VERSION } from './social-chat-schema.ts';

function socialVersion(db: Database.Database): number {
  const exists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'social_schema_migrations'",
    )
    .get();
  return exists
    ? ((
        db
          .prepare(
            'SELECT MAX(version) AS version FROM social_schema_migrations',
          )
          .get() as { version: number | null } | undefined
      )?.version ?? 0)
    : 0;
}

function verifySnapshot(
  filename: string,
  expectedVersion: number,
  seal = false,
) {
  const snapshot = new Database(filename, {
    readonly: !seal,
    fileMustExist: true,
  });
  try {
    // SQLite backup copies the source's WAL mode. Seal the temporary copy as a
    // standalone file before publishing it; no renamed WAL/SHM sidecars remain.
    if (seal) snapshot.pragma('journal_mode = DELETE');
    if (snapshot.pragma('quick_check', { simple: true }) !== 'ok') {
      throw new Error('Noema migration backup failed SQLite integrity check.');
    }
    if (socialVersion(snapshot) !== expectedVersion) {
      throw new Error(
        'Noema migration backup has an unexpected schema version.',
      );
    }
    if (
      !snapshot
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'root_messages'",
        )
        .get()
    ) {
      throw new Error(
        'Noema migration backup is missing the original conversation store.',
      );
    }
  } finally {
    snapshot.close();
  }
}

/**
 * Publishes a verified SQLite snapshot before each pending schema upgrade.
 */
export async function backupBeforeSocialChatMigration({
  db,
  databasePath,
  targetVersion = SOCIAL_SCHEMA_VERSION,
}: {
  db: import('better-sqlite3').Database;
  databasePath: string;
  targetVersion?: number;
}) {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new TypeError(
      'The target social schema version must be a positive integer.',
    );
  }
  if (
    typeof databasePath !== 'string' ||
    !databasePath.trim() ||
    databasePath === ':memory:' ||
    !path.isAbsolute(databasePath) ||
    !fs.existsSync(databasePath)
  ) {
    return null;
  }
  const currentVersion = socialVersion(db);
  if (currentVersion >= targetVersion) return null;

  const backupPath = path.join(
    path.dirname(databasePath),
    // Preserve the original first-upgrade filename for existing installations.
    `noema-before-social-chat-v${currentVersion === 0 ? 1 : targetVersion}.sqlite3`,
  );
  if (fs.existsSync(backupPath)) {
    try {
      verifySnapshot(backupPath, currentVersion);
      return backupPath;
    } catch {
      // Preserve the suspect file for diagnosis. A partial file from a crashed
      // startup must not be mistaken for a completed migration backup.
      fs.renameSync(backupPath, `${backupPath}.invalid-${randomUUID()}`);
    }
  }
  const stagingPath = `${backupPath}.partial-${randomUUID()}`;
  try {
    await db.backup(stagingPath);
    verifySnapshot(stagingPath, currentVersion, true);
    fs.renameSync(stagingPath, backupPath);
  } catch (error) {
    fs.rmSync(stagingPath, { force: true });
    throw error;
  }
  return backupPath;
}
