const STATUS_LABELS = {
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
  running: '执行中',
  verifying: '核验中',
  starting: '启动中',
};

function safeLine(value, limit = 120) {
  return String(value ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, limit);
}

function safeFileName(value) {
  return (
    String(value ?? '')
      .replace(/[\\/:*?"<>|]/gu, '-')
      .replace(/\s+/gu, ' ')
      .replace(/[. -]+$/u, '')
      .trim()
      .slice(0, 60) || '工单'
  );
}

export function workTicketExportFileName(task, date = new Date()) {
  const title = safeLine(task?.taskPrompt, 60) ?? '工单';
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  return `Noema-工单-${safeFileName(title)}-${day}.md`;
}

function stepLine(step) {
  const parts = [
    String(step.ordinal ?? '').trim(),
    String(step.toolName ?? step.category ?? 'step').trim(),
    String(step.status ?? '').trim(),
  ].filter(Boolean);
  return `- ${parts.join(' · ')}`;
}

/**
 * @param {{task: any, usage?: {requests?: number, inputTokens?: number|null, outputTokens?: number|null}|null, exportedAt?: Date}} input
 */
export function formatWorkTicketMarkdown({
  task,
  usage = null,
  exportedAt = new Date(),
}) {
  const title = safeLine(task?.taskPrompt) ?? '未命名工单';
  const lines = [
    `# ${title}`,
    '',
    `导出时间：${exportedAt.toISOString()}`,
    `状态：${STATUS_LABELS[task?.status] ?? task?.status ?? '未知'}`,
    `执行引擎：${task?.executionEngine === 'dsh' ? 'DSH' : 'Noema'}`,
  ];
  if (task?.runtimeSessionId) lines.push(`会话：${task.runtimeSessionId}`);
  if (task?.workspacePath) lines.push(`工作区：${task.workspacePath}`);
  if (task?.model) lines.push(`模型：${task.model}`);
  lines.push('', '## 原始任务', '', task?.taskPrompt ?? '');
  if (task?.resultText) lines.push('', '## 执行结果', '', task.resultText);
  if (task?.errorMessage) {
    lines.push(
      '',
      '## 错误',
      '',
      `${task.errorCode ?? 'error'}：${task.errorMessage}`,
    );
  }
  const steps = Array.isArray(task?.steps) ? task.steps : [];
  if (steps.length) {
    lines.push('', '## 执行步骤', '');
    for (const step of steps) lines.push(stepLine(step));
  }
  if (usage?.requests) {
    lines.push(
      '',
      '## 模型用量',
      '',
      `${usage.requests} 次请求 · 输入 ${usage.inputTokens ?? '未知'} · 输出 ${usage.outputTokens ?? '未知'}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
