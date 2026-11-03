# Spec Delta

## ADDED Requirements

### Requirement: provider request diagnostics expose privacy-safe message role sizes
每条可用的 provider 请求 MUST 允许用户在本机诊断时间线查看按固定 message role 汇总的消息对象 JSON 字符数。数据 MUST 仅包含 `system`、`developer`、`user`、`assistant`、`tool` 和 `other` 分类及非负整数，不得包含角色原值、消息正文或工具参数；MUST 明确标为字符而非 token。旧记录或无 provider 请求形状的记录 MUST 显示不可用。诊断导出 MUST NOT 包含该字段。

#### Scenario: inspect request message sizes
- **WHEN** 用户在本机诊断时间线查看一条有请求形状的 provider request
- **THEN** 系统按固定角色分类展示各类消息对象 JSON 字符数，不显示消息正文或工具参数，且单位标为字符

#### Scenario: a message has an unrecognized role
- **WHEN** provider 请求中包含固定清单以外的 message role
- **THEN** 系统只将该消息的对象 JSON 字符数计入 `other`，不持久化或展示原始 role

#### Scenario: historical request has no role measurements
- **WHEN** 用户查看升级前的用量记录或没有请求形状数据的记录
- **THEN** 各角色字符数显示不可用而非零，其他用量与事件仍可查看

#### Scenario: preview a diagnostics export
- **WHEN** 用户查看或保存本机诊断导出
- **THEN** 导出不包含任何按角色的请求字符统计
