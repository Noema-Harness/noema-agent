import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  captureWorkspaceIdentity,
  compareWorkspaceIdentities,
} from '../platform/workspace-identity.mjs';
import {
  collectCommandMirrorChanges,
  createCommandMirror,
  normalizeCommandRelativePath,
  readCommandMirrorManifest,
  removeCommandDirectories,
  writeCommandChange,
} from './workspace-command-mirror.mjs';
import { scanWorkspaceFileBoundary } from './workspace-file-boundary.mjs';
import { MAX_COMMAND_CHANGE_PATHS } from './workspace-command-quotas.mjs';

function runnerError(code, message, effectStatus = 'not_applied') {
  const error = new Error(message);
  error.code = code;
  error.effectStatus = effectStatus;
  return error;
}

function commandQuote(value) {
  return String(value).replaceAll('%', '%%');
}

function gitCommandPrefix(gitMetadataPath, mirrorPath) {
  return [
    `set "GIT_DIR=${commandQuote(gitMetadataPath)}"`,
    `set "GIT_WORK_TREE=${commandQuote(mirrorPath)}"`,
    'set "GIT_OPTIONAL_LOCKS=0"',
  ].join(' && ');
}

async function resolveGitMetadataRoots(sourcePath) {
  const dotGit = path.join(sourcePath, '.git');
  let stat;
  try {
    stat = await fsp.lstat(dotGit);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw runnerError(
      'workspace_command_git_metadata_unsupported',
      '项目 Git 元数据是符号链接；命令没有启动。',
    );
  }
  if (stat.isDirectory()) {
    return { gitDir: dotGit, roots: [dotGit] };
  }
  if (!stat.isFile() || stat.size > 4_096) {
    throw runnerError(
      'workspace_command_git_metadata_unsupported',
      '项目 Git 元数据格式不受支持；命令没有启动。',
    );
  }
  const text = await fsp.readFile(dotGit, 'utf8');
  const match = /^gitdir:\s*(.+?)\s*$/imu.exec(text);
  if (!match) {
    throw runnerError(
      'workspace_command_git_metadata_unsupported',
      '项目 Git 元数据格式不受支持；命令没有启动。',
    );
  }
  const gitDir = path.resolve(sourcePath, match[1]);
  const gitStat = await fsp.lstat(gitDir).catch(() => null);
  if (!gitStat?.isDirectory() || gitStat.isSymbolicLink()) {
    throw runnerError(
      'workspace_command_git_metadata_unsupported',
      '项目 Git 元数据目录不可用；命令没有启动。',
    );
  }
  const roots = [gitDir];
  const commonFile = path.join(gitDir, 'commondir');
  const commonText = await fsp.readFile(commonFile, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (commonText?.trim()) {
    const commonDir = path.resolve(gitDir, commonText.trim());
    const commonStat = await fsp.lstat(commonDir).catch(() => null);
    if (commonStat?.isDirectory() && !commonStat.isSymbolicLink()) {
      roots.push(commonDir);
    }
  }
  return { gitDir, roots: [...new Set(roots)] };
}

/**
 * Run one SocialWork command inside a complete ordinary-file mirror.
 *
 * The only durable owner of the resulting file changes remains the
 * SocialChatStore batch/ledger. This class never edits the source workspace
 * before the child process tree has ended and the mirror diff is durable.
 */
export class SocialWorkCommandMirrorRunner {
  constructor({
    store,
    runner,
    mirrorRoot,
    identityCapture = captureWorkspaceIdentity,
    boundaryScanner = scanWorkspaceFileBoundary,
    freeSpace = null,
  }) {
    if (!store || typeof store.beginSocialWorkCommandBatch !== 'function') {
      throw new TypeError('SocialWorkCommandMirrorRunner requires a store.');
    }
    if (!runner || typeof runner.run !== 'function') {
      throw new TypeError('SocialWorkCommandMirrorRunner requires a runner.');
    }
    if (typeof mirrorRoot !== 'string' || !path.isAbsolute(mirrorRoot)) {
      throw new TypeError('Command mirror root must be absolute.');
    }
    this.store = store;
    this.runner = runner;
    this.mirrorRoot = mirrorRoot;
    this.identityCapture = identityCapture;
    this.boundaryScanner = boundaryScanner;
    this.freeSpace = freeSpace;
  }

  async #transition(batch, nextStatus, reasonCode = null) {
    const safeReasonCode =
      typeof reasonCode === 'string' &&
      /^[a-z][a-z0-9_]{1,79}$/u.test(reasonCode)
        ? reasonCode
        : null;
    return this.store.transitionSocialWorkCommandBatch({
      taskId: batch.taskId,
      batchId: batch.id,
      status: nextStatus,
      reasonCode: safeReasonCode,
    });
  }

  async #removeMirror(mirrorPath) {
    if (!mirrorPath) return;
    const resolvedRoot = path.resolve(this.mirrorRoot);
    const resolvedMirror = path.resolve(mirrorPath);
    const relative = path.relative(resolvedRoot, resolvedMirror);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return;
    }
    await fsp.rm(resolvedMirror, { recursive: true, force: true });
  }

  async #applyChanges({
    taskId,
    stepId,
    sourcePath,
    expectedIdentity,
    changes,
    removedDirectories,
  }) {
    const boundary = await this.boundaryScanner(sourcePath, {
      expectedIdentity,
    });
    if (!boundary?.ok) {
      throw runnerError(
        'workspace_command_source_boundary_failed',
        '项目工作区身份或文件边界检查未通过；变更未回写。',
        'conflict',
      );
    }
    let applied = 0;
    let conflicts = 0;
    let unknown = 0;
    for (const change of changes) {
      const result = await writeCommandChange({
        sourcePath,
        expectedIdentity,
        change,
        boundaryChecked: true,
      });
      if (result.status === 'applied') {
        this.store.completeSocialWorkFileChange({
          taskId,
          stepId,
          changeId: change.changeId,
          operationId: change.operationId,
          actualHash: result.actualHash ?? null,
        });
        applied += 1;
      } else if (result.status === 'conflict') {
        this.store.markSocialWorkFileChangeConflict(taskId, change.changeId);
        conflicts += 1;
      } else {
        this.store.markSocialWorkFileChangeUnknown(taskId, change.changeId);
        unknown += 1;
      }
    }
    if (conflicts === 0 && unknown === 0 && removedDirectories.length > 0) {
      const directories = await removeCommandDirectories(
        sourcePath,
        removedDirectories,
      );
      unknown += directories.unknown;
    }
    return { applied, conflicts, unknown };
  }

  async run(input) {
    const {
      taskId,
      requestId: stepId,
      workspacePath: sourcePath,
      expectedWorkspaceIdentity,
      command,
      signal,
    } = input;
    if (
      typeof command !== 'string' ||
      !command.trim() ||
      command.length > 8_000
    ) {
      throw runnerError(
        'workspace_command_invalid',
        '项目命令无效；命令没有启动。',
      );
    }
    if (
      !expectedWorkspaceIdentity ||
      !compareWorkspaceIdentities(
        expectedWorkspaceIdentity,
        this.identityCapture(sourcePath).identity,
      )
    ) {
      throw runnerError(
        'workspace_command_mirror_source_changed',
        '项目工作区身份已变化；命令没有启动。',
      );
    }

    const batch = this.store.beginSocialWorkCommandBatch({
      taskId,
      stepId,
    });
    const mirrorPath = path.join(this.mirrorRoot, batch.mirrorKey);
    let mirrorCreated = false;
    let terminal = false;
    let phase = 'preparing';
    try {
      await fsp.mkdir(this.mirrorRoot, { recursive: true });
      const prepared = await createCommandMirror({
        sourcePath,
        mirrorPath,
        expectedIdentity: expectedWorkspaceIdentity,
        signal,
        identityCapture: this.identityCapture,
        freeSpace: this.freeSpace,
      });
      mirrorCreated = true;
      await this.store.putSocialWorkCommandManifest({
        taskId,
        batchId: batch.id,
        kind: 'base',
        bytes: prepared.manifestBytes,
      });
      await this.#transition(batch, 'running');
      phase = 'running';
      const mirrorIdentity = this.identityCapture(mirrorPath);
      if (!mirrorIdentity?.ok || !mirrorIdentity.identity) {
        throw runnerError(
          'workspace_command_mirror_identity_unavailable',
          '项目命令副本身份不可用；命令没有启动。',
        );
      }

      const gitMetadata = await resolveGitMetadataRoots(sourcePath);
      const additionalAccess = [...(input.additionalAccess ?? [])];
      for (const root of gitMetadata?.roots ?? []) {
        additionalAccess.unshift({
          path: root,
          access: 'read',
          reason: '读取项目 Git 元数据；不写入 Git 目录。',
        });
      }
      if (additionalAccess.length > 4) {
        throw runnerError(
          'workspace_command_git_grants_exceeded',
          '项目 Git 元数据与外部路径授权超过上限；命令没有启动。',
        );
      }
      const internalGitRoots = new Set(
        (gitMetadata?.roots ?? []).map((root) => path.resolve(root)),
      );
      const authorizeAdditionalAccess = async (request) => {
        if (
          request?.access === 'read' &&
          typeof request.path === 'string' &&
          internalGitRoots.has(path.resolve(request.path))
        ) {
          return true;
        }
        return Boolean(await input.authorizeAdditionalAccess?.(request));
      };
      const runCommand = `cd /d "${mirrorPath.replaceAll('"', '""')}" && ${
        gitMetadata
          ? `${gitCommandPrefix(gitMetadata.gitDir, mirrorPath)} && ${command}`
          : command
      }`;
      if (runCommand.length > 8_000) {
        throw runnerError(
          'workspace_command_git_prefix_too_long',
          '项目命令在绑定 Git 元数据后超过长度上限；命令没有启动。',
        );
      }

      let result;
      try {
        result = await this.runner.run({
          ...input,
          command: runCommand,
          workspacePath: mirrorPath,
          expectedWorkspaceIdentity: mirrorIdentity.identity,
          filesystemMode: 'read-write',
          additionalAccess: additionalAccess.slice(0, 4),
          authorizeAdditionalAccess,
        });
      } catch (error) {
        const status =
          error?.effectStatus === 'unknown' ? 'unknown' : 'not_applied';
        if (mirrorCreated && status === 'not_applied') {
          await this.#transition(batch, 'not_applied', error?.code ?? null);
          terminal = true;
        } else if (mirrorCreated) {
          await this.#transition(batch, 'unknown', error?.code ?? null);
          terminal = true;
        }
        throw error;
      }
      if (result?.timedOut || result?.effectStatus === 'unknown') {
        await this.#transition(batch, 'unknown', 'command_outcome_unknown');
        terminal = true;
        const current = this.store.getSocialWorkCommandBatch(taskId, batch.id);
        return {
          ...result,
          commandBatchId: batch.id,
          commandBatchStatus: current?.status ?? 'unknown',
        };
      }
      await this.#transition(batch, 'collecting');
      phase = 'collecting';

      const collected = await collectCommandMirrorChanges({
        sourcePath,
        mirrorPath,
        baseManifestBytes: prepared.manifestBytes,
        expectedIdentity: expectedWorkspaceIdentity,
        signal,
        boundaryScanner: this.boundaryScanner,
      });
      if (collected.changes.some((change) => change.concurrent)) {
        throw runnerError(
          'workspace_command_source_concurrent_change',
          '项目工作区在命令运行期间发生变化；没有覆盖任何路径。',
          'conflict',
        );
      }
      if (collected.changes.length > MAX_COMMAND_CHANGE_PATHS) {
        throw runnerError(
          'workspace_command_change_limit',
          '项目命令变更路径超过恢复记录上限；没有写入工作区。',
          'conflict',
        );
      }
      const currentManifest = await readCommandMirrorManifest(mirrorPath, {
        signal,
      });
      const finalManifestBytes = Buffer.from(
        JSON.stringify(currentManifest),
        'utf8',
      );
      await this.store.putSocialWorkCommandManifest({
        taskId,
        batchId: batch.id,
        kind: 'final',
        bytes: finalManifestBytes,
      });
      const preparedChanges = this.store.prepareSocialWorkCommandChanges({
        taskId,
        batchId: batch.id,
        stepId,
        changes: collected.changes,
      });
      await this.#transition(batch, 'syncing');
      phase = 'syncing';
      const writebackChanges = preparedChanges.map((change) => {
        const collectedChange = collected.changes.find(
          (item) => item.relativePath === change.relativePath,
        );
        return {
          ...change,
          beforeBytes: collectedChange?.beforeBytes ?? null,
          afterBytes: collectedChange?.afterBytes ?? null,
          beforeExists: collectedChange?.beforeExists ?? false,
          afterExists: collectedChange?.afterExists ?? false,
          relativePath: normalizeCommandRelativePath(change.relativePath),
        };
      });
      const applied = await this.#applyChanges({
        taskId,
        stepId,
        sourcePath,
        expectedIdentity: expectedWorkspaceIdentity,
        changes: writebackChanges,
        removedDirectories: collected.removedDirectories ?? [],
      });
      if (applied.unknown > 0) {
        await this.#transition(batch, 'unknown', 'writeback_unknown');
        terminal = true;
      } else if (applied.conflicts > 0 && applied.applied > 0) {
        await this.#transition(batch, 'partial', 'writeback_partial');
        terminal = true;
      } else if (applied.conflicts > 0) {
        await this.#transition(batch, 'conflict', 'writeback_conflict');
        terminal = true;
      } else {
        await this.#transition(batch, 'completed');
        terminal = true;
      }
      const summary = [
        '',
        `[Noema 命令副本] 项目工作区：${sourcePath}`,
        `[Noema 命令副本] ${applied.applied} 个路径已回写，` +
          `${applied.conflicts} 个冲突，${applied.unknown} 个未知。`,
      ].join('\n');
      const current = this.store.getSocialWorkCommandBatch(taskId, batch.id);
      return {
        ...result,
        output: `${result?.output ?? ''}${summary}`,
        commandBatchId: batch.id,
        commandBatchStatus: current?.status ?? 'unknown',
      };
    } catch (error) {
      if (!terminal && (mirrorCreated || phase === 'preparing')) {
        const status =
          error?.effectStatus === 'conflict'
            ? 'conflict'
            : error?.effectStatus === 'unknown'
              ? 'unknown'
              : phase === 'preparing' || phase === 'running'
                ? 'not_applied'
                : 'unknown';
        try {
          await this.#transition(batch, status, error?.code ?? null);
          terminal = true;
        } catch {
          // Preserve the mirror; startup recovery owns the remaining state.
        }
      }
      throw error;
    } finally {
      if (terminal) {
        const current = this.store.getSocialWorkCommandBatch(taskId, batch.id);
        if (current && ['completed', 'not_applied'].includes(current.status)) {
          await this.#removeMirror(mirrorPath);
        }
      }
    }
  }
}
