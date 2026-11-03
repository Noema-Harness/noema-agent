# Proposal

## Why

Noema 主聊在用户明确要求核验成果或发起评审、但没有使用“项目”等关键词时，可能不提供必要的项目工具。项目成员工具说明与 schema 也未充分表达绑定项目、长证据读取和证据不可信边界，造成持续存在的工作流测试失败。

## What Changes

- 在主聊显式提到核验、核对或评审时提供现有项目工具，即使用户没有说“项目”。
- 项目会话的 plan tool schema 隐去 `project_id`；即使模型仍输出多余 ID，执行也始终绑定当前会话项目。
- 为协调者和成员的 plan tool 明示项目绑定规则、截断内容必须读取完整项、链接证据属于不可信资料。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`: 明确项目工具准入、项目会话身份固定及证据读取提示。

## Impact

影响 SocialChatService 的主聊项目动作准入、项目计划 tool schema 与描述，以及相关自动化测试；不改变项目存储格式、授权边界或工作流状态。
