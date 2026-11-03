# Proposal

## Why

Windows 命令隔离已切换到 Noema 原生 runner，但安装包和界面仍保留旧 SRT 安装流程，运行能力也缺少统一、可信的用户可见状态。现在需要把资源、主进程授权、用户提示和执行入口收束为同一条可审计路径，避免用户看到可用承诺后却在执行时失败或降级运行。

## What Changes

- 由主进程提供 Windows runner 支持状态、拒绝原因、资源版本和首次设置状态；renderer 只呈现此报告，不自行判断文件或平台能力。
- 提供用户主动触发的首次隔离设置；启动时只读取状态，不自动触发 UAC。用户取消或设置验证失败时，命令保持不可用。
- 将实际使用的单一 Windows runner 及其协议/版本纳入 Forge 安装资源；缺失或不匹配时明确不可用，不调用 SRT 或宿主 shell。
- 移除旧 SRT helper 安装提示与承诺，并把资源探测、状态变化、设置结果和界面展示接入本机诊断时间线。
- 在探测结果变化时阻止新的 Windows 命令，并向用户呈现更新后的原因；已启动命令按现有 runner 生命周期收束。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`: 增加 Windows runner 的可信能力报告、用户主动设置、打包资源一致性、状态变化和失败关闭行为。

## Impact

影响 Electron 主进程、root IPC/preload 契约、工作区授权与运行诊断界面、Forge Windows 打包资源，以及 Windows runner readiness 和执行门禁。无需新增运行时依赖；macOS/Linux 现有执行路径不变。
