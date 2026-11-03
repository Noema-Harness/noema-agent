# Proposal

## Why

Noema 的项目命令授权目前按工作区、额外路径和网络审批收集，但 Windows runner 尚无逐项把这些授权翻译为 OS-enforced policy 的明确契约。进入 Windows runner 实现前，需要先规定精确映射与拒绝边界，避免把 UI 授权误当成隔离，或在 backend 无法表达权限时继续启动命令。

## What Changes

- 为 Windows 项目命令定义结构化的 grant-to-policy 映射：工作区、获准的外部路径、运行时读取范围、网络模式及工作目录各自具有明确边界。
- backend 必须声明实际支持的策略能力；有任何授权无法完整表达、对象身份无法确认或必需隔离能力缺失时，在创建子进程前返回可诊断拒绝。
- 保持 Windows 项目命令当前关闭；本变更只建立映射逻辑和拒绝契约，不代表 runner、系统隔离或打包已经可用。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`：规定 Windows 项目命令的授权映射、能力检查、默认拒绝及 spawn 前失败行为。

## Impact

- 影响 `apps/desktop/src/main/execution` 中项目命令授权/隔离策略与对应测试。
- 后续 Codex-source-derived Windows runner bridge 将消费映射结果；本变更不接入新 backend 或启用 Windows 命令。
- 不增加运行时依赖，不改变 Linux/macOS 当前执行行为。
