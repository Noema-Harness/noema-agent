# ARCHITECTURE

Authority: 本文件是 Noema 当前系统结构、目标结构、模块职责、数据边界和代码地图的唯一权威来源。
Update when: 模块边界、进程/依赖方向、数据库 schema、执行路径、外部运行时或代码地图变化。
Does not own: 产品定义与用户可观察行为（见 [PRODUCT](PRODUCT.md)）；长期决定的理由（见 [DECISIONS](DECISIONS.md)）；当前版本、测试和交付状态（见 [STATUS](STATUS.md)）；开发/发布命令（见 [OPERATIONS](OPERATIONS.md)）；维护规则（见 [AGENTS](../AGENTS.md)）。

## 1. 结构原则

Noema 是一个本地 Electron 应用，不是把所有能力塞进一个进程的单体。结构服从三条边界：

- **身份与执行分离**：Noema 拥有长期记忆、判断和最终责任；执行者拥有工作会话、工具和工作区。执行结果回到 Noema，但执行者的工作过程不被伪装成 Noema 的第二人格。
- **渲染与事实分离**：renderer 只持有视图状态；main 拥有业务编排、持久化和执行；shared 只放跨进程契约。renderer 不直接访问数据库或执行命令。
- **写入与证据分离**：Noema 不直接写文件；所有写入经过工单、工作区身份和命令/文件工具，结果与证据回到任务记录和对话。模型自述不构成证据。

## 2. 进程与依赖方向

```text
renderer (React)
  -> shared contracts
  -> preload (contextBridge)
  -> main IPC
  -> main services
  -> stores / adapters / work runtime
  -> SQLite / Windows Runner / DSH
```

- `shared` 不反向导入 `main`/`preload`；`main` 不导入 `renderer`。
- IPC handler 只解析参数、调用 service、返回结果；业务判断在 main service。
- store 只做持久化、事务和映射；service 只编排用例；adapter 只封装外部进程/API。
- 外部运行时（DSH、Windows Runner、模型服务）通过适配层进入；产品对象、工单、工作区和证据不随运行时改变。

## 3. 组织对象与会话拓扑

产品对象定义见 [PRODUCT](PRODUCT.md)；这里只记录结构关系。

### 3.1 AgentRuntime 核心

所有 Agent 都由同一个 `AgentRuntime` 承载，Noema、执行者、专业联系人、管理 Agent 不是不同类。核心只回答“一个个体如何独立存在、被授权、留下证据”，不包含岗位库、团队、项目、六模块或 UI 的业务逻辑。

不可变核心（运行时不可被岗位/模板静默改写，只能显式迁移）：

| 核心项 | 内容 |
| --- | --- |
| 身份与生命周期 | 稳定 `agentId`、创建/招募/暂停/归档状态、模板来源和版本 |
| 个体环境 | 私有会话/上下文、记忆命名空间、Agent Home、工作区绑定 |
| 授权边界 | 工具授权、工作区/网络范围、默认拒绝和审批规则 |
| 事件日志 | 追加式、有序的个体事件流；动作、命令、文件、结果、证据都可追溯 |
| 运行时契约 | 模型/运行时适配接口、工具调用、取消、恢复和错误边界 |
| 证据与来源 | 结果指向事件、文件、命令和模板版本，不依赖聊天文案 |

分层：不可变核心 → 岗位模板层（岗位提示词、默认工具/技能、评估、UI 元数据）→ 个体层（记忆、会话、工作区、用户覆盖）。官方模板更新只改模板层；个体数据和身份不被覆盖。

耦合约束：`AgentRuntime` 不导入岗位库、团队、项目、六模块或 renderer；这些层组合核心，反向依赖禁止。核心以显式 schema 版本迁移，不做静默重写。

- **Noema**：一个常驻会话；唯一对用户负责的实体。Noema 不加入团队或项目。
- **执行者（Executor）**：一个岗位/身份对应一个执行者；一条常驻会话。私聊与团队空间都对接这条会话。
- **项目 fork**：项目创建后，参与执行者（含团队负责人）从各自最新常驻会话 fork 项目会话；团队负责人保留常驻会话做组合管理。项目结束归档项目会话，整体复盘后回到常驻线。
- **团队**：长期能力器官；有共享上下文（讨论、决定、交付记录），但不为每个成员复制第三条会话。
- **项目**：临时输出与固定工作区；有项目负责人、计划、工作项、证据和验收。一个团队 MVP 阶段同时只推进一个项目。
- **岗位库**：隐藏的岗位模板库，不是独立人格；一个现实岗位对应一个模板，招募出个体后保留模板来源/版本，不按人数复制同一模板。
- **团队负责人**：团队内的头衔，不是岗位库条目；一个管理 Agent 可以同时负责多个团队，团队权限与章程按团队单独授予。
- **工单**：一次执行的工作单元；有承接人、目标、工作区、步骤、文件变更和结果。工单不是用户维护的任务卡。

当前实现仍是旧 `room/branch` 结构：用户看不到执行者常驻私聊，项目 fork、团队共享上下文、岗位库和项目负责人尚未落地。目标结构不是现状。

### 3.2 当前实现（阶段 1）

- `apps/desktop/src/main/agents/agent-runtime-core.mjs` 提供最小不可变核心：`agentId`、角色、Agent Home、工作区、记忆/会话命名空间、工具授权、运行时适配器、追加式 JSONL 事件日志（`<Agent Home>/events.jsonl`）。事件只有 append/read，没有更新或删除。
- `createAgentRuntimePair` 在 `userData/agents/noema` 和 `userData/agents/noema-executor/workspace` 创建两个独立个体环境；测试覆盖隔离、持久化、序号恢复、并发追加和非法输入。
- 当前只有 Noema 主对话接入运行时事件：`SocialChatService` 在 `turn.started/completed/failed/interrupted` 写入 Noema 的日志；读取失败只记录诊断，不影响回复。Core Chat 不经过 `RootAgent`，`RootAgent` 上的旧事件桥不再作为当前路径。
- Noema 自身工具调用通过 `chat-trace` 内联在回复下方；普通回答没有工具时不显示轨迹。工具调用和结果以 `stepId` 成对保存，渲染层不把结果覆盖掉调用。
- 仍有限制：执行者实际执行仍由 `SocialWorkService`/DSH 承担，执行者核心已创建但还没有自己的运行事件；岗位库、团队、项目、Git 历史、六模块均未实现。

## 4. 六模块与能力

Noema 和执行者共用同一套个体结构：

| 模块 | 职责 |
| --- | --- |
| Core | 身份、目标、工作循环、回合与状态 |
| Policy | 权限、授权、风险与拒绝规则 |
| Competence | 能力条目；可执行、可检查、可回滚 |
| Tool Grants | 工具注册、授权范围、调用网关 |
| Memory | 长期记忆、来源、冲突、过期与用户编辑 |
| Context | 当前回合的上下文组装、预算和连续性摘要 |

- **Context Compiler** 是组装过程，不是第七个模块；它把目标、状态、记忆、文件、工具和最近对话编译成一次调用的上下文。
- **CapabilityUnit** 是 Competence 的最小可执行单位；岗位包、团队和项目是组织层组合，不进入个体内部。
- 六模块是目标架构；当前 0.7.2 仍以提示词、工具和旧 room/branch 为主，ContextCompiler、Memory Store、ModuleHost 热重载未交付。

## 5. 一次执行的路径

```text
用户消息
  -> Core Chat / SocialChatService
  -> 回合编排、上下文组装
  -> 模型调用
  -> 直接回答（无工单）
     或工具调用（只读/搜索/工单）
  -> 工单交给执行者/工作服务
  -> 执行者会话 + 工作区
  -> 命令/文件工具 + 运行时
  -> 文件变更、命令输出、验证结果
  -> 任务记录 + 对话回执
```

- 普通回答不建工单，不显示假轨迹。
- Noema 自身工具调用按 `stepId` 内联显示调用和结果；没有工具调用时不显示轨迹。
- 需要执行时，Noema 说明承接人、目标、工作区和当前状态；工单受理是异步的。
- 执行者完成后，任务记录保存路径、文件变更、命令输出和未验证项；主对话只显示 Noema 的回复和一条完成事件，不复制执行者全文。
- 任务完成/失败/中断时生成一条内联事件；事件可打开执行者任务详情。事件不是第二条助手回复。
- 编辑采用单一 HEAD：用户消息编辑截断该消息及之后的对话后重发；助手消息编辑原位更新正文，不重发，并使该房间的运行时会话失效，下一轮重新读取完整历史。分支表只作兼容/检查点，不在产品界面暴露。

## 6. 代码地图

```text
apps/desktop/src/main/
  main.ts                    启动、服务装配、窗口/托盘、IPC 组合
  app/                       窗口、social-runtime、agent、provider、runner、smoke/e2e 模块
  ipc/                       root IPC 参数解析与转发
  chat/                      Core Chat 回合、social chat service、store、连续性
  agents/                    AgentRuntime 核心、事件日志；RootAgent 为旧路径
  projects/                  项目、团队、岗位/成员、计划与验收
  execution/                 SocialWorkService、work runtime、DSH/native、Windows Runner
  models/                    模型 provider 与工具协议
  stores/                    SQLite/root/social/project stores
  platform/                  workspace identity、ACL、平台适配
apps/desktop/src/preload/    contextBridge API
apps/desktop/src/renderer/
  chat/core-chat-app.tsx     当前唯一挂载的对话界面
  chat/use-social-chat-controller.tsx  会话/发送/任务/编辑状态
  chat/turn-trace.tsx        回合工具轨迹
  chat/messages.tsx          消息与操作
  styles/index.css           当前核心界面样式
apps/desktop/src/shared/     跨进程契约与 bridge 类型
```

`main.ts` 仍是启动与组合根；main 下 7 个 `app/`/`testing/` 模块，约 1,303 行。旧 `social-chat-app.tsx`/`workspaces.tsx` 已不再挂载；七个 renderer 模块列入 STATUS 的 dormant registry。不要因为“零引用”直接删除，恢复需要真实入口和验收。

## 7. 数据与持久化

SQLite 是主要产品事实源；`.work/` 只放过程材料。Agent 个体事件日志是每个 Agent Home 下的追加式 JSONL，用于个体运行审计，不替代工单/消息事实表。

- `social_messages`、`social_rooms`、`social_agents`：对话、房间、Agent 身份。
- `social_projects`、`social_work_tasks`、`social_work_execution_steps`：项目、工单、执行步骤。
- `social_work_file_changes`、`file_change_operations`、`command_batches`：文件与命令证据（当前部分场景为空）。
- `conversation_branches`、`conversation_turns`、`conversation_active_branch`：连续时间线/检查点（schema 38）；当前产品路径只保留单一可见时间线，分支不暴露。
- `conversation_archives`：编辑/重发前的不可变消息+分支+回合快照；恢复时先把当前线存为 `pre_restore`，再切换 HEAD。
- `memories`、`settings`：记忆与配置；密钥在加密存储，不进入对话或日志。
- 工作区身份、文件边界和滚动恢复由 `social_projects`/workspace identity 记录。
- `<Agent Home>/events.jsonl`：追加式个体事件流，当前记录 Noema 回合开始/完成/失败/中断；序号单调，读取按游标，不能更新或删除。

数据迁移必须可回滚；启动时 schema 失败应阻止继续写入，不能静默降级。

## 8. 执行边界

- 文件/命令写入只能通过工单和工作区；Noema 不直接写文件。
- 工作区外的读取/写入需要显式授权；每次授权按命令/路径，不默认永久。
- 网络默认禁止；需要外部信息时通过明确的搜索/连接器，并记录来源。
- DSH headless 是首选执行内核；native 执行器是回退。两者都必须服从同一工单、工作区和证据协议。
- Windows Runner 使用 AppContainer/命令策略；不把宿主环境当成无边界沙箱。
- 失败必须保留原始错误、失败步骤和用户消息；中断后不自动重跑未知副作用。

## 9. 现状与目标

已交付：Core Chat 单对话、流式回复、消息操作、历史、设置；工单派发与执行轨迹；DSH/native；Windows Runner；SQLite；任务 dock、完成事件和交付记录；0.7.2 的工作区路由与 DSH 非 JSON 容错；阶段 1 的 AgentRuntime 最小核心、Noema 回合事件日志和 Noema 工具调用内联轨迹；阶段 2 的单 HEAD 用户截断重发、助手原位编辑、会话失效，以及编辑/重发前的不可变消息/回合归档。

未交付：归档恢复的产品入口、工作区文件回滚、执行者可见常驻私聊、常驻会话/项目 fork 拓扑、岗位库/团队/团队负责人/项目负责人、六模块实现、ContextCompiler、Memory Store、完整任务证据。

版本、测试、安装和下一步只写在 [STATUS](STATUS.md)，不在本文件重复。
