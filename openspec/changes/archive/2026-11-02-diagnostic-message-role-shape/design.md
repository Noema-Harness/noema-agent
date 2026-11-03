# Design

## Context

See proposal.md - Why. 当前 `requestCharacters` 由完整 messages 数组的 JSON 序列化长度计算。分角色统计需与这份实际序列化结构对照，并经过 model-usage owner、只读诊断 DTO 与 renderer；diagnostics export 已有独立字段投影。

## Goals / Non-Goals

**Goals:**
- 记录固定角色集合的消息对象 JSON 字符数，且总和与整体 message array 长度之间的差异仅来自数组括号与对象间分隔符。
- 让历史空值继续表示“未测量”，不回填为零。
- 在数据库、查询 DTO 与 UI 中保持角色键白名单；导出不扩充。

**Non-Goals:**
- 不推断 token 数、cache hit、当前 user 与历史 user 的差异或 system 内容的静态/动态来源。
- 不改写 provider payload、prompt、上下文裁剪策略或工具集合。
- 不为 DSH/legacy usage 构造未实际测量的角色分布。

## Decisions

1. provider 层逐条对 `JSON.stringify(message)` 计长，再聚合到固定的 `system`、`developer`、`user`、`assistant`、`tool`、`other` 六类。`other` 不保存原始 role。不能序列化的消息令该次角色分布为 unknown；不生成部分数值伪装完整测量。
2. ModelUsageStore 将白名单角色→非负整数对象序列化到可空列，并在写入时重新构造固定键集合；现存数据库通过可重复的 `ALTER TABLE` 补可空列。历史记录保持 NULL。
3. `getForDiagnostics()` 仅对经过 JSON 解析和逐项整数校验的角色对象返回该字段。普通 usage listing 可读取该字段用于内部一致性检查，但诊断 export 的 allowlist 不添加它。
4. renderer 单独展示角色字符数并说明这是各 message 对象的 JSON 序列化字符总和，不是 tokenizer token 估计；缺失、损坏或旧记录显示 unavailable。

### Alternatives considered

- 持久化消息正文摘要或哈希：无法帮助解释体量来源，增加敏感数据风险。
- 按 system/user 区分静态提示、历史、最新输入、工具回执：当前 message DTO 没有稳定来源标签；推断会给出错误分类。只按 wire role 归类。
- 在 export 中包含形状统计：用户尚未要求扩大报告数据；先保留既有最小导出白名单。

## Risks / Trade-offs

- [Role 字符之和不等于 JSON 数组总长度] → UI明确标注为各 message 对象 JSON 字符总和；整体 request JSON 字符数仍作为总量。
- [过渡或损坏记录携带无效 JSON] → 写入白名单校验，读取失败显示 unavailable；不影响 request 和 task。
- [字符数无法代替模型 tokenizer] → 所有标签保持字符单位，不提供 token 或 cache 结论。

## Migration Plan

启动时为 `model_usage_records` 增加可空角色统计列，不重写既有行。回滚时旧版本忽略新增列；恢复前版本时该列不需要清理。新增字段仅进入本机查询，不进入版本化导出。
