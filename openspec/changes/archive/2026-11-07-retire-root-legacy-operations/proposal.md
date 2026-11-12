# Proposal

## Why

Root/Legacy 的活动对话、DSH 派发/续跑、Quick Capture、Codex 导入和 Root 偏好操作与冻结的一期边界冲突。直接隐藏页面会留下可调用的 IPC、快捷键和恢复入口，直接删除存储又会破坏历史连续性。

## What Changes

- **BREAKING** 关闭 Root/Legacy 专属活动操作、执行恢复、旧导入授权和 Quick Capture 写入/快捷键；不将这些能力迁入 Social。
- 用独立只读历史查询与本地导出保留 Root turns/messages、DSH tasks/events、captures、context imports 和 interaction adjustments；导出明确标注 legacy 来源，不作为活动上下文。
- 使旧授权不再具有发送或执行效果，停用 Root/DSH 启动及恢复路径；历史数据保持原库，不自动转换或删除。
- 保留仍由 Social 调用的共享 provider/model 配置和模型事件；后续如需搬移 owner，单独按对应工作包处理。

## Capabilities

### New Capabilities
- `legacy-history-archive`: 提供旧 Root/Legacy 数据的可信只读查询与用户显式本地导出。

### Modified Capabilities
- `project-execution`: Root turn/DSH 活动诊断事件与旧 imported-context consent 不再作为活动契约；保留仍在使用中的 SocialWork、授权和恢复事件要求。

## Impact

- Affected code: RootAgent、RootStore、Root IPC/preload bridge、Quick Capture shortcut/listener、renderer `#legacy` route 与启动恢复。
- Affected data: 现有 Root/Legacy 记录继续留在本地数据库；新增只读查询/导出路径，不在退役过程中迁移或删除记录。
- Affected specs: new `legacy-history-archive`, modified `project-execution`.
- Social 继续依赖的 provider/model 设置与 `onRootEvent` 共享通道必须保持可用，直到各自 owner 被独立替换；不得以 Root 名称推断为可一并删除。
