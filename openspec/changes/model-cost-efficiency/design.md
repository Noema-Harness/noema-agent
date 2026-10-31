# Design

## Context

见 [proposal.md - Why](proposal.md#why)。目前唯一模型边界是 OpenAI-compatible Chat Completions。流式解析器读取文本和工具调用后丢弃 usage chunk；应用没有持久用量记录。DeepSeek 的上下文缓存依赖精确重复的输入前缀，并在响应 usage 中报告命中/未命中 token；其他兼容端点的字段并不完全一致。

## Goals / Non-Goals

**Goals:**

- 让每次模型请求留下可按模型、调用场景和日期汇总的状态与 token/cache 用量。
- 保留“服务端没提供”的未知状态，不把缺失字段记成零。
- 不让诊断存储故障中断用户回复；不保存请求正文或 API 凭据。
- 先以调用量、上下文与缓存数据定位成本，再逐项优化，保留真实使用行为。

**Non-Goals:**

- 本变更不新增费用估算/账单 UI，不根据公共价格表推测用户实际付款。
- 不在所有服务端点强塞供应商专用缓存标记；不新增模型调用来“预热”缓存。
- 不仅凭字符数或本地估算宣称缓存命中、token 费用或余额变化。

## Decisions

1. **用 provider 回调传递归一化 usage，调用方提供内部场景标签。** 保持模型边界是 OpenAI-compatible，不把成本逻辑写入各 agent；标签和提示词均不发送给服务端。DeepSeek 的流式接口默认在最后一块返回 usage，因此不发送 `stream_options.include_usage`；其他端点只记录它们实际返回的数据。
2. **在现有 Noema SQLite 数据库内用独立 `ModelUsageStore` 持久化。** 与对话正文分开；字段仅含日期、服务端主机名、模型、调用场景、输入/输出/缓存/推理 token、可选服务端成本、请求字符数及消息/工具数。替代方案是临时日志，但它难以可靠汇总且容易丢失；不在 root 对话表或社交消息表中加入成本字段，避免绑死单一对话域。
3. **字段缺失用 NULL，非负整数才接收。** 兼容 DeepSeek `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 与 OpenAI `prompt_tokens_details.cached_tokens` 等常见结构；输入/输出 token 与缓存 token 保持独立。服务端费用原样保存为受限 JSON，若语义或币种未知不在本地换算。
4. **流式与缓冲响应都在完成边界记录一次。** SSE usage 常在终止块出现且没有 choices；解析该块但不改变流出的文字/工具顺序。工具参数纠错产生的新请求单独计量。记录失败被捕获为诊断写入失败，不可改写模型结果。
5. **缓存优化遵循前缀稳定性，而非通用模板改写。** OpenCode 的缓存策略显式按 provider 区分隐式缓存与显式 cache-control；Goose 的上下文压缩/缓存实践也有明确阈值和成本边界。Noema 先用账本确认哪些调用的提示前缀重复、动态字段在哪开始变化，再调整消息顺序或上下文；不直接移植其他 agent 的压缩策略。

### 源码级校准

- DeepSeek [Context Caching](https://api-docs.deepseek.com/guides/kv_cache/) 说明缓存默认开启，但只有完整复用已落盘的前缀单元才算命中；API 返回 hit/miss token。缓存不是“对话开了就有”的开关，提示前缀稳定性才是可优化变量。
- DeepSeek [官方价格表](https://api-docs.deepseek.com/quick_start/pricing/)（2026-11-01 查阅）对 `deepseek-flash` 标示 cache-hit 输入约为 miss 输入的 1/50（非高峰 `$0.003` 对 `$0.15` / 百万 token）；这是当前上游价格快照，不在 Noema 中硬编码，实际账户以服务端 usage/扣费为准。
- OpenCode 在快照 `7ce35879b8569263f14b37cff6d84394e635b00f` 的 [`cache-policy.ts`](https://github.com/anomalyco/opencode/blob/7ce35879b8569263f14b37cff6d84394e635b00f/packages/ai/src/cache-policy.ts) 把默认断点放在工具定义尾、系统内容首尾和消息尾，并限制为四处；它会跳过使用隐式前缀缓存的 OpenAI/Gemini 路径，不对所有提供方发送 cache 标记。其 [`session/usage.ts`](https://github.com/anomalyco/opencode/blob/7ce35879b8569263f14b37cff6d84394e635b00f/packages/core/src/session/usage.ts) 将普通输入、cache read/write、输出和推理 token 分开，并优先采用提供方上报费用，价格目录仅作缺省估算。
- Goose 在快照 `b23d21cabd9b4de0c045dcdd731821a3a15c2bfc` 的 [`context_mgmt/mod.rs`](https://github.com/aaif-goose/goose/blob/b23d21cabd9b4de0c045dcdd731821a3a15c2bfc/crates/goose/src/context_mgmt/mod.rs) 用占上下文比例和绝对 token 上限共同触发压缩，并分批总结较早的工具调用。压缩调用本身也计费用；这适合其长工具会话治理，不证明对 Noema 的所有短聊天更省钱。
- Noema 当前主聊的稳定 ROOT prompt 已单独位于消息首部；专业成员则将稳定人格 prompt 与初识、项目成长、评审等动态文本拼成一个 system message。执行工具集合也随请求变化。第一批账本数据应验证这些动态边界实际消耗的缓存份额，再决定是否拆分/重排；在数据出来前不做 prompt 内容改写。

## Risks / Trade-offs

- [兼容端点忽略或拒绝 `stream_options`] → 仅对 DeepSeek 请求 `include_usage`；其他端点被动读取 usage，故字段缺失时指标覆盖率会显式下降。
- [新记录可能被误读为账单] → 字段与导出/诊断命名明确为 provider usage；不汇率转换、不推算本地货币。
- [新表持续增长] → 每次记录极小且不含正文；先保持逐请求粒度，后续按实际使用规模决定保留/聚合，不引入预设清理期限。
- [回调或本地数据库异常影响回复] → 记录操作独立 try/catch，仅写受控诊断日志；模型响应原有完成/失败状态不变。
- [断流请求被计为失败但实际上游可能已经计费] → 单独统计失败/中断请求；没有服务端 usage 时显示未知，不按 0 计费。

## Migration Plan

创建独立用量表和索引，不变更已有数据、不回填旧请求。新版本第一次打开数据库时 `CREATE TABLE IF NOT EXISTS`。若实现回滚，保留用量表即可；应用旧版本忽略该表。
