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

### Experience 与 Practice

房间事件、用户明确的互动偏好和好友专业实践变化是不同状态。事件保存来源/room；偏好服务于这位用户如何与 agent 配合；专业实践须以相关工作证据支持。首轮不自动把模型总结提升成永久方法，历史材料按需检索，不全量注入 prompt。

### Sources 与 Capabilities

- **Source connector**：读取外部内容/事件，归一化为带来源、时间、范围、可信标记的输入；默认不执行外部写操作。
- **Action tool**：对应用执行有范围的读取或写入，权限以能力为单位，不因为它在 agent 列表中就获得任意系统权限。
- **Harness adapter**：连接外部专业 agent，传递明确的任务/必要上下文，并接收状态与结果；Noema 保留自己的用户连续性，不要求外部 transcript 可被完全改写。
- **Skill/procedure**：可复用的操作知识，不等同于连接器、工具权限或用户长期事实。

输入连接与行动权限必须分离。外部网页、视频、评论和工具输出默认是内容证据，不是能修改 Noema 系统规则的指令。

## 记忆演化边界

`Experience` 保存具体发生过什么；`Understanding` 保存当前可变的概括及证据；`Preference/Commitment` 保存用户明确表达的持续约束；`Procedure/Capability` 保存如何执行以及经何种测试启用。某事件可以支持一个理解，但不能静默覆盖用户明确偏好或系统权限。

记忆合并或提升必须保留来源、作用范围、有效状态和撤回/修正路径。每轮上下文由当前对话、相关的少量当前理解及按需检索的经历构成，不是整个记忆目录。

## 依赖与演进

先通过内部接口把存储、模型供应商、输入连接器、行动工具和 harness adapter 分开，不等于立刻建立独立 package/API。只有当一个边界有不同的生命周期、权限、替换频率或测试责任时才抽离。

跨越数据格式、记忆迁移、权限、harness 兼容或应用分层的决定必须有 ADR。机械实现和局部 UI 不需要为了形式创建 ADR。
