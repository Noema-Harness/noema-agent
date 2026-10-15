# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

当前实现是 Windows 优先的 Electron 桌面应用，UI 使用 React/Vite 渲染；平台字段按现有 web-rendered UI 记录，不表示 Noema 是浏览器 SaaS。

## Users

首个使用者是项目拥有者本人：日常使用 Codex、Claude Code、DeepSeek Harness 等不同 AI，主要通过 AI 推进 vibecoding，也会与 AI 讨论想法和个人日常。外部受众与商业定位未确定。

## Product Purpose

Noema 是独立的个人 agent 应用。用户希望拥有一个真正“属于自己”、能跨任务与模型持续存在并逐渐个体化的 agent；它不只是等待命令、交付工作的工具，也不能只是另一个通用 agent 的壳。

## Positioning

仍在验证。多模型聊天、长期记忆及其来源查看/编辑、以及在 DSH 内运行 Codex/Claude coding backend，已被成熟或新兴方案覆盖，单独不能成为 Noema 的理由。用户已明确要求 Noema 主对话不被执行任务占用：专业 agent 可后台运行，结果以系统事件回到 Noema；主 agent 空闲时接住该事件，用户也能随时介入。当前候选方向是：Noema 是否能成为跨生活/工作情境持续存在的顶层个人 agent，同时把长任务交给拥有各自原生 session、工作区和工具轨迹的专业 harness。Noema 主对话切换模型不等于后台执行环境被迁移。该候选假设尚未成为产品承诺；“Open WebUI/DSH + Relay/plugins 是否足够”是强反例，详见 [当前产品发现 Issue #2](https://github.com/c3115644151/noema-agent/issues/2)。关系连续性仍是更大的愿景，但不自动意味着独立产品价值。

## Operating Context

- 用户以中文交流，跨生活想法和编程等工作内容切换。
- Noema 应是用户自己的交互入口；外部模型、harness、agent 与工具可以被连接，但 Noema 不依附其中任一个。
- 当前 Windows 桌面切片拥有本地持久根对话、FreeLLMAPI 免费模型调用、可选 DSH headless 文件 worker，以及一条只读 Codex 会话快照导入路径；用户可在单条根对话中本地查找已保存的用户/Noema消息并跳回原文。搜索不调用模型或扩展后续请求上下文。这些证明若干交接机制可运行，但没有证明 Noema 的关系连续性或独立产品价值。

## Capabilities and Constraints

- 独立应用和个人 agent 方向已确认；首版交互、状态对象、学习/记忆方式、主动性边界和视觉语言均未确定。
- Noema 不应宣称模型具有真实意识或人类情感；“像伙伴”需要由真实互动表现和持续性建立，不靠拟人化文案声称。
- 已验证能力：FreeLLMAPI 根对话、用户选择工作区、后台 DSH 文件任务、停止/同 session 续接、系统事件回流与重启恢复。DSH 是首个可替换 adapter，不是 Noema 核心身份。
- 后台 DSH 任务会在时间线保留最多 32 条工具操作类别及顺序；不记录工具参数、文件内容或返回值。它说明 agent 发起了什么类别的操作，不代表操作成功；成功与否仍以独立核验结果为准。
- 新增 M1 实验能力：只读列出并预览本机 Codex thread；用户选定后把有来源的可见文字快照附到唯一根对话，用户可移除。下一次把快照发到 FreeLLMAPI 前需单独确认。它不续接或修改 Codex thread，也不迁移 reasoning、工具轨迹或工作区状态。
- 未实现能力：Claude 原生 thread reader、经历/理解状态、持久个体化交互模式。Codex App Server 在本机可读接口仍是实验协议；当前实现是可替换的 M1 验证适配器，不应被表述为生产级跨 harness 会话同步。M1 仍需证明 Noema 的用户-owned root 是否比现有 agent + relay 组合多出足够的日常价值。
- 当前产品范围及阶段门以 [项目工作流](docs/PROJECT_OPERATIONS.md) 与 GitHub Issue/Project 实时状态为准。

## Brand Commitments

- 名称：Noema。
- 基础语言：简体中文。
- 用户偏好动态、有表现力、布局精良的界面，反感粗糙的“AI 仪表盘/聊天套壳”观感。
- 尚无被用户确认的颜色、字体、视觉风格、图形隐喻或品牌资产。现有占位页不是已确认的设计系统。

## Evidence on Hand

- 用户明确描述了跨 AI 使用时身份/互动连续性和工作陪伴不足的个人动机，详见当前工作流与 M1 Issue。
- 公开案例、实现与反例持续记录在 [Issue #2 的研究与续接评论](https://github.com/c3115644151/noema-agent/issues/2)；这些证据支持或削弱假设，但不自动成为用户批准的产品要求。
- PR #18 验证的是一条从 Noema 发起的新 DSH 文件任务，不是从现有 Codex thread 迁移；它不代表用户的 Codex 额度耗尽痛点已被解决。
- Codex 快照路径已在隔离数据目录中用真实本机 App Server 完成列表、预览、导入、时间线回显和移除；真实用户会话内容未外传。另在临时根数据库中通过真实 FreeLLMAPI 路由测试了合成快照续接：`free-router` 与直连 Nemotron 返回 `provider_unavailable`，`auto:noema-free` 成功准确复述合成代号与验收标准。该结果证明数据路径可工作，但不能证明真实会话的继续质量、长期稳定性或 Noema 独立产品价值；真实用户快照仍需每个用户在应用内明确授权后才可发送。
- 目前没有来自 Noema 原型用户测试的证据；不得虚构已验证的体验或结果。

## Product Principles

1. 将 Noema 作为持续存在的个人 agent 来设计，而不是某一外部 harness 的插件。
2. 把用户确认、外部事实、助手在生命周期授权内作出的决定和未验证假设分开记录。
3. 不从“AI 应该有灵魂”等愿景直接推导功能；通过真实使用场景和成熟实现形成可工作的闭环。
4. 把关系连续性视为候选产品价值，只有原型显示它确实改变后续互动时，才把它作为核心机制。
