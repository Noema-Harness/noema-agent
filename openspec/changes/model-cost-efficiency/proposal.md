# Proposal

## Why

Noema 当前无法从本机记录判断模型输入有多少被缓存、各类调用消耗多少 token，或费用是否集中在重复上下文上。用户承担 DeepSeek 用量成本；在继续消耗余额做真实协作验证前，先补齐可核查的成本证据，再按证据优化。

## What Changes

- 按 Noema 调用场景记录模型请求结果；覆盖直连兼容 API 与 DSH 后台 worker。服务端数据可用时保存输入、输出、缓存命中/未命中/写入与推理 token 用量，断流等未知情况保留为未知。
- 本地持久化用量元数据，不保存提示词、回复内容、密钥或完整请求体。
- 读取 DeepSeek 流结束前默认返回的 usage 统计；兼容读取其他 OpenAI-compatible 服务实际返回的 usage 字段。
- 用 DeepSeek 前缀缓存规则及成熟 agent 项目的真实实现指导后续提示词稳定性与调用次数优化；先测量，再调整。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。第一阶段增加内部诊断与实现，不改变用户可见行为或模型决策契约。

## Impact

- 影响 `apps/desktop/src/main/providers/openai-compatible-client.mjs`、调用点、SQLite 用量记录与针对性测试。
- 不增加外部依赖，不记录提示词正文，不改变模型选择与推理内容。
- 成本优化的后续决策以真实 usage 账本和缓存比例为依据；模型请求失败或服务端不返回 usage 时明确记为未知，不能推算成零成本。
