import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

function option(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function tableExists(db, table) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function tableColumns(db, table) {
  return new Set(db.pragma(`table_info(${table})`).map(({ name }) => name));
}

function selectByIds(db, table, idColumn, ids) {
  if (!ids.length || !tableExists(db, table)) return [];
  const columns = tableColumns(db, table);
  if (!columns.has(idColumn)) return [];
  const marks = ids.map(() => '?').join(', ');
  return db
    .prepare(`SELECT * FROM ${table} WHERE ${idColumn} IN (${marks})`)
    .all(ids);
}

function selectRelatedMessages(db, table, idColumn, ids, since, includeRecent) {
  if (!tableExists(db, table)) return [];
  const columns = tableColumns(db, table);
  if (!columns.has(idColumn) || !columns.has('created_at')) return [];
  const conditions = [];
  const values = [];
  if (includeRecent) {
    conditions.push('created_at >= ?');
    values.push(since);
  }
  if (ids.length) {
    conditions.push(`${idColumn} IN (${ids.map(() => '?').join(', ')})`);
    values.push(...ids);
  }
  if (!conditions.length) return [];
  return db
    .prepare(
      `SELECT * FROM ${table} WHERE ${conditions.join(' OR ')} ORDER BY created_at`,
    )
    .all(values);
}

function usageRows(db, since, interactionId) {
  if (!tableExists(db, 'model_usage_records')) return [];
  const columns = tableColumns(db, 'model_usage_records');
  const rows =
    interactionId && columns.has('interaction_id')
      ? db
          .prepare(
            'SELECT * FROM model_usage_records WHERE interaction_id = ? ORDER BY created_at',
          )
          .all(interactionId)
      : db
          .prepare(
            'SELECT * FROM model_usage_records WHERE created_at >= ? ORDER BY created_at',
          )
          .all(since);
  return rows.map((row) => {
    let providerCost = null;
    try {
      providerCost = JSON.parse(row.provider_cost_json ?? 'null');
    } catch {
      /* keep malformed provider metadata unavailable */
    }
    delete row.provider_cost_json;
    return { ...row, provider_cost: providerCost };
  });
}

const databasePath =
  option('database') ??
  path.join(
    process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
    'Noema',
    'noema.sqlite3',
  );
const interactionId = option('interaction');
const hours = Number(option('hours') ?? 24);
if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 90) {
  throw new Error('--hours 必须在 0 到 2160 之间。');
}
if (!fs.existsSync(databasePath)) {
  throw new Error(`找不到 Noema 数据库：${databasePath}`);
}

const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
const db = new Database(databasePath, {
  readonly: true,
  fileMustExist: true,
  timeout: 5000,
});
try {
  const modelUsage = usageRows(db, since, interactionId);
  const ids = [
    ...new Set(modelUsage.map((row) => row.interaction_id).filter(Boolean)),
  ];
  const externalUsage = tableExists(db, 'external_usage_records')
    ? interactionId
      ? db
          .prepare(
            'SELECT * FROM external_usage_records WHERE interaction_id = ? ORDER BY created_at',
          )
          .all(interactionId)
      : db
          .prepare(
            'SELECT * FROM external_usage_records WHERE created_at >= ? ORDER BY created_at',
          )
          .all(since)
    : [];
  const rootTurnIds = [
    ...new Set(
      [...ids, ...modelUsage.map((row) => row.interaction_id)].filter(Boolean),
    ),
  ];
  const rootTurns = selectByIds(db, 'root_turns', 'id', rootTurnIds);
  const rootMessages = selectRelatedMessages(
    db,
    'root_messages',
    'turn_id',
    rootTurns.map((row) => row.id),
    since,
    !interactionId,
  );
  const socialMessages = selectRelatedMessages(
    db,
    'social_messages',
    'id',
    ids,
    since,
    !interactionId,
  );
  const socialTurnIds = [
    ...new Set(socialMessages.map((row) => row.turn_id).filter(Boolean)),
  ];
  const relatedSocialMessages = socialTurnIds.length
    ? selectRelatedMessages(
        db,
        'social_messages',
        'turn_id',
        socialTurnIds,
        since,
        false,
      )
    : socialMessages;
  let socialTasks = selectByIds(db, 'social_work_tasks', 'id', ids);
  if (ids.length && tableExists(db, 'social_work_tasks')) {
    const columns = tableColumns(db, 'social_work_tasks');
    if (columns.has('source_message_id')) {
      socialTasks = [
        ...socialTasks,
        ...db
          .prepare(
            `SELECT * FROM social_work_tasks WHERE source_message_id IN (${ids.map(() => '?').join(', ')})`,
          )
          .all(ids),
      ];
      socialTasks = [
        ...new Map(socialTasks.map((task) => [task.id, task])).values(),
      ];
    }
  }
  const backgroundTasks = selectByIds(db, 'background_tasks', 'id', ids);
  const taskIds = [
    ...new Set([
      ...socialTasks.map((row) => row.id),
      ...backgroundTasks.map((row) => row.id),
    ]),
  ];
  const executionSteps = tableExists(db, 'social_work_execution_steps')
    ? selectByIds(db, 'social_work_execution_steps', 'task_id', taskIds)
    : [];
  const report = {
    generatedAt: new Date().toISOString(),
    databasePath,
    filter: interactionId ? { interactionId } : { since, hours },
    traceScope:
      '已持久化的交互消息、模型/外部用量与后台工作记录；不导出凭据，也不抓取未持久化的原始 HTTP 报文。',
    privacyNotice:
      '此本机文件可能包含个人对话、任务 prompt/result、错误和工作区路径；不会自动上传，请按敏感资料保管。文件不包含模型凭据。',
    counts: {
      modelRequests: modelUsage.length,
      externalUsageRecords: externalUsage.length,
      rootTurns: rootTurns.length,
      rootMessages: rootMessages.length,
      socialMessages: relatedSocialMessages.length,
      socialWorkTasks: socialTasks.length,
      backgroundTasks: backgroundTasks.length,
      executionSteps: executionSteps.length,
    },
    modelUsage,
    externalUsage,
    rootTurns,
    rootMessages,
    socialMessages: relatedSocialMessages,
    socialWorkTasks: socialTasks,
    backgroundTasks,
    executionSteps,
  };
  const outputPath =
    option('output') ??
    path.resolve(
      process.cwd(),
      '../../.work/runs',
      `model-diagnostics-${new Date().toISOString().replaceAll(':', '-')}.json`,
    );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  process.stderr.write(`${report.privacyNotice}\n`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `${JSON.stringify({ outputPath, counts: report.counts }, null, 2)}\n`,
  );
} finally {
  db.close();
}
