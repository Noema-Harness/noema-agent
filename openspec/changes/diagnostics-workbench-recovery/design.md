# Design

## Context

现有诊断查询与导出由主进程提供，renderer 负责显示最近执行、单条时间线、用量和隐私预览。相关基础行为见 `openspec/specs/project-execution/spec.md`；本 change 只补齐 renderer 的读取失败恢复与时间线展示筛选。

## Goals / Non-Goals

**Goals:**

- 以本地 React 状态表达“尚未成功读取”“读取失败”“陈旧数据”和“真实空数据”。
- 只在时间线显示层过滤事件；导出仍以选中执行 ID 查询完整数据。
- 使用隔离 Electron renderer 探针核对失败恢复、筛选数量、420px 布局和截图。

**Non-Goals:**

- 不修改诊断存储、查询/导出 IPC、权限、保留策略或事件 schema。
- 不加入服务端过滤、持久化筛选或新的依赖。

## Decisions

- 列表与时间线分别维护读取失败和重试状态，避免用全局错误文本吞掉各自的恢复入口。
- 时间线筛选直接从当前已加载事件派生；导出调用只传选中执行身份与上下文选择，不传筛选条件。
- 隔离 E2E 在临时数据库中写入少量固定诊断事件，并在 renderer 探针里对本次查询注入一次性失败，再点击产品的真实重试按钮。
- 保留已有 Blueprint `NoemaSelect` 控件与现有诊断面板，不引入新组件库或重做页面结构。

## Risks / Trade-offs

- [诊断条目很少时无法体现筛选密度] → 隔离 fixture 提供多个模块及状态的事件，不改用户数据库。
- [窄窗筛选控件占用时间线高度] → 以 420px 窗口截图和溢出断言核对，筛选项在窄窗纵向排列。
- [renderer 探针注入行为与真实 IPC 不同] → 注入仅让首个调用返回拒绝，恢复调用仍通过现有 bridge 和原 main handler。

## Migration Plan

无需数据迁移或回滚步骤；如行为实现需要回滚，可单独撤回 renderer 状态、fixture 和此规格增量。

## Open Questions

无。
