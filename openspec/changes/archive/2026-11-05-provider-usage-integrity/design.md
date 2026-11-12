# Design

## Context

见 `proposal.md` 与 `specs/project-execution/spec.md`。当前 `normalizeProviderUsage()` 把任何 object-shaped `usage`（包括空对象）标记为已收到；诊断 query 使用该标记决定是否显示 usage missing。共享 timeline 将未知 output tokens 渲染成 `0`。DeepSeek 官方 Chat Completions 文档列出 hit/miss；OpenAI 官方 Chat Completions usage 文档明确列出 `prompt_tokens_details.cache_write_tokens`。

## Goals / Non-Goals

**Goals:**
- 区分 usage envelope 存在与具有可识别计量。
- 保持 per-field nullable 语义，零值不被吞掉，缺失值不被补零。
- 对彼此冲突的 cache breakdown 整组标 unknown。

**Non-Goals:**
- 不调用真实 provider，不声明 token/cache 实耗改善。
- 不对 generic OpenAI-compatible 服务猜 tokenizer 或 context window；只解析经官方 Chat Completions 契约核对的 cache-write 字段。
- 不改 prompt、消息顺序、工具定义或 provider request body。

## Decisions

- 将 `usageReceived` 定义为响应至少有一个有效、可识别的非负 token/cache 数值。数值 0 是有效值；空对象、仅有未知字段、仅有 provider cost 或无效数值均视为 token usage missing。provider cost 仍独立保存在现有字段。
- 保留 `inputTokens` / `outputTokens` / cache / reasoning 等逐字段 nullability。若 input 总量与 cache hit/miss 已报告值冲突，丢弃 cache breakdown 的两项，保留可靠的总 input/output 值。
- timeline 对输入与输出分别呈现数值或“未知”；当 input 存在但 cache breakdown 未被服务商报告时明确显示缓存拆分未知。不会把 missing usage row 补成 0。
- 仅映射 Chat Completions 响应中的 `prompt_tokens_details.cache_write_tokens`；不从 Responses API 字段或其它非当前 payload 路径推断。DeepSeek 只从其正式 hit/miss 字段获取缓存拆分，cache-write 保持 null。无 provider 身份时也不推导 tokenizer 或请求能力。

## Risks / Trade-offs

- [兼容服务商可能回传非标准 usage 字段] → 未知字段继续按 unknown 处理，并在 PE17 provider fixture 扩展前不宣称支持。
- [丢弃有冲突的 cache hit 与 miss 会减少可显示的部分数据] → 不一致计量比显示错误命中率更有害；总 token 字段仍保留。

## Migration Plan

无需数据库 schema 迁移；现有 nullable 字段已经能表示 unknown。部署后，新请求使用更严格的 `usageReceived` 判定；旧记录不重写。导出和 timeline 沿现有 null 字段呈现。
