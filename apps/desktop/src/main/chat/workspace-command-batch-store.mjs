import { createHash, randomUUID } from 'node:crypto';
import { requireText, isoNow } from './records.mjs';
import { isWorkspaceIdentity } from '../platform/workspace-identity.ts';
import {
  MAX_COMMAND_TASK_RECOVERY_BYTES,
  MAX_COMMAND_APP_RECOVERY_BYTES,
} from '../execution/workspace-command-quotas.ts';
import { workspaceFileChangeError } from './workspace-change-error.ts';

const MAX_SOCIAL_WORK_TASK_BLOB_BYTES = MAX_COMMAND_TASK_RECOVERY_BYTES;
const MAX_SOCIAL_WORK_TOTAL_BLOB_BYTES = MAX_COMMAND_APP_RECOVERY_BYTES;

export class WorkspaceCommandBatchStore {
  constructor(db, { blobStore = null } = {}) {
    this.db = db;
    this.workspaceChangeBlobStore = blobStore;
    this.workspaceChangeBlobIntegrityError = null;
  }

  assertWorkspaceChangeBlobsUsable() {
    this.#assertWorkspaceChangeBlobsUsable();
  }

  referencedWorkspaceBlobBytes(taskId) {
    return this.#referencedWorkspaceBlobBytes(taskId);
  }

  beginSocialWorkCommandBatch({ taskId, stepId }) {
    this.#assertWorkspaceChangeBlobsUsable();
    const safeTaskId = requireText(taskId, '任务 ID', 200);
    const safeStepId = requireText(stepId, '步骤 ID', 200);
    const now = isoNow();
    const batchId = randomUUID();
    const mirrorKey = randomUUID();
    const outcome = this.db.transaction(() => {
      const task = this.db
        .prepare(`
          SELECT status, workspace_identity_json AS workspaceIdentityJson
          FROM social_work_tasks WHERE id = ?
        `)
        .get(safeTaskId);
      const step = this.db
        .prepare(`
          SELECT category, status FROM social_work_execution_steps
          WHERE id = ? AND task_id = ?
        `)
        .get(safeStepId, safeTaskId);
      const identity = task?.workspaceIdentityJson
        ? JSON.parse(task.workspaceIdentityJson)
        : null;
      if (
        !task ||
        !['starting', 'running'].includes(task.status) ||
        !step ||
        step.category !== 'command' ||
        step.status !== 'running' ||
        !isWorkspaceIdentity(identity)
      ) {
        throw workspaceFileChangeError(
          'workspace_command_batch_owner_unavailable',
          '项目命令变更记录 owner 不可用；命令没有启动。',
        );
      }
      const workspacePath =
        process.platform === 'win32'
          ? identity.canonicalPath.toLocaleLowerCase('en-US')
          : identity.canonicalPath;
      const workspaceKey = createHash('sha256')
        .update(
          `noema-workspace-v1
${workspacePath}
${identity.device}
${identity.fileIndex}`,
        )
        .digest('hex');
      if (
        this.db
          .prepare(
            'SELECT 1 FROM social_work_workspace_write_locks WHERE workspace_key = ?',
          )
          .get(workspaceKey)
      ) {
        throw workspaceFileChangeError(
          'workspace_write_lock_busy',
          '此工作区有一批文件变更仍需恢复或审阅；本次命令没有启动。',
        );
      }
      this.db
        .prepare(`
          INSERT INTO social_work_command_batches (
            id, task_id, step_id, workspace_key, mirror_key, status,
            workspace_identity_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'preparing', ?, ?, ?)
        `)
        .run(
          batchId,
          safeTaskId,
          safeStepId,
          workspaceKey,
          mirrorKey,
          JSON.stringify(identity),
          now,
          now,
        );
      this.db
        .prepare(`
          INSERT INTO social_work_workspace_write_locks (
            workspace_key, task_id, command_batch_id, acquired_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `)
        .run(workspaceKey, safeTaskId, batchId, now, now);
      return this.getSocialWorkCommandBatch(safeTaskId, batchId);
    })();
    return outcome;
  }

  recoverInterruptedCommandBatches() {
    const rows = this.db
      .prepare(`
        SELECT id, task_id AS taskId, status
        FROM social_work_command_batches
        WHERE status IN ('preparing', 'running', 'collecting', 'syncing')
        ORDER BY created_at, id
      `)
      .all();
    if (!rows.length) return [];
    const now = isoNow();
    this.db.transaction(() => {
      for (const row of rows) {
        if (row.status === 'preparing') {
          this.db
            .prepare(`
              UPDATE social_work_command_batches
              SET status = 'not_applied', reason_code = 'app_restarted',
                  base_manifest_hash = NULL, final_manifest_hash = NULL,
                  updated_at = ?
              WHERE id = ? AND status = 'preparing'
            `)
            .run(now, row.id);
          this.db
            .prepare(`
              UPDATE social_work_file_change_operations
              SET before_blob_hash = NULL, after_blob_hash = NULL
              WHERE command_batch_id = ?
            `)
            .run(row.id);
          this.db
            .prepare(
              'DELETE FROM social_work_workspace_write_locks WHERE command_batch_id = ?',
            )
            .run(row.id);
        } else {
          this.db
            .prepare(`
              UPDATE social_work_command_batches
              SET status = 'unknown', reason_code = 'app_restarted',
                  updated_at = ?
              WHERE id = ? AND status IN ('running', 'collecting', 'syncing')
            `)
            .run(now, row.id);
        }
      }
    })();
    return rows.map(({ id }) => id);
  }

  getSocialWorkCommandBatch(taskId, batchId) {
    const safeTaskId = requireText(taskId, '任务 ID', 200);
    const safeBatchId = requireText(batchId, '命令批次 ID', 200);
    const row = this.db
      .prepare(`
        SELECT id, task_id AS taskId, step_id AS stepId,
               workspace_key AS workspaceKey, mirror_key AS mirrorKey,
               status, workspace_identity_json AS workspaceIdentityJson,
               base_manifest_hash AS baseManifestHash,
               final_manifest_hash AS finalManifestHash,
               reason_code AS reasonCode, created_at AS createdAt,
               updated_at AS updatedAt
        FROM social_work_command_batches WHERE id = ? AND task_id = ?
      `)
      .get(safeBatchId, safeTaskId);
    if (!row) return null;
    const { workspaceIdentityJson, ...safeRow } = row;
    return { ...safeRow, workspaceIdentity: JSON.parse(workspaceIdentityJson) };
  }

  listSocialWorkCommandBatches(taskId) {
    const safeTaskId = requireText(taskId, '任务 ID', 200);
    const ids = this.db
      .prepare(`
        SELECT id FROM social_work_command_batches
        WHERE task_id = ? ORDER BY created_at, id
      `)
      .all(safeTaskId);
    return ids
      .map(({ id }) => this.getSocialWorkCommandBatch(safeTaskId, id))
      .filter(Boolean);
  }

  listPublicSocialWorkCommandBatches(taskId) {
    return this.listSocialWorkCommandBatches(taskId).map((batch) => ({
      id: batch.id,
      stepId: batch.stepId,
      status: batch.status,
      reasonCode: batch.reasonCode,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    }));
  }

  listSocialWorkCommandBatchChanges(taskId, batchId) {
    const safeTaskId = requireText(taskId, '任务 ID', 200);
    const safeBatchId = requireText(batchId, '命令批次 ID', 200);
    if (!this.getSocialWorkCommandBatch(safeTaskId, safeBatchId)) {
      throw new Error('找不到项目命令批次。');
    }
    return this.db
      .prepare(`
        SELECT c.id AS changeId, c.relative_path AS relativePath,
               c.original_exists AS originalExists,
               c.original_hash AS originalHash,
               c.original_blob_hash AS originalBlobHash,
               c.latest_hash AS latestHash,
               c.latest_exists AS latestExists,
               c.diff_text AS diffText, c.diff_truncated AS diffTruncated,
               c.state AS changeState,
               o.id AS operationId, o.step_id AS stepId,
               o.ordinal, o.before_hash AS beforeHash,
               o.after_hash AS afterHash,
               o.before_blob_hash AS beforeBlobHash,
               o.after_blob_hash AS afterBlobHash,
               o.state AS operationState, o.created_at AS createdAt,
               o.completed_at AS completedAt
        FROM social_work_file_change_operations AS o
        JOIN social_work_file_changes AS c ON c.id = o.change_id
        WHERE o.task_id = ? AND o.command_batch_id = ?
        ORDER BY c.relative_path, o.ordinal
      `)
      .all(safeTaskId, safeBatchId)
      .map((row) => ({
        ...row,
        originalExists: Boolean(row.originalExists),
        latestExists: Boolean(row.latestExists),
        diffTruncated: Boolean(row.diffTruncated),
      }));
  }

  readSocialWorkCommandBlob({ taskId, batchId, hash }) {
    const safeTaskId = requireText(taskId, '任务 ID', 200);
    const safeBatchId = requireText(batchId, '命令批次 ID', 200);
    if (!/^[a-f0-9]{64}$/u.test(hash ?? '')) {
      throw workspaceFileChangeError(
        'workspace_change_blob_hash_invalid',
        '工作区恢复资料索引无效。',
      );
    }
    const permitted = this.db
      .prepare(`
        SELECT 1 FROM social_work_command_batches
        WHERE id = ? AND task_id = ? AND
          (base_manifest_hash = ? OR final_manifest_hash = ?)
        UNION ALL
        SELECT 1 FROM social_work_file_change_operations
        WHERE command_batch_id = ? AND task_id = ? AND
          (before_blob_hash = ? OR after_blob_hash = ?)
        LIMIT 1
      `)
      .get(
        safeBatchId,
        safeTaskId,
        hash,
        hash,
        safeBatchId,
        safeTaskId,
        hash,
        hash,
      );
    if (!permitted || !this.workspaceChangeBlobStore) {
      throw workspaceFileChangeError(
        'workspace_change_blob_unavailable',
        '这份项目命令恢复资料当前不可读取。',
      );
    }
    const entry = this.db
      .prepare(`
        SELECT size_bytes AS sizeBytes FROM social_work_change_blobs
        WHERE hash = ?
      `)
      .get(hash);
    if (!entry) {
      throw workspaceFileChangeError(
        'workspace_change_blob_missing',
        '项目命令恢复资料缺失；工作区写回已停止。',
      );
    }
    const bytes = this.workspaceChangeBlobStore.read(hash);
    if (bytes.byteLength !== entry.sizeBytes) {
      throw workspaceFileChangeError(
        'workspace_change_blob_corrupt',
        '项目命令恢复资料校验失败；工作区写回已停止。',
      );
    }
    return bytes;
  }

  transitionSocialWorkCommandBatch({
    taskId,
    batchId,
    status,
    reasonCode = null,
  }) {
    const safeTaskId = requireText(taskId, '任务 ID', 200);
    const safeBatchId = requireText(batchId, '命令批次 ID', 200);
    if (
      ![
        'preparing',
        'running',
        'collecting',
        'syncing',
        'completed',
        'partial',
        'conflict',
        'unknown',
        'not_applied',
      ].includes(status) ||
      (reasonCode !== null &&
        (typeof reasonCode !== 'string' ||
          !/^[a-z][a-z0-9_]{1,79}$/u.test(reasonCode)))
    ) {
      throw new TypeError('workspace_command_batch_state_invalid');
    }
    const allowed = {
      preparing: ['running', 'not_applied', 'unknown'],
      running: ['collecting', 'not_applied', 'unknown'],
      collecting: ['syncing', 'conflict', 'not_applied', 'unknown'],
      syncing: ['completed', 'partial', 'conflict', 'unknown'],
      partial: ['syncing', 'partial', 'conflict', 'completed', 'unknown'],
      conflict: ['syncing', 'partial', 'conflict', 'completed', 'unknown'],
      unknown: [
        'collecting',
        'syncing',
        'completed',
        'partial',
        'conflict',
        'not_applied',
        'unknown',
      ],
      completed: [],
      not_applied: [],
    };
    const now = isoNow();
    return this.db.transaction(() => {
      const current = this.db
        .prepare(`
          SELECT status FROM social_work_command_batches
          WHERE task_id = ? AND id = ?
        `)
        .get(safeTaskId, safeBatchId);
      if (!current) throw new Error('找不到项目命令批次。');
      if (!allowed[current.status]?.includes(status)) {
        throw workspaceFileChangeError(
          'workspace_command_batch_transition_invalid',
          '项目命令批次状态已经变化；恢复记录已保留。',
        );
      }
      this.db
        .prepare(`
          UPDATE social_work_command_batches
          SET status = ?, reason_code = ?, updated_at = ?
          WHERE task_id = ? AND id = ? AND status = ?
        `)
        .run(status, reasonCode, now, safeTaskId, safeBatchId, current.status);
      if (['completed', 'not_applied'].includes(status)) {
        this.db
          .prepare(`
            UPDATE social_work_command_batches
            SET base_manifest_hash = NULL, final_manifest_hash = NULL
            WHERE id = ? AND task_id = ?
          `)
          .run(safeBatchId, safeTaskId);
        this.db
          .prepare(`
            UPDATE social_work_file_change_operations
            SET before_blob_hash = NULL, after_blob_hash = NULL
            WHERE command_batch_id = ? AND task_id = ?
          `)
          .run(safeBatchId, safeTaskId);
        this.db
          .prepare(`
            DELETE FROM social_work_workspace_write_locks
            WHERE command_batch_id = ? AND task_id = ?
          `)
          .run(safeBatchId, safeTaskId);
      } else {
        this.db
          .prepare(`
            UPDATE social_work_workspace_write_locks SET updated_at = ?
            WHERE command_batch_id = ? AND task_id = ?
          `)
          .run(now, safeBatchId, safeTaskId);
      }
      return this.getSocialWorkCommandBatch(safeTaskId, safeBatchId);
    })();
  }

  putSocialWorkCommandManifest({ taskId, batchId, kind, bytes }) {
    this.#assertWorkspaceChangeBlobsUsable();
    const safeTaskId = requireText(taskId, '任务 ID', 200);
    const safeBatchId = requireText(batchId, '命令批次 ID', 200);
    if (!['base', 'final'].includes(kind) || !Buffer.isBuffer(bytes)) {
      throw new TypeError('workspace_command_manifest_invalid');
    }
    if (!this.workspaceChangeBlobStore) {
      throw workspaceFileChangeError(
        'workspace_change_blob_store_unavailable',
        '项目命令恢复存储不可用；命令没有启动。',
      );
    }
    const stored = this.workspaceChangeBlobStore.put(bytes);
    const now = isoNow();
    return this.db.transaction(() => {
      const batch = this.getSocialWorkCommandBatch(safeTaskId, safeBatchId);
      if (!batch) throw new Error('找不到项目命令批次。');
      if (
        (kind === 'base' && batch.status !== 'preparing') ||
        (kind === 'final' && !['collecting', 'syncing'].includes(batch.status))
      ) {
        throw workspaceFileChangeError(
          'workspace_command_batch_state_invalid',
          '命令批次状态不允许保存该恢复清单。',
        );
      }
      const existing = this.db
        .prepare(
          'SELECT size_bytes AS sizeBytes FROM social_work_change_blobs WHERE hash = ?',
        )
        .get(stored.hash);
      const taskHasBlob = this.#isWorkspaceBlobReferenced(
        stored.hash,
        safeTaskId,
      );
      const allHaveBlob = this.#isWorkspaceBlobReferenced(stored.hash, null);
      const taskBytes = this.#referencedWorkspaceBlobBytes(safeTaskId);
      const allBytes = this.#referencedWorkspaceBlobBytes(null);
      if (
        (!taskHasBlob &&
          taskBytes + stored.size > MAX_SOCIAL_WORK_TASK_BLOB_BYTES) ||
        (!allHaveBlob &&
          allBytes + stored.size > MAX_SOCIAL_WORK_TOTAL_BLOB_BYTES)
      ) {
        throw workspaceFileChangeError(
          'workspace_change_blob_quota_exceeded',
          '工作区恢复资料达到存储上限；本次清单没有登记。',
        );
      }
      if (!existing) {
        this.db
          .prepare(`
              INSERT INTO social_work_change_blobs(hash, size_bytes, created_at)
              VALUES (?, ?, ?)
            `)
          .run(stored.hash, stored.size, now);
      }
      const column =
        kind === 'base' ? 'base_manifest_hash' : 'final_manifest_hash';
      this.db
        .prepare(`
            UPDATE social_work_command_batches
            SET ${column} = ?, updated_at = ?
            WHERE task_id = ? AND id = ?
          `)
        .run(stored.hash, now, safeTaskId, safeBatchId);
      return this.getSocialWorkCommandBatch(safeTaskId, safeBatchId);
    })();
  }

  collectUnreferencedWorkspaceChangeBlobs() {
    if (!this.workspaceChangeBlobStore) return { removed: 0, retained: 0 };
    const hashes = this.db
      .prepare(`
        SELECT hash FROM (
          SELECT original_blob_hash AS hash FROM social_work_file_changes
          UNION SELECT before_blob_hash AS hash FROM social_work_file_change_operations
          UNION SELECT after_blob_hash AS hash FROM social_work_file_change_operations
          UNION SELECT base_manifest_hash AS hash FROM social_work_command_batches
          UNION SELECT final_manifest_hash AS hash FROM social_work_command_batches
        ) WHERE hash IS NOT NULL
      `)
      .all()
      .map(({ hash }) => hash);
    const result = this.workspaceChangeBlobStore.collectUnreferenced(hashes);
    const refs = new Set(hashes);
    for (const { hash } of this.db
      .prepare('SELECT hash FROM social_work_change_blobs')
      .all()) {
      if (!refs.has(hash)) {
        this.db
          .prepare('DELETE FROM social_work_change_blobs WHERE hash = ?')
          .run(hash);
      }
    }
    return result;
  }

  #assertWorkspaceChangeBlobsUsable() {
    if (!this.workspaceChangeBlobIntegrityError) return;
    throw workspaceFileChangeError(
      'workspace_change_blob_integrity_failed',
      '项目命令恢复资料校验失败；新的命令批次已停止。',
    );
  }

  verifyReferencedWorkspaceChangeBlobs() {
    try {
      if (!this.workspaceChangeBlobStore) {
        const referenced = this.db
          .prepare(`
            SELECT 1 FROM social_work_change_blobs LIMIT 1
          `)
          .get();
        if (referenced) {
          throw workspaceFileChangeError(
            'workspace_change_blob_store_unavailable',
            '项目命令恢复资料存储不可用。',
          );
        }
        this.workspaceChangeBlobIntegrityError = null;
        return { verified: 0, orphanFilesRemoved: 0 };
      }
      const rows = this.db
        .prepare(`
          SELECT hash, size_bytes AS sizeBytes FROM social_work_change_blobs
          ORDER BY hash
        `)
        .all();
      const references = new Set(
        this.db
          .prepare(`
            SELECT hash FROM (
              SELECT original_blob_hash AS hash FROM social_work_file_changes
              UNION SELECT before_blob_hash AS hash FROM social_work_file_change_operations
              UNION SELECT after_blob_hash AS hash FROM social_work_file_change_operations
              UNION SELECT base_manifest_hash AS hash FROM social_work_command_batches
              UNION SELECT final_manifest_hash AS hash FROM social_work_command_batches
            ) WHERE hash IS NOT NULL
          `)
          .all()
          .map(({ hash }) => hash),
      );
      for (const row of rows) {
        if (!references.has(row.hash)) continue;
        this.workspaceChangeBlobStore.verify(row.hash, row.sizeBytes);
      }
      const cleaned = this.collectUnreferencedWorkspaceChangeBlobs();
      this.workspaceChangeBlobIntegrityError = null;
      return {
        verified: rows.filter(({ hash }) => references.has(hash)).length,
        orphanFilesRemoved: cleaned.removed,
      };
    } catch (error) {
      this.workspaceChangeBlobIntegrityError = error;
      throw error;
    }
  }

  #referencedWorkspaceBlobBytes(taskId) {
    const taskFilter = taskId === null ? '' : ' AND task_id = ?';
    const args = taskId === null ? [] : [taskId];
    const rows = this.db
      .prepare(`
        SELECT DISTINCT hash FROM (
          SELECT original_blob_hash AS hash, task_id FROM social_work_file_changes
          UNION ALL
          SELECT before_blob_hash AS hash, task_id FROM social_work_file_change_operations
          UNION ALL
          SELECT after_blob_hash AS hash, task_id FROM social_work_file_change_operations
          UNION ALL
          SELECT base_manifest_hash AS hash, task_id FROM social_work_command_batches
          UNION ALL
          SELECT final_manifest_hash AS hash, task_id FROM social_work_command_batches
        ) WHERE hash IS NOT NULL${taskFilter}
      `)
      .all(...args);
    if (!rows.length) return 0;
    const placeholders = rows.map(() => '?').join(', ');
    return (
      this.db
        .prepare(`
          SELECT COALESCE(SUM(size_bytes), 0) AS bytes
          FROM social_work_change_blobs WHERE hash IN (${placeholders})
        `)
        .get(...rows.map(({ hash }) => hash)).bytes ?? 0
    );
  }

  #isWorkspaceBlobReferenced(hash, taskId) {
    const taskFilter = taskId === null ? '' : ' AND task_id = ?';
    const args = taskId === null ? [hash] : [hash, taskId];
    return Boolean(
      this.db
        .prepare(`
          SELECT 1 FROM (
            SELECT original_blob_hash AS hash, task_id FROM social_work_file_changes
            UNION ALL
            SELECT before_blob_hash AS hash, task_id FROM social_work_file_change_operations
            UNION ALL
            SELECT after_blob_hash AS hash, task_id FROM social_work_file_change_operations
            UNION ALL
            SELECT base_manifest_hash AS hash, task_id FROM social_work_command_batches
            UNION ALL
            SELECT final_manifest_hash AS hash, task_id FROM social_work_command_batches
          ) WHERE hash = ?${taskFilter} LIMIT 1
        `)
        .get(...args),
    );
  }
}
