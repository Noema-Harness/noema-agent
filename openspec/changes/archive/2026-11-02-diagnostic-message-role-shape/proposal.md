# Proposal

## Why

当前诊断只展示整个 messages JSON 的字符数和工具 schema 字符数，无法判断输入增长来自 system、user/history、assistant 或 tool result。增加仅按固定 message role 聚合的 JSON 字符计数，可帮助定位请求体积变化，同时不保存或展示消息内容。

## What Changes

- 模型用量诊断记录 system、developer、user、assistant、tool 与 other 六类 message JSON 字符数。
- 本机诊断时间线展示各类字符数；缺少旧记录时明确显示不可用。
- 持久化与查询仅接受固定角色键和非负整数；本地导出继续排除这些请求形状字段。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`: 扩展本机 provider 请求形状诊断字段及其隐私、旧记录缺失语义。

## Impact

影响 OpenAI-compatible provider usage 记录、SQLite 用量存储兼容迁移、只读诊断查询与时间线界面、共享 bridge DTO 和定向测试；不改变 provider payload、模型上下文或工具授权。
