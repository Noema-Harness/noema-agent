# Noema 架构边界

状态：第一轮社交 Agent 架构边界，实施依据见 [ADR 0015](decisions/0015-agent-friends-and-conversation-rooms.md)。用户已授权助手自行选择产品与技术方案，并在真实开发/使用中调整定位。旧根对话/后台 worker 是可复用的执行原型，不是目标产品结构。

## 系统职责

Noema 运行在用户设备上，是用户侧 agent 身份、聊天空间和跨运行时连续性的 owner。外部模型、harness 和工具为可替换的执行能力；它们不定义 Noema 好友身份，也不独占用户状态。

第一轮产品模型：Noema 与专业好友各自有持续身份；用户私聊、Noema 与好友的协作、群聊是不同 room/context，不自动等于不同 agent，也不应被无差别压进同一模型窗口。同一好友可作为同一身份参加多个房间；每次模型调用默认只得到当前房间 transcript 与必要 profile/practice，不会因为身份相同而收到所有其他房间原文。

近期外部评测进一步表明，跨空间“能取回”与“有权披露”不能合并为一次模型判断：即使回答模型拿到正确记忆证据，也可能在不应披露时泄漏。Noema 的未来方案必须显式区分房间来源/访问范围、当前上下文使用范围与最终答复的披露；不能仅靠相同 agent 身份、同一用户账户或提示词来授权共享。此为研究证据支持的待设计约束，具体权限模型仍未定。来源见[经验到专业实践研究记录](research/experience-to-practice.md)。

初期采用桌面端模块化单体：一个应用进程边界内组织领域模块，提供本地存储、对话和能力连接。独立子进程只用于需要故障隔离或权限隔离的 harness/connector；当前不拆微服务。

## 逻辑边界

### 交互层

联系人/agent roster、私聊、群聊、房间成员、消息时间线和可见的运行/交付状态。界面让用户像聊天一样选择交流对象，不要求先理解 harness、agent loop 或 memory backend；不得把根对话藏进通用任务控制台。

### Agent Identity 与 Room Context

Noema 持有 agent 的稳定 identity、专业范围、用户关系偏好和当前有效 practice；room 持有自己的参与者、transcript 与协作上下文。Agent id 不等于 runtime session id。Room transcript 不因同一 agent 身份自动合并。

### Agent Runtime

在当前房间将消息交给直接模型或外部 harness，接收真实回复和运行事件，并记录 runtime 来源/失败状态。Adapter 可替换；执行进度属于房间交互，不应被伪装成后台已经完成。

### Room-scoped Actions

Noema 私聊是默认入口。普通交流、探索、写作和一般计划留在聊天；只有实际存在且适配的能力才形成独立执行状态。模型不能直接操作文件，文件工作必须经过本机服务的权限检查和用户工作区选择。`social_work_tasks` 是当前项目执行状态的唯一来源，记录来源 room、真实执行者、原始范围、workspace、runtime/session、结果和独立核验；它不复用 legacy root 的 `background_tasks`，也不把 DSH session 当作好友身份。任务卡贴近来源请求呈现执行者、范围、状态、失败/停止和核验；普通讨论不会制造任务状态。交互基线见 [ADR 0026](decisions/0026-noema-first-chat-and-visible-actions.md)。

首轮使用已有 DSH Headless adapter：新任务使用干净 session，只有受限限流续接才复用该任务的 session；不同任务和 room 不共用 DSH transcript。当前服务仅对明确传入的文件条件调用 `workspace-verifier`，不把 DSH final 当作核验通过。应用关闭会停止受管进程，仍在执行的任务在下次启动时记为中断，不自动重跑。

运行时关闭 web、subagent 与 background jobs；前台 PowerShell 使用 DSH 自带 workspace-write sandbox，以支持工程项目检查。该沙箱的边界主要是文件写入，不能限制网络或进程可见性，并不完整隔离 Windows 上的读取。选择目录前必须显示这一事实、第三方模型数据流与停止不回滚提醒；首条真实 E2E 仅操作 scratch workspace。不得将当前实现宣传成安全沙箱或作为访问含密钥/私人文件目录的理由。持久取舍见 [ADR 0016](decisions/0016-room-scoped-project-work.md)。

### Experience 与 Practice

房间事件、用户明确的互动偏好和好友专业实践变化是不同状态。事件保存来源/room；偏好服务于这位用户如何与 agent 配合；专业实践须以相关工作证据支持。首轮不自动把模型总结提升成永久方法，历史材料按需检索，不全量注入 prompt。

### Sources 与 Capabilities

- **Source connector**：读取外部内容/事件，归一化为带来源、时间、范围、可信标记的输入；默认不执行外部写操作。
- **Action tool**：对应用执行有范围的读取或写入，权限以能力为单位，不因为它在 agent 列表中就获得任意系统权限。
- **Harness adapter**：连接外部专业 agent，传递明确的任务/必要上下文，并接收状态与结果；Noema 保留自己的用户连续性，不要求外部 transcript 可被完全改写。
- **Skill/procedure**：可复用的操作知识，不等同于连接器、工具权限或用户长期事实。

输入连接与行动权限必须分离。外部网页、视频、评论和工具输出默认是内容证据，不是能修改 Noema 系统规则的指令。

## 首条社交聊天切片的实现边界

- 桌面主入口读取 `social_agents`、`social_rooms`、`social_room_members` 与 `social_messages`；用户可显式创建 specialist identity，创建只写入本机且默认无工具能力；归档保留身份与历史但停止新回复/新任务。旧 root/worker 功能仍可从 `#legacy` 打开，不再决定主界面结构。
- 社交表使用独立的 `social_schema_migrations` 版本线（当前 v4），与旧根对话 schema 分离。首次升级前，用 SQLite backup API 创建一次本地快照 `noema-before-social-chat-v1.sqlite3`；旧 root messages 以 `legacy_source_id` 幂等复制，原始行不会改写或删除。
- 当前首个稳定 identity 是 `noema` 与 `engineering-partner`。同一 friend id 可进入 DM 和 group；每次模型请求只组装该房间最近 40 条已完成用户/助手消息和目标 agent 的 profile prompt。system event 和其它 room transcript 不自动作为模型上下文。
- 社交 renderer 的 IPC 状态只暴露联系人、房间与模型连接信息，不把旧 root transcript、captures、后台任务记录随新社交 UI 一并发送。
- 群聊消息必须带本轮 `agentId`，一个房间一次只允许一条生成中的回复；运行时支持停止、失败消息保留及失败/中断后原位重试。Noema 主体与专业好友现在共享已选择的 FreeLLMAPI 路由；未连接可用模型时不伪造回复。当前 renderer 仍保留联系人与模式选择；这是待按 ADR 0026 逐步收敛的实现状态，不是目标交互。
- 这个切片没有实现用户自建/编辑 agent、跨房间 recall、自动实践晋升或工作工具权限。旧根对话里的 captures、workers、Codex import 与 interaction adjustments 仍保留在 legacy 面；它们尚未迁入社交领域对象。
- 首次迁移的备份与复制都在用户设备本地。聊天消息会通过本机 FreeLLMAPI 发送到所选模型/路由；Noema 的当前房间隔离不是上游服务数据隔离。

## 记忆演化边界

`Experience` 保存具体发生过什么；`Understanding` 保存当前可变的概括及证据；`Preference/Commitment` 保存用户明确表达的持续约束；`Procedure/Capability` 保存如何执行以及经何种测试启用。某事件可以支持一个理解，但不能静默覆盖用户明确偏好或系统权限。

记忆合并或提升必须保留来源、作用范围、有效状态和撤回/修正路径。每轮上下文由当前对话、相关的少量当前理解及按需检索的经历构成，不是整个记忆目录。

## 依赖与演进

先通过内部接口把存储、模型供应商、输入连接器、行动工具和 harness adapter 分开，不等于立刻建立独立 package/API。只有当一个边界有不同的生命周期、权限、替换频率或测试责任时才抽离。

跨越数据格式、记忆迁移、权限、harness 兼容或应用分层的决定必须有 ADR。机械实现和局部 UI 不需要为了形式创建 ADR。
