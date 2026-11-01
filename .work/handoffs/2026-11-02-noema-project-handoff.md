# Noema 项目交接

日期：2026-11-02

交接对象：下一位 Noema 项目负责人

交接范围：接管整体规划与后续开发；不把本交接文档当成产品规格。

## 交接结论

用户要求把项目从“依据当前代码和局部待办连续挑小功能”的推进方式，切换为“先从成熟 agent 应用的实际实现建立完整能力图，再据此规划和逐模块开发”。此前的 R0–R5 阶段顺序和 T-01–T-11 测试列表已从当前路线中移除；新入口是 [docs/ROADMAP.md](../../docs/ROADMAP.md)。不要将旧 Issue、旧 Project 看板、旧路线或最近的 OpenSpec 变更重新当成主线。

下一步优先交付领域源码盘点、Noema 全能力差距图和新的分阶段路线。完成之前，不要因为手边有一个可做的代码缺口，就自动把它提升为下个产品模块。

## 当前代码现场

- 分支：`codex/shared-project-plan`
- HEAD：`2e2dc4b feat(followups): navigate to reminder source`
- `origin/codex/shared-project-plan` 在前一个提交 `b9e84df`；本次交接后尚未提交或推送新改动。
- 交接开始前的现场快照：`apps/desktop/src/main/chat/social-chat-store.mjs` 有聊天历史分页的存储层部分改动；`openspec/changes/bounded-chat-history/` 是对应的未完成 change。两者都未完成、未验证，仍留在当前工作区供接手者判断。
- 本次交接把旧的 `docs/ROADMAP.md` 替换为源码调研驱动的规划入口，并在 `.work/README.md` 登记了交接材料的生命周期；文档检查通过。该文档交接提交不包含上述未完成代码或 change。
- 聊天分页实现存在已知风险，不能把它当成可交付：存储层 `getRoomMessageWindow` 尚未接入 IPC、preload、共享类型和 renderer；查询边界及空页绑定仍需复核。后续负责人先根据新领域盘点决定该功能应纳入哪个阶段，再决定续做或搁置；不要无条件接着扩大改动。
- 最近已完成的产品切片是提醒通知跳回来源消息（`2e2dc4b`）。不要再次在 GitHub #116 写进度或验收评论。此前发生过一次错误同步；本地 `noema-project-work` 技能、`docs/PROJECT_OPERATIONS.md` 与本次新路线均说明 GitHub 不承担内部计划。

## 规划边界

- 用户最近明确要求：先从各大 agent 应用出发做深入源码研究，以完整领域视野确定功能范围和成熟度；再进行针对性源码对照，逐模块推进，优先复用可靠实现，避免在现有 Noema 功能附近循环微调。
- GitHub 保留源码、PR、发行和外部协作问题；内部计划、阶段和测试清单只留在本地路线与 OpenSpec，不用 GitHub Issues 或 Project 做内部任务管理。
- 现有持久约束仍可参考：[产品章程](../../docs/PRODUCT_CHARTER.md)、[架构入口](../../docs/ARCHITECTURE.md)、[逻辑流程图](../../docs/design/noema-core-flows.md)、[项目维护约定](../../docs/PROJECT_OPERATIONS.md)。它们描述产品边界和已有职责，不构成完整能力地图。需据代码和新证据校正，不能把过去讨论的机制链误当成全部产品。
- [OpenSpec 当前基线](../../openspec/specs/)记录已有可观察行为；`openspec/changes/archive/` 和 ADR 是历史。变更归档不是产品已经成熟的证明。
- 用户此前要求：Noema 完整落地后由用户统一做真实长测；助手准备可追踪日志与短时定向检查，不擅自反复跑长测。该要求留作验证责任划分，待新路线形成后整合，不能把旧测试表原样搬回当前计划。

## 失败复盘：为什么一直在局部打转

**已观察到的模式：** 过去很长一段时间，工作多次围绕局部前端细节、计划模型、沙箱、成本、历史加载等近邻问题反复迭代；过程记录与局部测试增加了，但用户看到的完整产品能力和阶段进度并未同步增长。用户多次指出助手从现有实现中挑容易动手的缺口，把微小工程判断复杂化，缺少成熟 agent 应用的全景对照，也没有在一个模块完成后及时转场。

**本次可确认的直接原因：** 当前旧路线先以 Noema 自己已经有的功能和积压验收项为目录，再从中选下一件局部工作。这样的输入天然看不到尚未建模的领域基础功能。OpenSpec 对单个变更的设计、任务和验证是有用的，但它本身不负责发现产品完整能力面；缺少全景清单时，它会把局部范围管理得更清楚，却不能保证路线完整。上一轮又从 `getRoomSnapshot` “返回整段记录”这个现存代码缺口直接提出聊天分页，进一步重复了从代码近邻倒推产品优先级的倾向。

**需要验证的更深层判断：** 维护材料、评审与测试并非问题本身；问题是没有让它们受全局能力地图约束，结果出现了精细管理小范围、却未覆盖产品整体的失衡。新负责人应以外部源码证据验证这个判断，而不是再写一份提示词宣称已经解决。

## 下一阶段建议

### 1. 广泛扫描并筛选真实参考实现

建立候选集，按产品形态和源码质量筛选，不要只盯一个项目。可从以下公开仓库开始核实当前维护状态、许可证和源码入口：

- OpenAI Codex：`https://github.com/openai/codex`
- Goose：`https://github.com/block/goose`
- OpenHands：`https://github.com/All-Hands-AI/OpenHands`
- OpenCode：`https://github.com/anomalyco/opencode`
- Cline：`https://github.com/cline/cline`
- Aider：`https://github.com/Aider-AI/aider`
- Continue：`https://github.com/continuedev/continue`

这些只是候选来源，不代表本轮已完成审核或认可其整体架构。Claude Code、Cursor 等若没有可检查的源码，只能对照官方公开契约和实际体验，明确标注证据等级，不能说成源码级比较。尽量以 release/tag 固定版本，记录 commit SHA 和调研日期，避免引用浮动的 `main` 造成不可复核。

### 2. 做源码级能力矩阵，不做功能名清单

对每个纳入的项目按共同维度查看：会话/上下文生命周期、工具调用循环、权限/批准、停止与恢复、工作区文件和终端、模型/provider、搜索与来源、并发/子 agent、持久状态与迁移、计划/任务、用户设置与凭据、日志/成本、通知/自动化、安装升级、失败处理和测试分层。每项至少记录：具体源码路径、关键状态/边界、可观察契约、失败恢复、测试位置、许可证、Noema 可直接复用什么及不可照搬原因。

比较应以成熟实现检验 Noema 的覆盖，不以现有 Noema 目录作为比较目录；也不要把外部项目“有一个功能”推断为做得成熟。引用原仓库的具体版本和代码位置。

### 3. 用矩阵建立 Noema 全景，再拆阶段

先列出 agent 产品共同基础设施，再列 Noema 已确认的独特责任（个人 agent 身份与连续性、主聊与执行层解耦、持久专业成员、协作及成长等），逐项标注完整/部分/缺失/不适用及证据。不要把独特机制放在基础能力缺口前面，也不要把 Noema 当前的工程实现当作产品边界。

路线分阶段时，阶段应代表一段可运行、可交付的能力闭环，而不是一个文件、一类缺陷或一串附近任务。明确阶段间依赖、可独立交付的结果、成熟度定义和验证。最终阶段全景应同时有广度与平衡度，避免一项功能打磨过深、其他基础模块为空。

### 4. 返回代码时只接入一个明确模块

新路线形成后，选择优先级最高、依赖已经满足的单个模块，用相应 OpenSpec change 记录行为与实现；先看参考实现的状态所有权、失败边界、用户体验和测试，再决定 glue/reuse/adapt/implement。若重新评估后聊天分页不在近期阶段，可保留本地草稿或删除，不要为了“已有代码”而继续。

## 可直接打开的项目入口

- 当前路线与重规划退出条件：[docs/ROADMAP.md](../../docs/ROADMAP.md)
- 产品边界：[docs/PRODUCT_CHARTER.md](../../docs/PRODUCT_CHARTER.md)
- 运行边界和代码导航：[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- 人类可读逻辑图：[docs/design/noema-core-flows.md](../../docs/design/noema-core-flows.md)
- 当前文档路由：[.codex/workspace.json](../../.codex/workspace.json)
- 维护和 OpenSpec 分工：[docs/PROJECT_OPERATIONS.md](../../docs/PROJECT_OPERATIONS.md)
- 项目衔接技能：[.codex/skills/noema-project-work/SKILL.md](../../.codex/skills/noema-project-work/SKILL.md)

## 交接完成条件

下一位负责人读完本页后，应先核对 Git 状态和以上当前入口，再做源码调查与路线重建；不得从旧 Issue 或本交接中的候选项目清单直接启动某个功能。领域矩阵和阶段路线可供用户一次性审阅，之后按阶段推进；正常工程取舍不逐项请求用户确认，只有产品方向和重大价值取舍才带着具体证据请用户把关。
