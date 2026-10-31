import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { redactSensitiveText } from '../../shared/text/sensitive-text.mjs';

const id = z.string().trim().min(1).max(200);
export const evidenceSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), messageId: id }).strict(),
  z
    .object({ kind: z.literal('execution'), taskId: id, stepId: id.optional() })
    .strict(),
  z
    .object({
      kind: z.literal('file'),
      taskId: id,
      path: z.string().min(1).max(2000),
    })
    .strict(),
]);
export const evidenceRefsSchema = z
  .array(
    z.object({
      source: evidenceSourceSchema,
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
      observedAt: z.string(),
      label: z.string(),
      sourceAuthorId: z.string().nullable(),
      sourceStatus: z.string(),
    }),
  )
  .max(10);
const { $schema: _schema, ...sourceParameters } = z.toJSONSchema(
  z.array(evidenceSourceSchema).max(10),
);
export const evidenceSourcesParameters = sourceParameters;
const digest = (value) => createHash('sha256').update(value).digest('hex');

/** References point into existing product records; this class owns no database. */
export class ProjectPlanEvidence {
  constructor(db) {
    this.db = db;
  }

  read(projectId, raw) {
    const source = evidenceSourceSchema.parse(raw);
    if (source.kind === 'message') {
      const message = this.db
        .prepare(`SELECT m.id, m.content, m.status, m.agent_id, m.role
        FROM social_messages m JOIN social_projects p ON p.group_room_id=m.room_id
        WHERE p.id=? AND m.id=? AND m.role IN ('user','assistant')`)
        .get(projectId, source.messageId);
      if (!message) throw Error('来源不是本项目的公开群消息，或已不存在。');
      if (message.status === 'streaming')
        throw Error('来源消息仍在生成，不能固定为成果依据。');
      return {
        source,
        label: `群消息 · ${redactSensitiveText(message.content).snippet.replace(/\s+/gu, ' ').slice(0, 60) || message.id}`,
        sourceAuthorId: message.agent_id,
        sourceStatus: message.status,
        fingerprint: digest(JSON.stringify(message)),
        excerpt: redactSensitiveText(message.content).snippet.slice(0, 4000),
        excerptTruncated: message.content.length > 4000,
      };
    }
    const task = this.db
      .prepare(`SELECT t.id,t.agent_id,t.workspace_path,t.task_prompt,t.status,t.result_text,
        t.error_code,t.error_message,t.verification_status,t.verification_results_json
      FROM social_work_tasks t JOIN social_project_sessions s ON s.room_id=t.room_id
      WHERE s.project_id=? AND t.id=?`)
      .get(projectId, source.taskId);
    if (!task) throw Error('来源不是本项目的执行任务，或已不存在。');
    if (['starting', 'running', 'verifying'].includes(task.status))
      throw Error('来源任务尚未结束，不能固定为成果依据。');
    if (source.kind === 'execution') {
      const { workspace_path: _workspace, ...record } = task;
      const steps = this.db
        .prepare(
          'SELECT id,tool_name,category,status,effect_status,arguments_json,result_json FROM social_work_execution_steps WHERE task_id=? ORDER BY ordinal',
        )
        .all(task.id);
      const step = source.stepId
        ? steps.find((entry) => entry.id === source.stepId)
        : null;
      if (source.stepId && !step)
        throw Error('该执行步骤不属于此任务，或已不存在。');
      const contents = step
        ? step.result_json || ''
        : task.result_text || task.error_message || '';
      return {
        source,
        label: step
          ? `执行步骤 · ${step.tool_name}`
          : `执行记录 · ${redactSensitiveText(task.task_prompt).snippet.replace(/\s+/gu, ' ').slice(0, 60)}`,
        sourceAuthorId: task.agent_id,
        sourceStatus: step?.status ?? task.status,
        fingerprint: digest(JSON.stringify(step ?? record)),
        excerpt: redactSensitiveText(contents).snippet.slice(0, 4000),
        excerptTruncated: contents.length > 4000,
        ...(step
          ? {}
          : {
              executionSteps: steps.slice(0, 24).map((entry) => {
                let filePath = null;
                try {
                  const args = JSON.parse(entry.arguments_json);
                  filePath =
                    typeof args?.path === 'string'
                      ? args.path.slice(0, 500)
                      : null;
                } catch {}
                return {
                  stepId: entry.id,
                  tool: entry.tool_name,
                  status: entry.status,
                  category: entry.category,
                  path: filePath,
                  hasOutput: entry.result_json !== null,
                };
              }),
              omittedSteps: Math.max(0, steps.length - 24),
            }),
      };
    }
    // A file reference cannot grant a new directory: it inherits a real task's workspace.
    if (path.isAbsolute(source.path) || source.path.includes('\0'))
      throw Error('文件依据须使用任务工作区内的相对路径。');
    const root = fs.realpathSync(task.workspace_path);
    const filename = fs.realpathSync(path.resolve(root, source.path));
    const relative = path.relative(root, filename);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw Error('文件依据超出任务工作区。');
    const fd = fs.openSync(filename, 'r');
    try {
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.size > 16 * 1024 * 1024)
        throw Error('文件依据须为不超过 16 MiB 的普通文件。');
      const buffer = Buffer.alloc(before.size + 1);
      let size = 0;
      while (size < buffer.length) {
        const read = fs.readSync(fd, buffer, size, buffer.length - size, null);
        if (!read) break;
        size += read;
      }
      const bytes = buffer.subarray(0, size);
      const after = fs.fstatSync(fd);
      if (
        bytes.length !== before.size ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        fs.realpathSync(filename) !== filename
      )
        throw Error('读取期间文件发生变化，请重新提交依据。');
      return {
        source: { ...source, path: relative },
        label: relative,
        sourceAuthorId: task.agent_id,
        sourceStatus: 'captured',
        fingerprint: digest(bytes),
      };
    } finally {
      fs.closeSync(fd);
    }
  }

  capture(projectId, sources) {
    const parsed = z.array(evidenceSourceSchema).max(10).parse(sources);
    const captured = parsed.map((source) => {
      const { excerpt: _excerpt, ...record } = this.read(projectId, source);
      return { ...record, observedAt: new Date().toISOString() };
    });
    if (
      new Set(captured.map((entry) => JSON.stringify(entry.source))).size !==
      captured.length
    )
      throw Error('同一成果来源不能重复引用。');
    return evidenceRefsSchema.parse(captured);
  }

  readSources(projectId, sources) {
    if (!Array.isArray(sources) || !sources.length)
      throw Error(
        'read_sources 必须提供 evidence_sources 数组，例如 [{"kind":"execution","taskId":"实际任务ID"}]。',
      );
    return z
      .array(evidenceSourceSchema)
      .min(1)
      .max(10)
      .parse(sources)
      .map((source) => this.read(projectId, source));
  }

  inspect(projectId, refs) {
    return evidenceRefsSchema.parse(refs).map((entry) => {
      try {
        const current = this.read(projectId, entry.source);
        return {
          ...entry,
          state:
            current.fingerprint === entry.fingerprint ? 'unchanged' : 'changed',
          currentFingerprint: current.fingerprint,
          currentStatus: current.sourceStatus,
          excerpt: current.excerpt ?? null,
          excerptTruncated: current.excerptTruncated ?? false,
        };
      } catch (error) {
        return { ...entry, state: 'unavailable', error: error.message };
      }
    });
  }
}
