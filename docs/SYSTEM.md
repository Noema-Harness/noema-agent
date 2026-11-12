# SYSTEM

## 总览

Noema 是一个 Electron 桌面应用。默认是一个 Core Chat；执行者有自己的可见常驻私聊，用户可以直接打开。内部由“对话编排 → 工具/工单 → 执行者 → 证据回传”组成。执行不是 Noema 自己写文件，而是交给受约束的执行层。

`renderer` 只负责输入、消息、执行轨迹和设置；`main` 负责持久化、模型调用、工具协议、工单、执行和权限。两者通过 preload 暴露的窄 API 通信。

## 组织对象

- **岗位库（Job library）**：Noema 维护的现实岗位集合。一个现实岗位对应一个长期 Agent；专属提示词、基础工具和行为标准是系统级基础配置，不是按任务临时写的招聘说明，也不拆成模板/实例两层。
- **Agent**：长期员工。一条常驻会话保存个人记忆和连续性；项目执行使用独立 fork；同一 Agent 可被多个团队复用。
- **团队（Team）**：长期能力器官，按能力/部门命名；由负责人、成员和共享上下文组成。团队不因项目结束消失，不设项目专属团队，缺岗位时招进公司而不是外包。
- **项目（Project）**：临时复杂输出。Noema 不直接创建；负责人/团队与 Noema 对齐后建立，项目会话从参与 Agent 的常驻会话 fork，结束后归档。
- **负责人（Lead）**：公司管理岗，由 Noema 从岗位库产生，先于团队；负责人分析需求、提出团队配置和招聘，Noema 批准后组建团队。项目负责人默认由团队负责人继承，按 D-012 只协调。

## 个体 Agent 模型

Noema 和每个执行者共用同一套六模块，不是两套人格：

- **Core**：身份、责任和运行时契约；不是可随意改写的 system prompt。
- **Policy**：判断、拒绝、升级规则；用户/项目约束进入 Context，不自动改写成 Agent 的 Policy。
- **Competence**：能力库；最小可执行单位是“能力条目”，包含适用条件、步骤、工具、失败模式、检查/证据、范围和状态。
- **Tool Grants**：工具清单、权限和副作用边界；原生函数只是实现，不等于授权。
- **Memory**：情节、语义、程序记忆；知识库只是语义记忆的一种载体。
- **Context**：每轮由 Compiler 组装的工作集，包含任务状态、检索到的能力/记忆、工具 schema 和约束；不是六模块全量打包。

Compiler 是组装过程，不是第七个模块。岗位包是组织层组合，不属于个体六模块。Noema 偏 Policy、编排、治理和用户关系；执行者偏 Competence、岗位/团队/项目工具和领域记忆。

当前 0.7.2 源码仍是提示词、工具和服务组合；这套六模块是目标模型，不是已实现能力。

## 代码地图

```text
apps/desktop/src/main/          Electron 主进程
  main.ts                       启动、服务图、IPC 组合和生命周期
  app/                          窗口/托盘/模型运行时/Agent 运行时/Social 状态与工作服务装配
  testing/                      打包冒烟、E2E fixture 和测试桥接
  ipc/root-ipc.mjs              renderer 可调用的 IPC 通道
  chat/                         Core Chat、会话、上下文、连续时间线
  projects/                     项目、团队、计划、项目工作
  execution/                    工单、执行服务、DSH/native 运行时、Windows Runner
  models/                       模型服务商适配与密钥
  stores/                       RootStore 等基础持久化
  platform/                     工作区身份、平台能力
apps/desktop/src/preload/       contextBridge API
apps/desktop/src/renderer/      React UI
  chat/core-chat-app.tsx        唯一主对话界面
  chat/use-social-chat-controller.tsx  对话状态/动作
  chat/turn-trace.tsx           一次回复内的工具轨迹
  settings/                     模型、权限、诊断、搜索设置
apps/desktop/native/            Windows Runner 等原生执行辅助
```

## 模块与职责

- **Core Chat / controller**：输入、消息流、重试/复制/引用/编辑、历史、附件、设置入口。它不直接执行文件。
- **Executor Session**：执行者的可见常驻私聊，不是群聊，也不是临时工单群；用户与 Noema 的派发、状态和结果汇入同一时间线。执行者默认回复，`@Noema` 切回 Noema。当前 UI 尚未落地，见 STATUS。
- **Session topology**：每个执行者只有一条常驻会话；私聊和团队空间都对接它。团队有共享上下文/记录，但不是第三份会话。项目创建后，所有参与执行者（含团队负责人）从最新常驻会话分叉项目会话；团队负责人保留常驻会话做组合管理；项目结束归档并做整体复盘。MVP 阶段一个团队同一时间只推进一个项目。Noema 只有常驻会话，不加入团队或项目。当前实现仍是旧 room/branch 结构。
- **Project lead**：项目内的协调角色，不是成员岗位。它负责计划、依赖、风险和验收汇总，默认不进入执行层；小项目可显式兼任一个工作项。当前没有独立的项目负责人模型，0.7.1 仍是旧 room/branch 结构。
- **SocialChatService**：一次用户回合的编排；组装上下文、调用模型、处理工具调用、决定直接回答或创建工单；把执行轨迹作为同一回复的一部分回传。
- **SocialChatStore**：会话、消息、连续时间线/检查点、分支、会话头、上下文边界。消息正文仍在 `social_messages`，连续结构在 `conversation_*` 表。
- **Context Assembly**：从当前分支、最近消息、摘要/记忆和工作区上下文中组装模型输入。当前是简单窗口；确定性的 ContextCompiler 尚未完成。
- **Tool Gateway / MCP**：只读文件/搜索、工单创建等工具的能力边界。MCP 是协议层，不是沙箱；工具权限在应用侧判定。
- **SocialWorkService**：工单生命周期、承接人、工作区、执行步骤、证据、恢复和结果回传。
- **Work Runtime**：优先 DSH headless，其次是 native 执行器。运行时是可替换的，不构成产品身份。
- **Windows Runner**：命令隔离/沙箱边界；执行范围、工作区外访问和网络访问按策略限制。
- **Conversation continuity**：不可变回合检查点、活动分支头、CAS 切换、启动恢复。分支是内部恢复结构，不是常规 UI。
- **Model provider**：当前一个主模型 + 适配层；模型密钥加密保存在本机，不进入聊天记录。
- **Settings / diagnostics**：模型连接、授权等级、网络搜索、运行诊断和应用执行 ID。

## 数据与持久化

本机 SQLite 是产品事实来源。主要数据：

- `social_messages`、`social_rooms`、`social_agents`：会话、消息、联系人。
- `social_projects`、计划/工作项：项目和团队容器。
- `social_work_tasks`、`execution_steps`：工单、承接人、执行轨迹和证据。
- `conversation_branches`、`conversation_turns`、`conversation_active_branch`：连续时间线、检查点和活动分支。
- 设置、密钥、搜索配置和个人记忆分别存储；密钥不进入消息/日志。

用户数据库、凭据、参考源码和 `.work/` 临时材料严格分开。`.work/` 不是产品数据，不能作为交付依据。

## 执行边界

1. Noema 主对话只做读取/分析/工具调用和工单创建；写文件、改代码、运行命令必须落到工单。
2. 一张工单对应一个承接人、一个执行会话、一个工作区；执行者不是第二个人格，但有可见的常驻私聊和工作上下文，不对用户承担最终责任。
3. 执行证据（步骤、命令、文件变更、错误）回到原对话或执行者会话的一条执行轨迹；最终答复必须区分“已完成”“未验证”“失败”。
4. DSH 是当前首选的执行内核；native 是回退。更换执行内核不应改变产品对象和数据模型。
5. 外部网络默认受限；工作区外文件和网络访问按授权策略处理。

## 当前与计划

当前已有：单对话 Core Chat、消息动作、历史、SQLite 持久化、工单/执行轨迹、DSH/native、Windows Runner、schema 37 连续时间线基础、设置/诊断。

计划中但未交付：执行者可见私聊、确定性的 ContextCompiler、长期记忆存储与审核队列、ModuleHost 热重载（Phase 1.5）、统一证据/评测。云端和跨设备同步不是当前承诺，若未来立项再单独定义，不能被当成已计划能力。

## 已知结构问题

- 仍保留旧社交/项目/团队代码和历史路由；主界面已收成一个对话，但内部对象尚未完全收口。
- 分支/检查点已实现，编辑语义已定（D-002）：用户消息截断重发，助手回复原地修改并保留后续；实现未完成。当前 UI 仍暴露分支栏，属于待移除的实验界面。
- 旧 schema/迁移和插件债务需要继续清理；不要以旧规格自动恢复产品范围。

当前可运行状态以 [STATUS](STATUS.md) 为准。
