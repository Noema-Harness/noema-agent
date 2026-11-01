# Proposal

## Why

Noema 必须能在自然交谈和持续委托之间作出判断。当前提示明确区分聊天与委托，但没有说明用户已经想推进事情、关键要求仍不清楚时如何处理，容易在“直接建组”和“继续闲聊”之间跳过关键澄清。

## What Changes

- 明确未定想法留在主聊，不自动创建联系人或项目。
- 具体推进请求中，只有会改变结果方向或验收的未知才先问一个聚焦问题；普通细节由 Noema 自行判断，低影响未知可作可逆假设继续。
- 保持现有工具分工与权限边界，不增加意图分类器或新的持久状态。

## Capabilities

### New Capabilities

### Modified Capabilities
- `social-conversations`: 补充交谈、澄清与持久委托之间的行为边界。

## Impact

- Noema 主聊系统提示 `apps/desktop/src/main/chat/records.mjs`。
- 逻辑流程图及聊天/项目协作定向测试。
