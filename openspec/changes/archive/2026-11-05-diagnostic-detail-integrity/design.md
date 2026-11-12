# Design

## Context

见 `proposal.md` 与 `specs/project-execution/spec.md`。本地数据库 schema 不需要变化；风险位于查询投影边界，即持久化 JSON 被再次带入 UI/导出的路径。

## Goals / Non-Goals

**Goals:**
- 把写入与读取共用同一份 allowlist/redaction 规则。
- 让详情安全完整度从存储层传到时间线、覆盖说明和导出。
- 让解析失败只影响该条详情，不影响其它事件或业务状态。

**Non-Goals:**
- 不为 diagnostics 建立第二套事件库或迁移现有事件表。
- 不记录被过滤内容，也不尝试从坏 JSON 恢复局部自由文本。
- 不把普通 `details: {}` 认作缺失；只有读时检测到过滤或不可读才标记。

## Decisions

- 事件详情投影增加 `detailsStatus`，值为 `complete`、`filtered` 或 `unavailable`。写入本来就会过滤的详情，在查询时通过与安全投影比较识别；无法解析、非对象或超过 16 KiB 的详情返回空对象并标为 `unavailable`。
- `unavailable` 的事件保留事件 ID、时间、执行/task/request 关联及有限状态码；`coverageFor()` 添加稳定 gap code。UI 显示详情状态，预览及导出沿用同一 timeline gap，避免误读为空记录。
- `filtered` 逐事件提示字段已过滤，但不把所有正常历史事件都提升为覆盖失败；敏感值只存在于 JSON parse 的局部变量，不输出到错误、计数或 gap。
- 导出 DTO 增加字段，故导出 schema 从 2 升为 3；数据库 schema 继续为 1，因为持久化格式不变。
- 与其让 query-service 为存储读取失败制造一个看似成功的空结果，沿用现有 IPC 拒绝和 renderer recoverable error；数据库整体不可用由现有 health/status UI 呈现。单条坏详情仍可查询并显示 gap。

## Risks / Trade-offs

- [旧记录在当前 allowlist 以外的字段可能显示为 `filtered`] → 这是保守且可解释的读时处理；不会丢弃允许字段。
- [详情状态增加导出字段] → 显式增加 schema version，消费者可按版本处理。
- [数据库 JSON 解析仍需有限 CPU] → parse 前限制 16 KiB；查询事件条数仍有 500 条硬上限。

## Migration Plan

无需 DB migration。部署后旧记录按当前安全规则读取；出现过滤或不可读时显示状态。回滚旧版本只影响新增投影字段，不改持久化记录。
