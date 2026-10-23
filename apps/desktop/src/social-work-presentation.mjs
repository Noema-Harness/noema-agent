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
    verification_failed: '文件验收未通过',
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
