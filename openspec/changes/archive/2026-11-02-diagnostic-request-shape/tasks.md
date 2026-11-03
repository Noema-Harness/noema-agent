# Tasks

## 1. 持久用量投影与共享契约

- [x] 1.1 在 `ModelUsageStore.getForDiagnostics()` 选择既有 request/tool 字符数及 message/tool 数，并为旧记录保持 null；定向 store 测试验证值与缺失语义。
- [x] 1.2 扩展 `NoemaDiagnosticUsage` 和 `DiagnosticsQueryService` 返回值；诊断查询测试验证新增 metadata 只透传数值，不引入正文。

## 2. 时间线展示与验证

- [x] 2.1 在模型请求时间线中显示明确标注的字符数与消息/工具计数，缺失值显示不可用；纯格式化函数单测覆盖正常、null 与 zero，renderer typecheck 检查接线。
- [x] 2.2 运行受影响的 usage store、diagnostics query/UI、typecheck、source check、OpenSpec strict validation 和 diff check；确认导出 DTO 与数据库 schema 未改变。

## Workflow follow-up

- Archive the change after implementation and validation; then verify the archived spec.
