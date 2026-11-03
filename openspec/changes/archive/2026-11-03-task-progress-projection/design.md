# Design

## Context

E2 已让每个 SocialWork task/task step 持久化，并通过 main-process `project-work-updated` 事件通知 renderer。renderer 目前收到事件后重读房间状态，`loadRoom` 的递增序号会拒绝较早请求晚返回的快照。NoemaProjectExecutor 的进度事件目前只报告笼统 `working`、工具调用和结果；main-process 授权对话框没有对应的任务阶段，所以运行中 task card 只能显示笼统状态。

源码对照：本地 OpenHands Agent Server 研究记录 `AGENT_SERVER_HOST_PROTOCOL.md` 显示 durable event log 与 transient streaming progress 分层，最终状态在先前事件发布完后再发；DeepSeek Harness `AGENT_LOOP_MODEL_REQUEST.md` 将 AgentLoop/工具请求建模为具名生命周期事件。Noema 采用与自身桌面结构相称的轻量部分：持久 task snapshot 是状态事实，phase event 负责更新事实；不引入通用事件日志或 WebSocket sequence 协议。

## Goals / Non-Goals

**Goals:**

- 明确有限的执行阶段：请求模型、接收模型可见响应、模型请求工具、工具准备/执行、等待用户授权、限流等待、核验。
- 状态显示与当前工具类别和 task terminal status 对齐。
- renderer reload、刷新请求乱序和未知旧 phase 时仍显示最新的持久事实或中性状态。
- 授权等待只记录授权类别，不持久化 command/path/host/detail，也不把授权决定变成自动批准。

**Non-Goals:**

- 不展示或存储隐藏推理、完整模型流、命令内容、额外路径、host、凭据或工具参数。
- 不更改 SocialWork 状态机、checkpoint/resume 门槛、工具授权决策和 command capability。
- 不引入 second event store、通用事件序号协议或新的并发任务能力。

## Decisions

1. **扩展既有持久 phase 字段。** 任务阶段由 SocialChatStore 更新，展示读取该任务与当前 running step 的快照。这样 renderer 的进度 event 仅要求重新读取，不维护竞争的本地真相。未知或历史 phase 在呈现层中性回退。
2. **执行器在确定的生命周期点发送 phase。** 发请求前写 model-request；收到首个文本 delta 后只改为 model-response；收到工具调用回调后写 tool-requested；开始工具 step 后保留 tool-call 并从 running step 识别类别。空响应不会伪装为已经接收文本。
3. **将授权等待包裹在执行事件边界内。** 路径与网络授权器被调用之前记录 awaiting-authorization，返回后回到 executing-tool；event/details 只包含有限 phase，不传递 dialog 私密内容或决策依据。用户拒绝仍按真实工具结果/任务结果呈现。
4. **不重写安全 task/step status。** completed/failed/interrupted 与 outcome_unknown 继续来自现有 durable task/step 记录；presentation 优先读取它们，不能由 phase 升级成功结论。
5. **限制进度推送的生命周期。** main process 只在持久化完成后 publish snapshot；renderer 按现有 request sequence 只采纳最新房间快照。status 事件不承载可覆盖任务数据的临时 task object。

## Risks / Trade-offs

- [较慢的 model stream 会长期显示等待模型] → 明确该阶段代表 Noema 正等上游，不声称模型在做何种内部推理。
- [旧 task.phase 未知或历史命名不同] → 显示中性状态，不基于旧 phase 推断授权/工具状态。
- [授权窗口与 task card 更新存在 UI 刷新时延] → 在调用实际对话框前同步持久化 phase，并在结果后重新发布持久快照；若状态写入失败，授权流程应拒绝继续。
- [服务端某些中断未经过 task phase event] → terminal status/step remains authoritative and overrides live phase.

## Migration Plan

无需 schema migration。保留旧 phase 字符串，renderer 使用有限映射与 neutral fallback。回滚代码时任务记录仍可由现有文本字段读取。

## Open Questions

无。用户最终验收仍以窗口中的真实任务阶段为准。
