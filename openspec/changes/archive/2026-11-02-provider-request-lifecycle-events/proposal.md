# Proposal

## Why

当前 provider usage 只在请求结束时留下一个事件，无法判断请求是否开始、何时首次返回输出，或中断发生在请求/输出的哪个阶段。补全无正文的生命周期事件后，用户能沿同一 request ID 追查等待、失败和 usage 缺失。

## What Changes

- 在 provider request 生命周期写入 started、first-output 与 completed/failed/interrupted 事件；usage 缺失时额外记明确状态。
- 生命周期事件统一关联 request、operation/execution、task 和 turn ID，只记录阶段、状态与耗时，不记录 prompt、response、tool arguments 或凭据。
- 诊断写入失败不影响 provider 请求；修复 buffered malformed-tool-call 重试丢失 execution/turn 关联的问题。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`: 扩展 provider request lifecycle 的本机诊断行为。

## Impact

影响 OpenAI-compatible provider callback、main-process DiagnosticsEventStore 接线、诊断事件安全字段 allowlist、provider/诊断测试；不改变请求 payload、重试策略或用户可见授权。
