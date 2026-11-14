# STATUS

Authority: 本文件是 Noema 当前版本、验证证据、已知缺口、未交付项和下一步的唯一权威来源。
Update when: 交付节点、安装/打包、关键验证结果、阻塞或优先级变化。
Does not own: 产品定义与验收（见 [PRODUCT](PRODUCT.md)）；系统结构与数据边界（见 [ARCHITECTURE](ARCHITECTURE.md)）；长期决定（见 [DECISIONS](DECISIONS.md)）；命令与发布步骤（见 [OPERATIONS](OPERATIONS.md)）；维护规则（见 [AGENTS](../AGENTS.md)）。

最后更新：2026-11-15

## 版本与源码

- 源码版本：`0.7.6`。
- 当前源码基线：`f592a9b release: Noema 0.7.6`；功能基线 `b7c41fa feat: complete projects with visible growth records`。
- 最近交付：
  - 0.7.6（2026-11-14）：项目列表与详情暴露 `成长记录`，可看每名成员的复盘状态、资产路径/修订/删除记录并重试失败成员；项目详情新增工作区页面；项目第一成员自动成为负责人；成长批次中断续接测试。
  - 0.7.5（2026-11-14）：Teams/Projects 页与空态提供 `新建项目`，Members 提供 `新建联系人`；项目/联系人对话框挂到 Core shell 并修主题透明；对话框脚注不再被吸底遮挡。
  - 0.7.4（2026-11-14）：项目成长证据对话框；任务详情按文件展示 diff，可 `保留修改` / `撤回修改`；时间线可见性抽成独立模块并有确定性测试。
- 0.7.4 / 0.7.5 / 0.7.6 均未生成 Squirrel 安装器：NuGet/Squirrel 读取打包 `app.asar` 时返回“无法访问已关闭的流”，继续以便携目录交付。
- 便携构建：`apps/desktop/out/Noema-win32-x64/Noema.exe`（0.7.6，2026-11-14 22:38，246,819,840 字节）。已装目录只有 `%LOCALAPPDATA%\Programs\Noema-0.7.3|0.7.4|0.7.5`，桌面 `Noema.lnk` 仍指向 Noema-0.7.5，与 0.7.6 源码不同步（见已知限制）。
- 维护层事实：0.7.4–0.7.6 期间没有任何权威文档更新（`docs/` 最后一次提交仍是 `21380a7 docs: record architecture invariants`，2026-11-14 15:44），`openspec/changes/` 攒了 11 个活动变更、其中 2 个已完成。本轮把文档/计划同步做成 `npm run check` 与 pre-commit 的硬门槛（见 AGENTS §2、OPERATIONS「维护门槛」），并把 11 个变更收敛为 0 个（2 个正式归档并合并规格，9 个移到 `openspec/changes/archive/2026-11-15-*` 并写明关闭原因）。
- 并行进行中：组织模型与成长机制已立项为唯一活动变更 `openspec/changes/organization-growth-model/`；其 `design.md` 的「待用户决定」未答前不改这部分产品代码。

## 当前可用

- Core Chat：单对话、流式回复、停止、消息复制/引用/转发/主题、历史只读、搜索。
- 任务执行：自然语言派发、工单受理、执行者/工作区、DSH headless 优先、native 回退、Windows Runner、执行轨迹和结果。
- 任务 UI：活跃任务 dock、8 秒完成胶囊、交付记录、点开执行者任务详情；完成事件不追加第二条 Noema 回复。
- 完成事件：每个任务一条，完成/失败/中断分别标记；最近 8 条写入 `localStorage`，刷新后保留；损坏/不可用时回退为空，不影响交付记录。
- AgentRuntime 阶段 1：Noema/执行者两个独立 Agent Home；Noema 回合开始/完成/失败/中断写入追加式 `events.jsonl`；Noema 工具调用在回复下方内联显示，普通回答不显示轨迹。
- 可见执行者：交付记录/任务详情可打开执行者的常驻私聊；标题与消息署名使用执行者姓名，可直接对话。直接专家任务缺少工作区时自动使用该执行者的默认目录。
- 项目负责人：项目创建/继续时可指定一名 Noema 或项目成员为负责人，项目数据保存 `lead_agent_id`，读取结果带 `leadName`；首个项目成员自动成为负责人。
- 团队提案：Noema 主聊新建团队先调用 `propose_project_team`，只写入 `project_team_proposals` 的 pending 记录，不创建项目；用户确认后 `decide_project_team` 才创建项目/团队。项目群内继续项目使用 `create_project_team` 增补成员，不走新建审批。
- 组织层：项目招募可继承隐藏岗位模板标题与版本（schema 41，四类模板：前端/质量/3D/技术研究），模板升级不覆写个体；模板管理 UI 未做。
- 项目成长：项目完成前 `finalize_project` 触发每个活跃成员一次的复盘批次（schema 41 派生表 `social_project_growth_batches`/`social_project_growth_members`）；成员复盘写入 `social_agent_asset_revisions`（path/revision/content/reason/sourceTurnId/sourceProjectId，可删除与恢复，同一回合同一路径只写一次），资产按大小上限注入该成员提示词；批次可重试、可归档，项目详情可打开 `成长记录` 查看。
- 任务文件审阅：任务详情按文件展示 diff，可保留或撤回单个文件的修改。
- 单 HEAD 编辑：用户消息编辑会删除该消息及之后的对话再重发；助手回复可原位修改且不重发；编辑后自动失效该房间运行时会话，下一轮读取完整历史；分支 ID 不出现在界面。
- 编辑前存档与恢复：每次用户截断重发或助手原位编辑前，会把消息、分支和回合快照写入 `conversation_archives`；顶栏在存在存档时显示“恢复修改前版本”，恢复前会先把当前线保存为 `pre_restore`，恢复后回到上一条可见时间线。
- 干净起点：Teams/Projects/Members 三页都可在空态直接新建；项目创建必须选择已存在的工作文件夹，同一事务写入 `workspace_path`/`workspace_identity_json`。

## 验证

- `npm run check`：本轮门槛接入后运行，结果见下方“本轮验证”。
- 0.7.5 交付口径（历史证据）：868 tests / 868 pass / 0 fail；package + `smoke:package` 通过；干净 profile 显示 `团队 0 / 项目 0 / 成员 0` 且两处 `新建项目` 可见。
- 0.7.4 交付口径（历史证据）：864 tests / 864 pass / 0 fail；package + `smoke:package` 通过；schema 42 `social_teams` 表零行。
- 0.7.6 没有发布说明、复检记录或安装验证；现有证据只有源码提交、`npm run check` 当时结果和 `out/` 下的构建产物。

### 本轮验证

- `npm run check`：**873/873，0 fail，37,350ms**（含新增的 `docs:check`、`plan:check`、`maintenance:test`；lint 维持既有 11 条 warning、0 error）。
- `npm run docs:check`：OK（5 份权威文档、版本 0.7.6 = package 版本、基线 `f592a9b`、`core.hooksPath=.githooks`）。
- `npm run plan:check`：OK（清空 11 个活动变更后曾报“当前没有活动变更”，随后立项 `organization-growth-model`）。
- `openspec validate --all --strict`：9 个规格、0 failed。
- 未运行：0.7.6 真实项目复盘、成长对话框、任务文件审阅的真实演练；0.7.6 安装/桌面快捷方式更新；真实 provider 链路与长时运行。

## 未交付（按目标文档）

1. **组织模型**：项目/团队目前是同一层包装（团队名取项目名），一个成员也能建团队；团队章程、长期团队（部门）与跨项目复用未定义。当前活动变更 `organization-growth-model` 正在收口，未定项见其 `design.md`。
2. **成长机制**：已能按项目和成员产出可版本化的资产，但“经历 → 候选能力 → 证据/评估 → 启用”的证据门槛、跨项目积累与用户可见的成长差异未实现（D-014 的成长约束尚未满足）。
3. **执行者会话拓扑**：执行者私有常驻会话已可从任务详情打开；`@Noema` 跨房间寻址、执行者自己的 AgentRuntime 事件日志/证据、常驻会话与项目 fork 仍未实现。
4. **会话拓扑**：仍使用旧 room/branch 结构；常驻会话、项目 fork、团队共享上下文、项目结束归档/复盘未实现。
5. **岗位库/团队剩余**：模板管理 UI、默认 A 的强制确认界面/记录、团队章程、项目长期群尚未落地。
6. **六模块**：Core/Policy/Competence/Tool Grants/Memory/Context 仍是目标；ContextCompiler、Memory Store、ModuleHost 热重载未交付。
7. **工作区回滚**：对话编辑、不可变存档和恢复入口已交付；工作区文件回滚未实现。对话历史按 D-018 使用 SQLite 不可变快照，不引入外部 Git；分支表仍保留为兼容/检查点。
8. **证据完整性**：部分执行路径的 `social_work_file_changes`、`file_change_operations`、`command_batches` 为空，任务验收仍依赖步骤/文本证据。
9. **旧任务卡**：废弃的 0.7.2 任务卡不迁移、不回填；旧历史只读保留，新的任务事实由交付记录和事件承担。

## 已知限制

- 桌面 `Noema.lnk` 指向 0.7.5，便携目录里没有 0.7.6 安装；要验证 0.7.6 必须直接运行 `apps/desktop/out/Noema-win32-x64/Noema.exe`，或在发布时补装。
- 0.7.6 的成长记录、成长对话框、任务文件审阅都只在测试中验证过，没有在真实项目上完整走一遍。
- 成长是“模型在复盘回合里写资产文件”，没有跨项目证据门槛，也不会自动改变成员的核心提示词；它不能当作“已实现成长”来对用户宣称。
- 完成事件是 renderer 级 `localStorage`，按浏览器/应用数据隔离；交付记录/SQLite 才是任务事实源。
- 任务 dock 只展示活跃任务；历史通过交付记录查看。
- 旧完整 social UI 不再挂载，七个 renderer 模块保留为 dormant；旧 `noema-project-executor.mjs` 保留为 fallback。不要仅凭零引用删除，恢复需要真实入口和验收。
- AgentRuntime 阶段 1 只接入 Noema 的回合事件和工具轨迹；执行者核心已创建，但执行仍由 `SocialWorkService`/DSH 承担，执行者自己的运行事件尚未接入。可见执行者私聊目前是已有 specialist direct room，不新增独立 AgentRuntime 事件流；`@Noema` 尚未接入。Core Chat 不经过旧 `RootAgent`。
- 编辑仍是破坏性截断/覆盖：旧用户消息及后续消息被删除，助手旧正文被覆盖；删除/覆盖前已写入 `conversation_archives`，顶栏可恢复最近一次存档，但恢复只回退对话，不随对话回滚工作区文件。
- `main.ts` 仍是组合根；main/service/UI 的进一步拆分以真实缺口为驱动，不做无验收的大搬迁。
- 项目工作区选择在项目创建时完成；项目创建后更换目录仍走对话框，取消选择不改变已有绑定。

## 下一步

一次只推进一个阶段，顺序由活动 OpenSpec 变更承载；未完成变更归档前不开下一个。

1. **当前阶段：组织模型与成长机制**（`openspec/changes/organization-growth-model/`）：先把团队/项目建模和成长证据门槛设计定清楚，`design.md` 的「待用户决定」3 项由用户确认后再改代码。
2. **阶段 5 前置：会话拓扑**：`@Noema` 跨房间寻址、执行者事件日志/证据、常驻会话与项目 fork。
3. **阶段 5：六模块与前端**：用六模块和 ContextCompiler 替换当前提示词/工具/上下文拼装，再做一次主要前端升级。
4. **收尾**：补工作区文件回滚、任务文件/命令证据完整性，做最终验收与可安装分发（含 Squirrel 或替代安装方式）。
5. **发布**：0.7.6 需要补发布说明、安装/快捷方式更新和一次真实使用验证，才能算交付。

## 交付判断

当前是可日常使用的 0.7.6 工程版，不是已完成 V1。核心对话、编辑/存档/恢复、执行链路和项目成长记录可用；组织模型、成长证据门槛、会话拓扑、六模块、工作区回滚和证据完整性仍是未交付项。任何“完成”结论必须有文件/命令/测试证据，不能以模型自述或计划代替。
