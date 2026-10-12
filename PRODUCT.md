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

仍在验证。多模型聊天、长期记忆及其来源查看/编辑，已被成熟产品覆盖，单独不能成为 Noema 的理由。当前候选方向改为：Noema 是否能拥有一条面向用户的持续主线，在用户更换模型或把工作交给完整 coding harness 时，把任务意图、已确认决定和结果连贯地带回，同时诚实地区分各 harness 的原生会话、工具轨迹与工作区状态。该假设仍未成为产品承诺，且“现有多模型前端 + harness 插件/适配器是否足够”是强反例，详见 [当前产品发现 Issue #2](https://github.com/c3115644151/noema-agent/issues/2)。关系连续性仍是更大的愿景，但不自动意味着独立产品价值。

## Operating Context

- 用户以中文交流，跨生活想法和编程等工作内容切换。
- Noema 应是用户自己的交互入口；外部模型、harness、agent 与工具可以被连接，但 Noema 不依附其中任一个。
- 当前代码仅有 Electron 桌面壳；尚无模型调用、持久记忆或外部集成。

## Capabilities and Constraints

- 独立应用和个人 agent 方向已确认；首版交互、状态对象、学习/记忆方式、主动性边界和视觉语言均未确定。
- Noema 不应宣称模型具有真实意识或人类情感；“像伙伴”需要由真实互动表现和持续性建立，不靠拟人化文案声称。
- M1 正在定义第一条真实使用闭环，并允许先制作可点击原型；当前阶段不构建完整 agent runtime、记忆系统或集成层。
- 当前产品范围及阶段门以 [项目工作流](docs/PROJECT_OPERATIONS.md) 与 GitHub Issue/Project 实时状态为准。

## Brand Commitments

- 名称：Noema。
- 基础语言：简体中文。
- 用户偏好动态、有表现力、布局精良的界面，反感粗糙的“AI 仪表盘/聊天套壳”观感。
- 尚无被用户确认的颜色、字体、视觉风格、图形隐喻或品牌资产。现有占位页不是已确认的设计系统。

## Evidence on Hand

- 用户明确描述了跨 AI 使用时身份/互动连续性和工作陪伴不足的个人动机，详见当前工作流与 M1 Issue。
- 公开案例、实现与反例持续记录在 [Issue #2 的研究与续接评论](https://github.com/c3115644151/noema-agent/issues/2)；这些证据支持或削弱假设，但不自动成为用户批准的产品要求。
- 目前没有来自 Noema 原型用户测试的证据；不得虚构已验证的体验或结果。

## Product Principles

1. 将 Noema 作为持续存在的个人 agent 来设计，而不是某一外部 harness 的插件。
2. 把用户确认、外部事实、助手在生命周期授权内作出的决定和未验证假设分开记录。
3. 不从“AI 应该有灵魂”等愿景直接推导功能；通过真实使用场景和成熟实现形成可工作的闭环。
4. 把关系连续性视为候选产品价值，只有原型显示它确实改变后续互动时，才把它作为核心机制。
