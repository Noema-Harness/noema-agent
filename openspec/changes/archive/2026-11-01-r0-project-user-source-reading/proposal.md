# Proposal

## Why

真实项目里用户已经把五家官方价格页发给了 Noema，但项目成员的公开资料工具只有在配置 Tavily 后才出现，成员因此无法直接读取已知链接。成熟 agent 将“搜索发现”与“读取用户给出的具体 URL”分开；Noema 已有带 SSRF 防护的页面读取器，可以复用它补齐这条路径。

## What Changes

- 为项目成员提供只读取项目用户消息中明确给出的公开 URL 的能力，不要求另配搜索服务密钥。
- 搜索仍由现有 Tavily 能力负责；直接读取只允许读取精确授权的 URL，并沿用既有网页安全检查、单轮来源上限、取消和来源记录。
- 在公开成果中附上实际读取成功的页面链接；读取失败不能作为已核实来源，网页正文仍按不可信资料处理。

## Capabilities

### New Capabilities

### Modified Capabilities

- `project-collaboration`: 项目成员可读取用户明确提供的公开链接，并将成功读取的来源保留在项目成果中。

## Impact

- 影响 `SocialChatService` 的项目工具可用性、URL 授权校验和来源交接。
- 复用 `web-source.mjs`，不新增外部搜索服务、凭据或依赖。
- 更新项目协作规格、流程图与运行时回归测试。
