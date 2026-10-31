# Design

## Context

见 [proposal.md - Why](proposal.md#why)。Noema 有两条模型调用路径：主进程内的 OpenAI-compatible Chat Completions，以及 DSH headless worker。前者之前丢弃 SSE usage chunk；后者的 `--json` `step_end` usage 之前被适配器丢弃；应用尚无完整的持久用量记录。DeepSeek 的上下文缓存依赖精确重复的输入前缀，并在响应 usage 中报告命中/未命中 token；其他兼容端点的字段并不完全一致。

## Goals / Non-Goals

**Goals:**

- 让直连模型请求与 DSH 后台 worker 的每次模型步骤留下可按模型、调用场景和日期汇总的状态与 token/cache 用量。
- 保留“服务端没提供”的未知状态，不把缺失字段记成零。
- 不让诊断存储故障中断用户回复；不保存请求正文或 API 凭据。
- 先以调用量、上下文与缓存数据定位成本，再逐项优化，保留真实使用行为。

**Non-Goals:**

- 本变更不新增费用估算/账单 UI，不根据公共价格表推测用户实际付款。
- 不在所有服务端点强塞供应商专用缓存标记；不新增模型调用来“预热”缓存。
- 不仅凭字符数或本地估算宣称缓存命中、token 费用或余额变化。

## Decisions

1. **直连 API 与 DSH worker 都把用量写入同一个 provider 回调边界。** 直连请求读取 OpenAI-compatible 响应 usage；DSH headless JSON 的 `step_end` 聚合 usage 经薄适配器回调。DSH 同一 step 的重试已由上游聚合；缺失任一尝试用量时，上游不输出 usage，Noema 将其保留为未知。场景标签和提示词均不发送给服务端。DeepSeek 的流式接口默认在最后一块返回 usage，因此不发送 `stream_options.include_usage`。
2. **在现有 Noema SQLite 数据库内用独立 `ModelUsageStore` 持久化。** 与对话正文分开；字段仅含日期、服务端主机名、模型、调用场景、请求状态、输入/输出/缓存命中/未命中/写入/推理 token、可选服务端成本、请求字符数及消息/工具数。现有 profile 通过幂等 `ALTER TABLE` 补入 cache-write 列，不回填历史数据。替代方案是临时日志，但它难以可靠汇总且容易丢失；不在 root 对话表或社交消息表中加入成本字段，避免绑死单一对话域。
3. **字段缺失用 NULL，非负整数才接收。** 兼容 DeepSeek `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 与 OpenAI `prompt_tokens_details.cached_tokens` 等常见结构；输入/输出 token 与缓存 token 保持独立。服务端费用原样保存为受限 JSON，若语义或币种未知不在本地换算。
4. **流式与缓冲响应都在完成边界记录一次。** SSE usage 常在终止块出现且没有 choices；解析该块但不改变流出的文字/工具顺序。工具参数纠错产生的新请求单独计量。记录失败被捕获为诊断写入失败，不可改写模型结果。
5. **缓存优化遵循前缀稳定性，而非通用模板改写。** OpenCode 的缓存策略显式按 provider 区分隐式缓存与显式 cache-control；Goose 的上下文压缩/缓存实践也有明确阈值和成本边界。Noema 先用账本确认哪些调用的提示前缀重复、动态字段在哪开始变化，再调整消息顺序或上下文；不直接移植其他 agent 的压缩策略。

6. **DSH usage 按 step 记录，不按工具调用或整个 worker 任务记账。** 已安装的 DSH headless 投影在完成 step 时提供跨 attempt 聚合用量；这最接近真实模型请求边界。Noema 只保存规范化 token 桶，不保存 DSH session 内容、推理文本、工具输入或结果。provider 没有报告的 usage 记为未知；不通过读取 DSH 私有投影缓存或直接解析其内部持久化文件来补账。

7. **缓存优化先稳定输入前缀，再用真实 usage 确认收益。** DeepSeek 文档说明后续请求只能复用已持久化且完整匹配的输入前缀，缓存为 best-effort；因此根对话中仅当前一轮才需要的网页引用和历史检索说明不应抢在此前的对话记录之前。现已把它们放到历史之后、当前用户消息之前。该改动只提高可复用前缀的机会，不保证服务端命中率，也尚未在付费请求后验证实际收益。
8. **把工具定义体积作为成本维度单独观测。** 原用量表只记录 message JSON 字符数和工具数量，未记录工具 schema 本身。现在增加 `tool_definition_characters`，只保存序列化 schema 长度，不保存名称、描述、参数、提示词或回复。现有五条账本样本均为社交/项目协作调用，缺少工具定义长度，不能据此归因低命中。源码样例中 `manage_project_plan` 约 9.6K 字符，但这是合成项目数据下的本地结构测量，不是服务端实发 token 数。后续只有真实请求数据表明 schema 负载显著且动态时，才进一步考虑稳定 schema、请求上下文或删减描述。

### 源码级校准

- DeepSeek [Context Caching](https://api-docs.deepseek.com/guides/kv_cache/) 说明缓存默认开启，但只有完整复用已落盘的前缀单元才算命中；API 返回 hit/miss token。缓存不是“对话开了就有”的开关，提示前缀稳定性才是可优化变量。
- DeepSeek [官方价格表](https://api-docs.deepseek.com/quick_start/pricing/)（2026-11-01 查阅）对 `deepseek-flash` 标示 cache-hit 输入约为 miss 输入的 1/50（非高峰 `$0.003` 对 `$0.15` / 百万 token）；这是当前上游价格快照，不在 Noema 中硬编码，实际账户以服务端 usage/扣费为准。
- OpenCode 在快照 `7ce35879b8569263f14b37cff6d84394e635b00f` 的 [`cache-policy.ts`](https://github.com/anomalyco/opencode/blob/7ce35879b8569263f14b37cff6d84394e635b00f/packages/ai/src/cache-policy.ts) 把默认断点放在工具定义尾、系统内容首尾和消息尾，并限制为四处；它会跳过使用隐式前缀缓存的 OpenAI/Gemini 路径，不对所有提供方发送 cache 标记。其 [`session/usage.ts`](https://github.com/anomalyco/opencode/blob/7ce35879b8569263f14b37cff6d84394e635b00f/packages/core/src/session/usage.ts) 将普通输入、cache read/write、输出和推理 token 分开，并优先采用提供方上报费用，价格目录仅作缺省估算。
- Anthropic 官方 [`prompt-caching.md`](https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/prompt-caching.md) 把缓存优化落实为提示构造顺序：全局固定内容在前、会话级内容其次、每轮变化的内容放在尾部；它还特别指出并行成员若只改变少量任务文本，仍会各自写入不同缓存。这里复用的是“按稳定性排布、测量前缀断点”的方法；Claude 的 cache-control 标记、TTL 与 DeepSeek 自动缓存规则不同，不直接移植。
- Goose 在快照 `b23d21cabd9b4de0c045dcdd731821a3a15c2bfc` 的 [`context_mgmt/mod.rs`](https://github.com/aaif-goose/goose/blob/b23d21cabd9b4de0c045dcdd731821a3a15c2bfc/crates/goose/src/context_mgmt/mod.rs) 用占上下文比例和绝对 token 上限共同触发压缩，并分批总结较早的工具调用。压缩调用本身也计费用；这适合其长工具会话治理，不证明对 Noema 的所有短聊天更省钱。
- Noema 当前主聊的稳定 ROOT prompt 已单独位于消息首部；专业成员则将稳定人格 prompt 与初识、项目成长、评审等动态文本拼成一个 system message。执行工具集合也随请求变化。第一批账本数据应验证这些动态边界实际消耗的缓存份额，再决定是否拆分/重排；在数据出来前不做 prompt 内容改写。
- 成本专项的首批现有样本只有 5 次 `deepseek-flash` 协作请求：两次同一社交工具轮次的连续记录、两次同一项目工具续答、另一次社交轮次；对应缓存命中率分别为 1.9%、93.6%、16.4%、99.1%、0.8%。高低值可与请求场景切换相伴，但样本没有工具 schema 字符数、精确前缀指纹或费用，不能断言工具变化就是低命中的因果。后续采集只增加长度元数据，不采集正文。

## Risks / Trade-offs

- [兼容端点忽略或拒绝 `stream_options`] → 仅对 DeepSeek 请求 `include_usage`；其他端点被动读取 usage，故字段缺失时指标覆盖率会显式下降。
- [新记录可能被误读为账单] → 字段与导出/诊断命名明确为 provider usage；不汇率转换、不推算本地货币。
- [新表持续增长] → 每次记录极小且不含正文；先保持逐请求粒度，后续按实际使用规模决定保留/聚合，不引入预设清理期限。
- [回调或本地数据库异常影响回复] → 记录操作独立 try/catch，仅写受控诊断日志；模型响应原有完成/失败状态不变。
- [断流请求被计为失败但实际上游可能已经计费] → 单独统计失败/中断请求；没有服务端 usage 时显示未知，不按 0 计费。

## Migration Plan

创建独立用量表和索引，不变更已有数据、不回填旧请求。新版本第一次打开数据库时 `CREATE TABLE IF NOT EXISTS`；已有表以幂等 `ALTER TABLE` 增加 `cache_write_tokens`，旧记录保持 `NULL`。若实现回滚，保留用量表即可；应用旧版本忽略新增列。
