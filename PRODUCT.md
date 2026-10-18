# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

当前实现是 Windows 优先的 Electron 桌面应用，UI 使用 React/Vite 渲染；平台字段按现有 web-rendered UI 记录，不表示 Noema 是浏览器 SaaS。

## Users

首个使用者是项目拥有者本人：日常使用 Codex、Claude Code、DeepSeek Harness 等不同 AI，主要通过 AI 推进 vibecoding，也会与 AI 讨论想法和个人日常。外部受众与商业定位未确定。

## Product Purpose

Noema 是独立的个人 agent 应用。当前第一轮产品假设是：它为用户提供一个可持续交流的 Noema 核心伙伴，以及一组围绕专业实践形成、能跨聊天空间保持身份的 agent 好友。外部模型、harness 和工具服务这些个体，而不决定用户拥有的身份。

## Positioning

“Personal agent”已成为真实的产品类别，但 OpenAI Dots、Gemini Spark、Meta Muse 与开放 runtime 都在提供个人记忆、跨应用行动、长任务或多 agent 能力。Noema 不能仅定位为“更完整的个人助手”“多模型入口”或“连接更多 tools”。当前候选差异是：用户拥有一组持续的专业 agent 个体，能在私聊、Noema 协作和群聊中重复相处；Noema 管理身份与房间连续性，execution runtime 可以替换。这个候选定位由助手在用户委托范围内采用，尚未证明其独立价值；第一条真实产品切片和现有产品组合反证见 [ADR 0015](docs/decisions/0015-agent-friends-and-conversation-rooms.md) 与 [个人 Agent 产品版图](docs/research/personal-agent-landscape.md)。

## Operating Context

- 用户以中文交流，跨生活想法和编程等工作内容切换。
- Noema 应是用户自己的交互入口；外部模型、harness、agent 与工具可以被连接，但 Noema 不依附其中任一个。
- 当前 Windows 桌面主入口是好友/房间聊天：Noema 与一位工程搭档可分别私聊，也能进入同一群聊；工程搭档可在明确选择的房间与项目文件夹后承接一项 DSH 项目工作，任务状态回到原房间，聊天可继续。原来的根对话、DSH worker 与 Codex 快照功能保留在 `#legacy` 路径。该纵向切片尚未证明 Noema 已适合长期日用或具备独立市场价值。

## Capabilities and Constraints

- 独立应用和个人 agent 方向已确认。第一轮好友/房间切片按 ADR 0015 推进；好友创建、专业实践演化、主动性和最终视觉语言仍开放，并允许按真实使用继续调整。
- 用户已授权助手自主决定产品与技术细节、根据外部证据调整定位并从设计推进到真实实现；无需反复等待用户批准可逆决策，用户将主要参与最终核验。
- 首条好友/房间切片已实现为本地原型：一个主 Noema、一位工程搭档；双方独立私聊及共享群聊；群聊创建与每轮回应对象选择；身份跨房间复用、各 room transcript 隔离；用 FreeLLMAPI 实际生成回复。群聊 / 私聊尚未经历用户最终核验。
- 项目工作是聊天外的一种明确动作，不会从普通消息自动触发；首条切片复用 DSH Headless，任务身份和房间归属由 Noema 保存，DSH session 只是同一工作任务的可续接执行上下文。任务有独立状态、停止路径及文件级核验；无核验条件时只标为“未独立核验”。当前 DSH Windows 权限模型不提供完整读取、网络或进程隔离，文件夹选择页会如实披露，不能把本功能用于敏感目录。
- 社交数据使用独立的 SQLite schema migration：稳定 agent 身份、room membership 和消息；旧 root transcript 以来源 ID 幂等复制到 Noema 私聊，原表保留。首次社交迁移前保存一次本机 SQLite 一致性备份。新房间请求最多携带当前房间最近 40 条已完成 user/assistant 消息及目标 agent profile；不自动带入其他房间的记录。
- Noema 不应宣称模型具有真实意识或人类情感；“像伙伴”需要由真实互动表现和持续性建立，不靠拟人化文案声称。
- 已验证的旧版能力：FreeLLMAPI 根对话、用户选择工作区、后台 DSH 文件任务、停止/同 session 续接、系统事件回流与重启恢复。它们仍在 `#legacy` 路径；DSH 是可替换的执行适配器，不是 Noema 核心身份。
- M1 可撤回实验：Noema 可保存有用户原话来源的互动纠正；用户现在可以直接修订其情境/做法/范围，也可以撤回。初始模型归纳、用户当前版本和每次根回复 attempt / 后台任务当时带入的快照彼此区分；这只证明状态可被用户修正并追溯，不证明模型遵循或长期行为已改变。
- 后台 DSH 任务会在时间线保留最多 32 条工具操作类别及顺序；不记录工具参数、文件内容或返回值。它说明 agent 发起了什么类别的操作，不代表操作成功；成功与否仍以独立核验结果为准。
- 新增 M1 实验能力：只读列出并预览本机 Codex thread；用户选定后把有来源的可见文字快照附到唯一根对话，用户可移除。下一次把快照发到 FreeLLMAPI 前需单独确认。它不续接或修改 Codex thread，也不迁移 reasoning、工具轨迹或工作区状态。
- 新增 M1 互动纠正实验：用户可直接修订或撤回由明确纠正形成的互动状态。Noema 保留首次模型归纳、用户当前版本，以及每个根回复 attempt / 后台任务当时带入的值快照；这证明本地状态可纠正且历史不被重写，不证明模型收到、遵循或因其而改变。
- 尚未实现/证实：用户创建新 agent 身份、agent 实际的跨房间经验检索与专业实践演化、除工程搭档外的第二种专业好友，以及社交聊天模型是否能降低重复对齐成本并足以支持 Noema 独立存在。此次真实 FreeLLMAPI 合成对话通过 `auto:noema-free` 返回了指定标记；`free-router` 与直连 Nemotron 尽管模型目录当时显示 ready，实际请求未返回答案，随后 free-router 状态变为 exhausted。可用目录只代表最近状态，不代表每次生成成功。
- 当前产品范围及阶段门以 [项目工作流](docs/PROJECT_OPERATIONS.md) 与 GitHub Issue/Project 实时状态为准。

## Brand Commitments

- 名称：Noema。
- 基础语言：简体中文。
- 用户偏好动态、有表现力、布局精良的界面，反感粗糙的“AI 仪表盘/聊天套壳”观感。
- 尚无被用户确认的颜色、字体、视觉风格、图形隐喻或品牌资产。现有占位页不是已确认的设计系统。

## Evidence on Hand

- 用户明确描述了跨 AI 使用时身份/互动连续性和工作陪伴不足的个人动机，详见当前工作流与 M1 Issue。
- 公开案例、实现与反例持续记录在 [Issue #2](https://github.com/c3115644151/noema-agent/issues/2)、[经验成长研究](docs/research/experience-to-practice.md)和[personal-agent 产品版图](docs/research/personal-agent-landscape.md)；这些证据支持或削弱假设，但不自动成为用户逐项确认的规格。
- “同一好友，多房间上下文，三类连续性（事件、用户互动偏好、专业实践）”目前是 Noema 第一轮产品架构，不代表已验证这是完整或长期正确的定位；持续比较个人 agent 产品和实际产品使用效果。
- PR #18 验证的是一条从 Noema 发起的新 DSH 文件任务，不是从现有 Codex thread 迁移；它不代表用户的 Codex 额度耗尽痛点已被解决。
- Codex 快照路径已在隔离数据目录中用真实本机 App Server 完成列表、预览、导入、时间线回显和移除；真实用户会话内容未外传。另在临时根数据库中通过真实 FreeLLMAPI 路由测试了合成快照续接：`free-router` 与直连 Nemotron 返回 `provider_unavailable`，`auto:noema-free` 成功准确复述合成代号与验收标准。该结果证明数据路径可工作，但不能证明真实会话的继续质量、长期稳定性或 Noema 独立产品价值；真实用户快照仍需每个用户在应用内明确授权后才可发送。
- 目前没有来自 Noema 原型用户测试的证据；不得虚构已验证的体验或结果。
- 本轮好友/群聊截图和模型连接状态在 Electron 真实窗口以 1280×800 / 680×560 检查；隔离合成 E2E 验证通过聊天输入框 Enter 发送，并且不读取或改动真实 Noema 对话数据库。

## Product Principles

1. 将 Noema 作为持续存在的个人 agent 来设计，而不是某一外部 harness 的插件。
2. 把用户确认、外部事实、助手在生命周期授权内作出的决定和未验证假设分开记录。
3. 不从“AI 应该有灵魂”等愿景直接推导功能；通过真实使用场景和成熟实现形成可工作的闭环。
4. 把关系连续性视为候选产品价值，只有原型显示它确实改变后续互动时，才把它作为核心机制。
