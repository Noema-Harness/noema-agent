/** Resolve the one Windows command gate from trusted main-process evidence. */
/** @param {{backendReadiness?: any, setupReadiness?: any, diagnosticsReady?: boolean, unavailableCode?: string}} options */
export function resolveWindowsRunnerCommandSupport({
  backendReadiness,
  setupReadiness,
  diagnosticsReady,
  unavailableCode,
}) {
  if (typeof unavailableCode === 'string' && unavailableCode) {
    return {
      supported: false,
      reason: 'Windows 命令沙箱资源或就绪检查不可用；命令未启动。',
    };
  }
  if (diagnosticsReady === false) {
    return {
      supported: false,
      reason: 'Noema 诊断记录不可用；为保留执行链路，命令未启动。',
    };
  }
  if (backendReadiness?.ready !== true) {
    return {
      supported: false,
      reason:
        backendReadiness?.code ??
        setupReadiness?.reason ??
        'Windows 命令沙箱未就绪；命令未启动。',
    };
  }
  if (setupReadiness?.ready !== true) {
    return {
      supported: false,
      reason:
        setupReadiness?.reason ?? 'Windows 命令沙箱尚未配置；命令未启动。',
    };
  }
  return { supported: true };
}
