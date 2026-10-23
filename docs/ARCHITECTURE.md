# Noema 架构边界

状态：重建中的模块化单体。当前目标职责见 [ADR 0029](decisions/0029-persistent-agents-and-project-sessions.md)，交付阶段见 [总规划 #109](https://github.com/c3115644151/noema-agent/issues/109)。本文分别说明目标和当前代码，不把已接受的设计写成已实现能力。旧根对话/后台 worker 是可复用实现，不是目标产品结构。

## 系统职责

Noema 运行在用户设备上，是用户侧 agent 身份、聊天空间和跨运行时连续性的 owner。外部模型、harness 和工具为可替换的执行能力；它们不定义 Noema 好友身份，也不独占用户状态。

目标模型：Noema 保持唯一连续主会话；专业成员拥有持续身份、常驻会话与隔离的项目会话。群组是共享交流/项目空间，不是全部成员共用的执行上下文。内部报告与用户可见消息分开投影，成员自己的资产与权限分开管理。当前代码仍以 room 组装模型上下文，项目会话、内部投递和自有执行循环尚待逐步接入；不能把现有群聊当成已经实现团队协作。

近期外部评测进一步表明，跨空间“能取回”与“有权披露”不能合并为一次模型判断：即使回答模型拿到正确记忆证据，也可能在不应披露时泄漏。Noema 的未来方案必须显式区分房间来源/访问范围、当前上下文使用范围与最终答复的披露；不能仅靠相同 agent 身份、同一用户账户或提示词来授权共享。此为研究证据支持的待设计约束，具体权限模型仍未定。来源见[经验到专业实践研究记录](research/experience-to-practice.md)。

初期采用桌面端模块化单体：一个应用进程边界内组织领域模块，提供本地存储、对话和能力连接。独立子进程只用于需要故障隔离或权限隔离的 harness/connector；当前不拆微服务。

## 逻辑边界

### 交互层

联系人/agent roster、私聊、群聊、房间成员、消息时间线和可见的运行/交付状态。界面让用户像聊天一样选择交流对象，不要求先理解 harness、agent loop 或 memory backend；不得把根对话藏进通用任务控制台。

### Agent Identity 与 Room Context

Noema 持有 agent 的稳定 identity、专业范围、用户关系偏好和当前有效 practice；room 持有自己的参与者、transcript 与协作上下文。Agent id 不等于 runtime session id。Room transcript 不因同一 agent 身份自动合并。

### Agent Runtime

目标是应用自有、可替换的模型/工具执行循环，单会话一次一个活动循环，记录执行意图、取消代际、实际结果与恢复点。当前聊天使用直接模型，文件任务仍使用 DSH adapter；外部 harness 不再是产品永久依赖。执行进度不能被伪装成后台已经完成。

### Room-scoped Actions

Noema 私聊是默认入口。普通交流、探索、写作和一般计划留在聊天；只有实际存在且适配的能力才形成独立执行状态。模型不能直接操作文件，文件工作必须经过本机服务的权限检查和用户工作区选择。`social_work_tasks` 是当前项目执行状态的唯一来源，记录来源 room、真实执行者、原始范围、workspace、runtime/session、结果和独立核验；它不复用 legacy root 的 `background_tasks`，也不把 DSH session 当作好友身份。任务卡贴近来源请求呈现执行者、范围、状态、失败/停止和核验；普通讨论不会制造任务状态。交互基线见 [ADR 0026](decisions/0026-noema-first-chat-and-visible-actions.md)。

首轮使用已有 DSH Headless adapter：新任务使用干净 session，只有受限限流续接才复用该任务的 session；不同任务和 room 不共用 DSH transcript。当前服务仅对明确传入的文件条件调用 `workspace-verifier`，不把 DSH final 当作核验通过。应用关闭会停止受管进程，仍在执行的任务在下次启动时记为中断，不自动重跑。

运行时关闭 web、subagent 与 background jobs；前台 PowerShell 使用 DSH 自带 workspace-write sandbox，以支持工程项目检查。该沙箱的边界主要是文件写入，不能限制网络或进程可见性，并不完整隔离 Windows 上的读取。选择目录前必须显示这一事实、第三方模型数据流与停止不回滚提醒；首条真实 E2E 仅操作 scratch workspace。不得将当前实现宣传成安全沙箱或作为访问含密钥/私人文件目录的理由。持久取舍见 [ADR 0016](decisions/0016-room-scoped-project-work.md)。

### Experience 与 Practice

房间事件、用户明确的互动偏好和好友专业实践变化是不同状态。事件保存来源/room；偏好服务于这位用户如何与 agent 配合；专业实践须以相关工作证据支持。首轮不自动把模型总结提升成永久方法，历史材料按需检索，不全量注入 prompt。

### Sources 与 Capabilities

- **Source connector**：读取外部内容/事件，归一化为带来源、时间、范围、可信标记的输入；默认不执行外部写操作。
- **Action tool**：对应用执行有范围的读取或写入，权限以能力为单位，不因为它在 agent 列表中就获得任意系统权限。
- **Harness adapter**：兼容外部执行器的可选边界；身份、会话、报告和用户连续性由 Noema 自己保存，不由 adapter 定义。
- **Skill/procedure**：可复用的操作知识，不等同于连接器、工具权限或用户长期事实。

输入连接与行动权限必须分离。外部网页、视频、评论和工具输出默认是内容证据，不是能修改 Noema 系统规则的指令。

## 当前代码的实现边界

- 桌面主入口读取 `social_agents`、`social_rooms`、`social_room_members` 与 `social_messages`；用户可显式创建 specialist identity，创建只写入本机且默认无工具能力；归档保留身份与历史但停止新回复/新任务。旧 root/worker 功能仍可从 `#legacy` 打开，不再决定主界面结构。
- 社交表使用独立的 `social_schema_migrations` 版本线（当前 v11，版本常量在 `social-chat-schema.mjs`），与旧根对话 schema 分离。待升级前用 SQLite backup API 创建版本快照，校验内容与版本、封成无 WAL 依赖的独立文件，再原子发布；首轮原有 `noema-before-social-chat-v1.sqlite3` 保留。备份失败不继续迁移，不完整旧快照保留诊断副本后重建。旧 root messages 以 `legacy_source_id` 幂等复制，原始行不改写或删除。
- 新安装仅初始化 `noema` 与 `room-noema`；旧安装中的工程搭档、群和历史保留，关闭的能力不会在启动时重新启用。工程团队样例只在 `test-support/social-team.mjs` 显式生成。当前每次模型请求组装房间最近 40 条已完成消息及必要 profile；此硬上限是待演进实现，不是完整上下文工程方案。system event 与其他房间原文不自动注入。
- 社交 renderer 的 IPC 状态只暴露联系人、房间与模型连接信息，不把旧 root transcript、captures、后台任务记录随新社交 UI 一并发送。
- 群聊消息必须带本轮 `agentId`，一个房间一次只允许一条生成中的回复；运行时支持停止、失败消息保留及失败/中断后原位重试。Noema 主体与专业好友现在共享已选择的 FreeLLMAPI 路由；未连接可用模型时不伪造回复。当前 renderer 仍保留联系人与模式选择；这是待按 ADR 0026 逐步收敛的实现状态，不是目标交互。
- 已实现专业成员创建/改资料/归档、显式项目文件能力、带来源转发、搜索、Noema 范围内有界历史查找与明确互动约定；已有一次知识子委派和受限 DSH 项目核验/经验试用。它们不等于自有工具循环、多成员项目调度、通用长期记忆或成员自有资产成长。captures、旧 workers 和 Codex 导入仍可从 legacy 访问。旧主题会话保留兼容，目标方向不再新增独立 Noema 主上下文。
- 首次迁移的备份与复制都在用户设备本地。聊天消息会通过本机 FreeLLMAPI 发送到所选模型/路由；Noema 的当前房间隔离不是上游服务数据隔离。

## 记忆演化边界

`Experience` 保存具体发生过什么；`Understanding` 保存当前可变的概括及证据；`Preference/Commitment` 保存用户明确表达的持续约束；`Procedure/Capability` 保存如何执行以及经何种测试启用。某事件可以支持一个理解，但不能静默覆盖用户明确偏好或系统权限。

记忆合并或提升必须保留来源、作用范围、有效状态和撤回/修正路径。每轮上下文由当前对话、相关的少量当前理解及按需检索的经历构成，不是整个记忆目录。

## 依赖与演进

先通过内部接口把存储、模型供应商、输入连接器、行动工具和 harness adapter 分开，不等于立刻建立独立 package/API。只有当一个边界有不同的生命周期、权限、替换频率或测试责任时才抽离。

跨越数据格式、记忆迁移、权限、harness 兼容或应用分层的决定必须有 ADR。机械实现和局部 UI 不需要为了形式创建 ADR。
