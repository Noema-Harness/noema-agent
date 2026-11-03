# Tasks

## 1. 建立版本化事件 owner

- [x] 1.1 实现 DiagnosticsEventStore：schema migration、strict allowlist/redaction、bounded query、严格行数上限、非致命写入和 failure status。
- [x] 1.2 将 application execution ID 改为 main-process lifetime identity；route/authorization/provider usage 写入事件表。
- [x] 1.3 贯通 SocialWork create/resume/stop/terminal/restart recovery 与 tool-call/result；将 turn/task/request/tool ID 分字段关联。
- [x] 1.4 对照 A1–A3 和默认 SocialChat/SocialWork路径审计事件覆盖及断点；RootAgent/DSH legacy 明确标注非覆盖。OS child PID/生命周期与逐条业务存储写入明确不由 B1 事件记录，B2 显示为覆盖边界。
- [x] 1.5 运行 event-store migration/retention/failure/redaction、目标路径关联、相关 work-service/provider tests、typecheck、source check 与 OpenSpec validation；不发真实模型请求。

## Workflow follow-up

- [x] 归档已完成 change 并核对主规格和 archive 状态。
