# Proposal

## Why

当兼容服务商返回空或全无效的 usage 对象时，Noema 仍标记 usage 已返回，诊断覆盖因此误报完整；同时 UI 把未知输出 token 显示为零。成本追踪必须准确保留未知值与真实零值的区别，才能作为用户检查日常消耗的可靠依据。

## What Changes

- 仅在响应包含至少一个有效 token/cache 计量时标记 token usage 已返回，provider cost 独立保留。
- 读取 OpenAI Chat Completions 文档明确的 cache-write 字段；DeepSeek 未报告时保持 unknown。
- 检查彼此矛盾的 cache hit/miss 计数并将不可信分解保持为 unknown。
- 时间线对输入、输出与缓存分解分别显示未知状态，不以零填补缺失字段。
- 只读取已核对的协议字段，不跨 API 协议猜测 cache-write 值。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`：provider lifecycle 对空/无效 usage 显示缺失；token/cache unknown 与真实 zero 必须区分。

## Impact

影响 OpenAI-compatible provider usage normalization、model usage timeline 呈现、`project-execution` 规格及相关 provider/query/UI 测试；不发送真实 provider 请求，不改变请求 payload 或业务消息。
