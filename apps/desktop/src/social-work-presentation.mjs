/**
 * @param {{status:string,errorCode:string|null,verificationStatus:string}} task
 */
export function socialWorkCardTitle(task) {
  if (task.status === 'starting') return '正在启动项目工作';
  if (task.status === 'running') return '工程搭档正在处理';
  if (task.status === 'verifying') return '正在核对交付文件';
  if (task.status === 'completed') {
    return task.verificationStatus === 'verified'
      ? '项目工作已完成并核验'
      : '项目工作已结束 · 未独立核验';
  }

  const failureTitles = {
    app_restarted: '应用重启后已停止',
    dsh_rate_limited: '模型请求被限流',
    dsh_task_timeout: '执行超时',
    dsh_tool_loop: '重复操作过多，已停止',
    tool_round_limit: '工具步骤达到上限',
    verification_failed: '文件验收未通过',
    provider_unavailable: '模型没有返回结果',
    dsh_process_failed: '执行进程异常退出',
    dsh_process_error: '执行进程异常退出',
    dsh_start_failed: '执行进程异常退出',
    dsh_not_found: '本机执行环境不可用',
    dsh_node_unavailable: '本机执行环境不可用',
  };
  return (
    failureTitles[task.errorCode] ??
    (task.status === 'interrupted' ? '项目工作已停止' : '项目工作未完成')
  );
}

export function socialWorkRecoveryPresentation(task) {
  const steps = Array.isArray(task.executionSteps) ? task.executionSteps : [];
  const toolCallCount = Number.isSafeInteger(task.toolCallCount)
    ? task.toolCallCount
    : 0;
  const categories = Array.isArray(task.toolActionCategories)
    ? task.toolActionCategories
    : [];

  if (steps.length === 0) {
    if (toolCallCount === 0) {
      return {
        kind: 'clear',
        message: '执行记录显示尚未调用工具；可以直接再次编辑并执行。',
      };
    }
    if (
      categories.length >= toolCallCount &&
      categories.every((category) => ['read', 'search'].includes(category))
    ) {
      return {
        kind: 'clear',
        message:
          '历史记录只包含读取或搜索，没有记录写入或命令；可以直接再次编辑并执行。',
      };
    }
    return {
      kind: 'unknown',
      message:
        '这条任务缺少完整的逐步操作记录；请先检查工作区，再决定是否重新执行。',
    };
  }

  const sideEffectSteps = steps.filter(
    (step) =>
      step.hasSideEffect === true ||
      ['write', 'edit', 'command'].includes(step.category),
  );
  if (
    !Number.isSafeInteger(task.toolCallCount) ||
    toolCallCount !== steps.length
  ) {
    return {
      kind: 'unknown',
      message:
        '执行记录不完整，无法确认所有操作是否影响了工作区；请先检查工作区，再决定是否重新执行。',
    };
  }

  const unclassifiedSteps = steps.filter(
    (step) =>
      !['read', 'search', 'write', 'edit', 'command'].includes(step.category) &&
      step.hasSideEffect !== false,
  );
  if (unclassifiedSteps.length) {
    return {
      kind: 'unknown',
      message:
        '执行记录包含无法识别的操作类型；请先检查工作区，再决定是否重新执行。',
    };
  }

  if (
    sideEffectSteps.some(
      (step) => !['applied', 'not_applied'].includes(step.effectStatus),
    )
  ) {
    return {
      kind: 'unknown',
      message:
        '有写入或命令的结果不确定；请先检查工作区和执行记录，再决定是否重新执行。',
    };
  }

  if (sideEffectSteps.some((step) => step.effectStatus === 'applied')) {
    return {
      kind: 'changed',
      message:
        '执行记录显示写入或命令已返回成功，但不代表验收通过；请先检查工作区，再决定是否重新执行。',
    };
  }

  return {
    kind: 'clear',
    message: '执行记录没有显示已生效的写入或命令；可以直接再次编辑并执行。',
  };
}

export function socialWorkExecutionStepPresentation(step) {
  const categoryLabels = {
    read: '读取',
    search: '搜索',
    write: '写入',
    edit: '编辑',
    command: '命令',
    other: '其他操作',
  };
  const statusLabels = {
    running: '进行中',
    succeeded: '已返回结果',
    failed: '工具执行失败',
    outcome_unknown: '执行结果不确定',
    interrupted: '已中断',
  };
  let effectLabel = '';
  if (step.effectStatus === 'pending' || step.effectStatus === 'unknown') {
    effectLabel =
      step.category === 'command'
        ? '命令可能已改动项目；继续前先检查工作区'
        : '操作结果不确定；继续前先检查已有文件改动';
  } else if (step.effectStatus === 'applied') {
    effectLabel = '写入工具已返回成功；文件仍需核验';
  } else if (step.effectStatus === 'not_applied') {
    effectLabel = '工具调用未执行该次写入';
  }
  return {
    categoryLabel: categoryLabels[step.category] ?? '其他操作',
    statusLabel: statusLabels[step.status] ?? '状态未知',
    effectLabel,
  };
}
