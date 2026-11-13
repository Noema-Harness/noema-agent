# STATUS

Authority: 本文件是 Noema 当前版本、验证证据、已知缺口、未交付项和下一步的唯一权威来源。
Update when: 交付节点、安装/打包、关键验证结果、阻塞或优先级变化。
Does not own: 产品定义与验收（见 [PRODUCT](PRODUCT.md)）；系统结构与数据边界（见 [ARCHITECTURE](ARCHITECTURE.md)）；长期决定（见 [DECISIONS](DECISIONS.md)）；命令与发布步骤（见 [OPERATIONS](OPERATIONS.md)）；维护规则（见 [AGENTS](../AGENTS.md)）。

最后更新：2026-11-13

## 版本与源码

- 源码版本：`0.7.2`。
- 当前源码基线：`996c649 feat: add hidden job templates and project lineage`；上一基线 `d690f37 docs: record DSH team tools and stage 4 approval`。
- 最近交付：阶段 4 岗位模板与项目招募血缘：schema 41，隐藏岗位库（前端/质量/3D/技术研究四类模板），项目招募可继承模板标题与版本，模板升级不覆写个体；阶段 4 团队提案/审批通过 DSH 可见的 MCP 工具完成（`propose_project_team`/`decide_project_team`），批准后创建项目、团队和负责人；阶段 4 两阶段团队提案/审批（schema 40）、项目显式负责人（schema 39）；阶段 3 任务详情可直接打开执行者常驻私聊；阶段 2 单 HEAD 编辑、助手原位编辑、会话失效、不可变存档与恢复；阶段 1 AgentRuntime 核心、Noema 回合事件日志、内联轨迹；`463d817` 任务完成事件 + 本地持久化；`4f21ac3` 任务 dock；`2b742a1` 移除聊天流内任务卡。
- 文档收敛：五份权威文档 + README/AGENTS；`BEHAVIOR`/`SYSTEM` 已合并删除，`.codex/workspace.json` 为 7 个当前入口；D-016/D-017 已记录 Agent 核心分层与团队审批 A。
- 已安装：`0.7.2`，路径 `C:\Users\NUC\AppData\Local\noema_desktop\app-0.7.2\Noema.exe`。该安装早于任务卡/生命周期/完成事件三个提交，不包含当前源码 UI。
- 本轮没有重新打包或安装；0.7.2 之后不再更新安装包。发布构建只在准备分发时进行。

## 当前可用

- Core Chat：单对话、流式回复、停止、消息复制/引用/转发/主题、历史只读、搜索。
- 任务执行：自然语言派发、工单受理、执行者/工作区、DSH headless 优先、native 回退、Windows Runner、执行轨迹和结果。
- 任务 UI：活跃任务 dock、8 秒完成胶囊、交付记录、点开执行者任务详情；完成事件不追加第二条 Noema 回复。
- 完成事件：每个任务一条，完成/失败/中断分别标记；最近 8 条写入 `localStorage`，刷新后保留；损坏/不可用时回退为空，不影响交付记录。
- AgentRuntime 阶段 1：Noema/执行者两个独立 Agent Home；Noema 回合开始/完成/失败/中断写入追加式 `events.jsonl`；Noema 工具调用在回复下方内联显示，普通回答不显示轨迹。
- 可见执行者：交付记录/任务详情可打开执行者的常驻私聊；标题与消息署名使用执行者姓名，可直接对话。直接专家任务缺少工作区时自动使用该执行者的默认目录。
- 项目负责人：项目创建/继续时可指定一名 Noema 或项目成员为负责人，项目数据保存 `lead_agent_id`，读取结果带 `leadName`。
- 团队提案：Noema 主聊新建团队先调用 `propose_project_team`，只写入 `project_team_proposals` 的 pending 记录，不创建项目；用户确认后 `decide_project_team` 才创建项目/团队。项目群内继续项目使用 `create_project_team` 增补成员，不走新建审批。
- 单 HEAD 编辑：用户消息编辑会删除该消息及之后的对话再重发；助手回复可原位修改且不重发；编辑后自动失效该房间运行时会话，下一轮读取完整历史；分支 ID 不出现在界面。
- 编辑前存档与恢复：每次用户截断重发或助手原位编辑前，会把消息、分支和回合快照写入 `conversation_archives`；顶栏在存在存档时显示“恢复修改前版本”，恢复前会先把当前线保存为 `pre_restore`，恢复后回到上一条可见时间线。
- 0.7.2 已包含工作区路由和 DSH 非 JSON 容错；真实 inventory/orders 任务已验证文件修改和测试通过。

## 验证

- `npm run check`：**856/856，0 fail，36,092.941ms**（岗位模板/项目招募血缘后最后一次全量）。
- `npm run typecheck`：通过。
- 类型覆盖（D-019 TS 迁移）：阶段 0、1 完成。阶段 0：tsconfig 启用 `allowImportingTsExtensions`/`erasableSyntaxOnly`/`verbatimModuleSyntax`，`src/package.json` 标记 ESM，`source:check` 加 `.mjs` 数量棘轮。阶段 1：57 个小文件已改为 `.ts`（只改类型、不改行为；类字段用 `declare` 声明，运行时不新增字段），`src` 下剩余 **67** 个 `.mjs`（棘轮上限 67），全部未受类型检查，含 `social-chat-service`/`social-chat-store`/`root-ipc` 等大文件；与未转换 JS 协作的入口暂用 `ChatRun = Record<string, any>` 等宽类型，待对应模块转换时收紧。类型检查已发现的问题：`transcript-search` 的类型导入指向不存在的路径（JS 下静默为 any，已修正）；`searchAndReadWeb` 的 `apiKey` JSDoc 未覆盖未配置时的 `null`（运行时已校验，已更正 JSDoc）。验证（macOS）：`typecheck`、`oxfmt`、`source:check` 通过；Vite main/preload/renderer 构建通过；Node 26 全量单测 829/854，24 个失败均为 Windows 专属且与改动前逐文件一致；涉及转换模块的 40 个测试文件在 Node 24.22 与 26 上均 164/167（2 个失败为既有 Windows 路径断言，改动前同样失败）。未在 Windows 上重跑 `npm run check`，未做 `electron-forge package`；`lint` 因 lockfile 只含 Windows 原生绑定在 macOS 上无法运行。
- `test/main/chat/social-chat-store.test.mjs`：**50/50**，包含助手消息原地编辑、存档恢复和岗位模板版本冻结。
- `test/main/chat/conversation-continuity.test.mjs`：**11/11**，schema 41 的迁移与回退断言通过。
- `test/main/projects/social-project-store.test.mjs` + continuity：**27/27**，包含项目负责人、团队提案 pending、岗位模板招募与个体版本冻结。
- `test/main/projects/project-collaboration.test.mjs`：**30/30**，包含新团队两阶段提案和已有项目群内增补成员。
- 真实任务：`orders` 双缺陷修复（`orders tests passed`）、`inventory` `totalValue` 修复、任务完成事件、刷新持久化、执行者详情；Noema 三轮回合事件写入 `events.jsonl`（序号 1–6，开始/完成成对），唯一文件读取的内联 `mcp__noema__read_file` 轨迹可见；真实编辑验证了用户消息截断重发、助手回复原位保存及后续上下文读取；助手和用户编辑后的“恢复修改前版本”均恢复旧时间线，当前线写入 `pre_restore`；真实团队提案 `5df42335-08d6-43bd-9ed1-430143e901da` 经 `decide_project_team` 批准，创建项目 `project-df76ab4a-6e0b-477e-929a-38fef94913e1`、负责人 `前端工程师` 和两个执行者会话。
- 这些是工程/产品自查证据，不等于用户最终验收；最终验收以真实使用和用户判断为准。

## 未交付（按目标文档）

1. **执行者会话拓扑**：执行者私有常驻会话已可从任务详情打开；`@Noema` 跨房间寻址、执行者自己的 AgentRuntime 事件日志/证据、常驻会话与项目 fork 仍未实现。
2. **会话拓扑**：仍使用旧 room/branch 结构；常驻会话、项目 fork、团队共享上下文、项目结束归档/复盘未实现。
3. **岗位库/团队**：项目显式负责人、两阶段团队提案/审批、隐藏岗位模板、项目招募血缘和版本冻结已落地；模板管理 UI、默认 A 的强制确认界面/记录、团队章程、项目长期群尚未落地。
4. **六模块**：Core/Policy/Competence/Tool Grants/Memory/Context 仍是目标；ContextCompiler、Memory Store、ModuleHost 热重载未交付。
5. **工作区回滚**：对话编辑、不可变存档和恢复入口已交付；工作区文件回滚未实现。对话历史按 D-018 使用 SQLite 不可变快照，不引入外部 Git；分支表仍保留为兼容/检查点。
6. **证据完整性**：部分执行路径的 `social_work_file_changes`、`file_change_operations`、`command_batches` 为空，任务验收仍依赖步骤/文本证据。
7. **旧任务卡**：废弃的 0.7.2 任务卡不迁移、不回填；旧历史只读保留，新的任务事实由交付记录和事件承担。

## 已知限制

- 完成事件是 renderer 级 `localStorage`，按浏览器/应用数据隔离；交付记录/SQLite 才是任务事实源。
- 任务 dock 只展示活跃任务；历史通过交付记录查看。
- 旧完整 social UI 不再挂载，七个 renderer 模块保留为 dormant；旧 `noema-project-executor.mjs` 保留为 fallback。不要仅凭零引用删除，恢复需要真实入口和验收。
- AgentRuntime 阶段 1 只接入 Noema 的回合事件和工具轨迹；执行者核心已创建，但执行仍由 `SocialWorkService`/DSH 承担，执行者自己的运行事件尚未接入。可见执行者私聊目前是已有 specialist direct room，不新增独立 AgentRuntime 事件流；`@Noema` 尚未接入。Core Chat 不经过旧 `RootAgent`。
- 编辑仍是破坏性截断/覆盖：旧用户消息及后续消息被删除，助手旧正文被覆盖；删除/覆盖前已写入 `conversation_archives`，顶栏可恢复最近一次存档，但恢复只回退对话，不随对话回滚工作区文件。
- `main.ts` 仍是组合根（约 1,303 行，7 个 main 模块）；main/service/UI 的进一步拆分以真实缺口为驱动，不做无验收的大搬迁。
- 旧 `docs/BEHAVIOR.md`/`SYSTEM.md` 已合并进 PRODUCT/ARCHITECTURE 并删除；`.codex/workspace.json` 已收敛为五份权威文档 + README/AGENTS。

## 下一步

当前按 D-016/D-017 的新 Agent 模型推进；阶段 1–3 已交付，阶段 4 已交付显式负责人与两阶段提案/审批，继续补岗位模板和长期组织。

1. **阶段 2：历史与编辑**：编辑语义、不可变存档和恢复入口已交付；存储选择已定为 SQLite 快照（D-018）。剩余工作区文件回滚，放到执行者工作区阶段。
2. **阶段 3：可见执行者**：任务详情 → 执行者常驻私聊已交付；剩余 `@Noema` 跨房间寻址、执行者自己的 AgentRuntime 事件日志/证据，以及常驻会话/项目 fork。
3. **阶段 4：组织层**：项目显式负责人、两阶段团队提案/审批、隐藏岗位模板、项目招募血缘和版本冻结已交付；剩余模板管理 UI、默认 A 强制确认界面/记录、团队章程、项目长期群。
4. **阶段 5：六模块与前端**：用六模块和 ContextCompiler 替换当前提示词/工具/上下文拼装，再做一次主要前端升级。
5. **收尾**：补齐任务文件/命令证据，完成最终验收与分发构建。

## 交付判断

当前是可日常使用的 0.7.2 工程版，不是已完成 V1。核心对话、单 HEAD 编辑/存档/恢复和执行链路可用；组织层、会话拓扑、六模块、工作区回滚和证据完整性仍是未交付项。任何“完成”结论必须有文件/命令/测试证据，不能以模型自述或计划代替。
