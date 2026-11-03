const REASON_LABELS = Object.freeze({
  runner_startup_not_checked: '应用仍在检查命令隔离能力。',
  runner_resource_missing: '安装包中没有找到 Windows 命令隔离组件。',
  runner_resource_untrusted: 'Windows 命令隔离组件未通过资源检查。',
  runner_resource_architecture_unsupported: '当前 Windows 架构暂不支持。',
  runner_implementation_incomplete:
    'Windows 命令隔离尚未完成目标机验证，命令暂未开放。无需更新 Windows 即可启动和使用 Noema。',
  sandbox_setup_unavailable: '本机隔离设置尚未完成或未通过检查。',
  sandbox_setup_missing: '需要先完成本机隔离设置。',
  setup_state_unavailable: '本机隔离设置状态暂不可读取。',
  setup_failed: '本机隔离设置未完成。',
  network_filters_unverified: '本机网络隔离规则尚未完成检查。',
  setup_state_live_verification_incomplete: '隔离设置未通过实时状态核验。',
  os_baseline_unsupported:
    '当前 Windows 安全更新未达到受限命令的安全基线；Noema 桌面应用仍可使用。',
  runner_runtime_unavailable: 'Windows 命令隔离运行组件暂不可用。',
  diagnostics_unavailable: 'Noema 诊断记录不可用，命令保持关闭。',
});

export function windowsRunnerReasonLabel(reasonCode) {
  const reasonCodes = Array.isArray(reasonCode) ? reasonCode : [reasonCode];
  return reasonCodes
    .filter((code) => typeof code === 'string' && code)
    .map((code) => REASON_LABELS[code] ?? `命令不可用（${code}）。`)
    .join(' ');
}

export function canOfferWindowsRunnerSetup(capability) {
  return capability?.setupActionAvailable === true;
}
