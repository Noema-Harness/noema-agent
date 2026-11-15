# STATUS

Authority: 本文件是 Noema 当前版本、已验证证据、未交付项与已知限制的唯一权威来源。
Update when: 交付节点、安装/打包、关键验证结果、阻塞或优先级变化。
Does not own: 产品定义与验收（见 [PRODUCT](PRODUCT.md)）；系统结构与数据边界（见 [ARCHITECTURE](ARCHITECTURE.md)）；长期决定（见 [DECISIONS](DECISIONS.md)）；命令与发布步骤（见 [OPERATIONS](OPERATIONS.md)）；维护规则（见 [AGENTS](../AGENTS.md)）；计划与排序（见 GitHub Project 看板与 `openspec/changes/`，D-026）。

最后更新：2026-11-15

## 版本与源码

- 源码版本：`0.7.6`。
- 当前源码基线：`f592a9b release: Noema 0.7.6`；功能基线 `b7c41fa feat: complete projects with visible growth records`。
- 最近交付：
  - 0.7.6（2026-11-14）：项目列表与详情暴露 `成长记录`，可看每名成员的复盘状态、资产路径/修订/删除记录并重试失败成员；项目详情新增工作区页面；项目第一成员自动成为负责人；成长批次中断续接测试。
  - 0.7.5（2026-11-14）：Teams/Projects 页与空态提供 `新建项目`，Members 提供 `新建联系人`；项目/联系人对话框挂到 Core shell 并修主题透明；对话框脚注不再被吸底遮挡。
  - 0.7.4（2026-11-14）：项目成长证据对话框；任务详情按文件展示 diff，可 `保留修改` / `撤回修改`；时间线可见性抽成独立模块并有确定性测试。
- Squirrel 安装器（2026-11-15 修复）：0.7.4–0.7.6 之前无法出安装器，根因是三条构建环境问题，已由 `apps/desktop/scripts/make.mjs` 固定：受限令牌下 `%TEMP%` 不可写给 NuGet 子进程；electron-winstaller 自带 NuGet 2.8 打包 `app.asar` 抛 `ObjectDisposedException`（已 vendored NuGet 6.11.1 + `vendorDirectory`）；Squirrel 的 `%LOCALAPPDATA%\SquirrelTemp` 与锁文件不可写（改 `SQUIRREL_TEMP` 与固定 TEMP）。0.7.6 安装产物已由 `npm run make:desktop` 生成：`.work/releases/Noema-0.7.6/Noema-0.7.6 Setup.exe`（170,410,496 字节，sha256 `6E773C854FBF6E4B0A39720608737555114E5E95E9F5526F1E05D7A32964BCDC`）、`noema_desktop-0.7.6-full.nupkg`（169,672,685，`43C7BCA5288EEDDF0B63465AAD68807CB41D636CB1B3D0AAB51945070951E618`）、`RELEASES`（84 字节，`98F69C9F3D1D08A710B16844E4C963264FDAF051D01BC4D1BBC3370DE0DD5B08`）。Squirrel 会写入构建时间，同源码两次构建哈希不同。
- 便携构建：`apps/desktop/out/Noema-win32-x64/Noema.exe`（0.7.6，2026-11-14 22:38，246,819,840 字节）。已装目录只有 `%LOCALAPPDATA%\Programs\Noema-0.7.3|0.7.4|0.7.5`，桌面 `Noema.lnk` 仍指向 Noema-0.7.5，与 0.7.6 源码不同步（见已知限制）。
- 维护层事实：0.7.4–0.7.6 期间没有任何权威文档更新（`docs/` 最后一次提交仍是 `21380a7 docs: record architecture invariants`，2026-11-14 15:44），`openspec/changes/` 攒了 11 个活动变更、其中 2 个已完成。本轮把文档/计划同步做成会失败的检查：`npm run check` 里的 `docs:check`、`plan:check`，归档前的 `npm run milestone:check`，以及 `.githooks/pre-commit`；11 个变更收敛为 0 后再立项（2 个正式归档并合并规格，9 个移到 `openspec/changes/archive/2026-11-15-*` 并写明关闭原因）。
- 维护门槛 v2（2026-11-15，按用户对决定 3 的回答落地）：产品定义=`docs/PRODUCT.md`（不含能力清单与计划，2026-11-15 纠正，见 D-023）；能力清单、排序与状态只在 [GitHub Project「Noema V1 路线」](https://github.com/orgs/Noema-Harness/projects/1)（14 张 `[C<n>]` 卡片，Done 5 / In Progress 6 / Todo 3，2026-11-15 按真实证据重标）；proposal 必须写 `Plan: <卡片链接>`（不校验能力编号）；未答决策只阻塞 `apps/desktop/src/` 的产品代码，工具与文档维护放行；行为变更不允许 `skip_specs`；用户验收项格式 `[用户] … （用户确认：YYYY-MM-DD）`；里程碑=归档并需 `milestone:check` 通过。决定与理由见 `docs/DECISIONS.md` D-020、D-022、D-023。
- 维护层现状（2026-11-15）：`organization-growth-model` 已归档——组织模型已由 D-019 定案，成长证据门槛移交看板 C6 #137，签名与真实安装移交 C12 #143（D-025）。当前唯一活动变更是治理变更 `maintenance-workflow-v3`（`Plan: none`）：计划三层与 STATUS 边界（D-026）、架构图接入检查（`figure:check`/`figure:build`）、GitHub 通知本地化（`inbox` + Windows 计划任务）。门槛共五道：docs、plan、figure、milestone、pre-commit。讨论积压不再建云端 issue：本机台账 `.work/discussions/LEDGER.md` + `q/<id>.md`，`npm run questions` 给摘要、最久未动项与陈旧提醒；发散讨论先登记再继续，一轮只推进一个 open 项，定案迁进 DECISIONS 或卡片后才标 done。
- 治理与展示（2026-11-15）：删除不再作用于开发的项目级技能与 `skills:sync`/`skills:check`；看板 14 张卡片改为统一模板并按证据重标；README 增加只画 Noema 自身范围的用户向架构图 v2（`docs/assets/noema-architecture.png`，附可交互 HTML，源文件 `docs/assets/noema-architecture.source.json`），图中区分已实现与计划中。

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

- `npm run check`：**873/873，0 fail，33,791ms**（2026-11-15 接入本机问题台账后）。链上含 `workspace:check`（串了 `branches:check`）、`figure:check`、`branches:test`、`inbox:test`；`docs:check` OK（5 份文档、版本 0.7.6、基线 `f592a9b`、`core.hooksPath=.githooks`）、`plan:check` OK（治理变更 `maintenance-workflow-v3`：17 完成 / 4 未完成、用户验收 1 项、无待决）、`maintenance:test` 6/6（含治理变更 `Plan: none` 被拒产品代码）、`questions:test` 2/2（台账摘要、陈旧与超限提醒）、`figure:test` 1/1、`branches:test` 2/2、`inbox:test` 17/17。
- 架构图 v2（2026-11-15）：`npm run figure:build` 端到端跑通（Archify finalize 四 gate 全 pass → Edge headless 截 PNG → 回写摘要）；`figure:check` 校验 `docs/assets/noema-architecture.source.json` 里的 ARCHITECTURE 摘要、HTML/PNG 摘要与 README 引用，已接入 `npm run check`。图有 12 个组件、4 张卡片、6 类图例，灰底 + 琥珀虚线区域标出「计划中（尚未实现）」＝六模块、会话 fork、@Noema 跨房间。
- GitHub 收件箱（2026-11-15）：`scripts/github-inbox.mjs` 拉取 main 的 CI 失败/恢复、open PR 检查状态、新评论与 issue，去重写 `.work/github-inbox/{state.json,pending.md}`；Windows 计划任务 `NoemaGithubInbox` 每 10 分钟运行，`Last Result=0`；首次 poll 记录 main 最新 run `43673883619 success`、三次失败 run 与 PR #131 检查状态。
- CI（2026-11-15）：main 上 `Desktop checks` 三次失败后修复为绿——`5ea61b5`（CI 里不检查本地钩子、checkout 用 `fetch-depth: 0`）、`e71e9c6`（测试显式指定 CI 模式）；run `43673883619` success，13 分 11 秒，含 `make:desktop` 与安装/升级/卸载数据保留验证。
- 个体组成（2026-11-15）：`docs/ARCHITECTURE.md` §3.3 新增“一个个体当前由什么组成”（身份、岗位来源、项目关系、经历与技能、运行时个体、用户记忆）与成长可写边界；看板 C6 #137 记录 L0–L3 分层与真实库证据（批次 completed、成员 `no_change`、资产表 0 行、复盘 brief 含未执行的工具调用原文）。
- 仓库洁净与分支卫生（2026-11-15）：`.work/` 整体不再入库（`.gitignore` 忽略整个目录，唯一被跟踪的 `.work/README.md` 已删除）；`.codex/` 删除，仓库结构与文档登记迁到 `scripts/workspace.config.json`；清理 8 个已过时远端分支（删除前备份 `.work/archive/branches-2026-11-15.bundle`，7,299,401 字节），保留 `ts-migration-phase-0-1`（PR #131）；新增 `scripts/branches.mjs`（已合入 `origin/main` 的残留分支直接失败，陈旧未合入分支只提示）并串进 `workspace:check`；`openspec/changes/archive/` 移出仓库（218 个文件，D-027），归档历史由 Git 保存，`.gitignore` 忽略该目录。
- 未运行：成长门槛实现、0.7.6 真实复盘/成长对话框/任务文件审阅演练、真实 `%LOCALAPPDATA%` 安装与跨版本升级（本机工作区带 Low 完整性标签，工作区内产出的 Setup 无法写 `%LOCALAPPDATA%`；见已知限制）、真实 provider 全链与长时运行。
- 安装器构建与载荷验证（2026-11-15）：`npm run make:desktop` 在 `out/` 被外部句柄锁住时自动落到 `.tmp/forge-out` 并成功产出 Setup/nupkg/RELEASES（`out` 锁属本机环境，见已知限制）。把 `TEMP`/`SQUIRREL_TEMP` 指到工作区后运行 `Setup.exe --silent`，Squirrel 把 `app-0.7.6` 落到该根目录：`Noema.exe` ProductVersion/FileVersion 均为 `0.7.6`，`resources/app.asar` 49,477,041 字节、sha256 `AAC1A250C62A66B935928455D7DD693ECA4BF23884E08FF7A2A7C99CC5AB5A39`，与构建产物一致；这是载荷验证，不等于真实用户安装。
  2026-11-15 用计划任务在普通用户上下文直接跑 `Setup.exe --silent`：Squirrel 在 `%LOCALAPPDATA%\SquirrelTemp` 解包失败，回退到 `C:\ProgramData\NUC`（无管理员权限）后弹 `Unable to write to … IT policies may be restricting access to this folder`。根因已定位（`.work/reports/env-debt.md`）：仓库目录被加了显式 `Mandatory Label\Low Mandatory Level:(OI)(CI)(NW)`，工作区内构建出的 exe 继承 Low 标签，进程以 Low 完整性运行，被内核 MIC 拒绝写 Medium 的 `%LOCALAPPDATA%`/`ProgramData`（同一 exe 复制到 Desktop 或 `%TEMP%` 后 subauths 从 4096 变 8192，写入成功）；与签名、360、Defender、AppLocker 无关（360 已注册但无进程/服务/驱动）。把 `SQUIRREL_TEMP`/`TEMP` 指到可写目录后可完整装出 `app-0.7.6`（桩程序 292,864 字节、版本 0.7.6，`app-0.7.6\Noema.exe` ProductVersion 0.7.6，nupkg 169,672,685 字节），证明载荷可用。

## 未交付（按目标文档）

1. **组织模型**：D-019 已决定取消独立团队对象（只有项目、负责人、成员），代码仍保留 schema 42 的 `social_teams` 同层包装；把成员关系改由 `social_project_sessions` 承担、删除团队表的迁移尚未做（卡片 C7 #138）。
2. **成长机制**：已能按项目和成员产出可版本化的资产，但“经历 → 候选能力 → 证据/评估 → 启用”的证据门槛、跨项目积累与用户可见的成长差异未实现（D-014 的成长约束尚未满足）。下一步先定义“个体由哪些部分组成”，再定一次项目经历能带来什么；由卡片 C6 #137 的独立变更处理。
3. **执行者会话拓扑**：执行者私有常驻会话已可从任务详情打开；`@Noema` 跨房间寻址、执行者自己的 AgentRuntime 事件日志/证据、常驻会话与项目 fork 仍未实现。
4. **会话拓扑**：仍使用旧 room/branch 结构；常驻会话、项目 fork、团队共享上下文、项目结束归档/复盘未实现。
5. **岗位库/团队剩余**：模板管理 UI、默认 A 的强制确认界面/记录、团队章程、项目长期群尚未落地。
6. **六模块**：Core/Policy/Competence/Tool Grants/Memory/Context 仍是目标；ContextCompiler、Memory Store、ModuleHost 热重载未交付。
7. **工作区回滚**：对话编辑、不可变存档和恢复入口已交付；工作区文件回滚未实现。对话历史按 D-018 使用 SQLite 不可变快照，不引入外部 Git；分支表仍保留为兼容/检查点。
8. **证据完整性**：部分执行路径的 `social_work_file_changes`、`file_change_operations`、`command_batches` 为空，任务验收仍依赖步骤/文本证据。
9. **旧任务卡**：废弃的 0.7.2 任务卡不迁移、不回填；旧历史只读保留，新的任务事实由交付记录和事件承担。

## 已知限制

- 桌面 `Noema.lnk` 指向 0.7.5，便携目录里没有 0.7.6 安装；要验证 0.7.6 必须直接运行 `apps/desktop/out/Noema-win32-x64/Noema.exe`，或在发布时补装。
- 本机工作区（`C:\Users\NUC\Desktop\noema`）被加了 Low 完整性标签，区内构建的 Setup 以 Low IL 运行、写不了 `%LOCALAPPDATA%`：验证真实安装需先把 exe 复制到 `%TEMP%` 再运行（副本为 Medium IL）；这与签名无关，发布口径仍按 D-025 未签名 + portable 备选。
- 0.7.6 的成长记录、成长对话框、任务文件审阅都只在测试中验证过，没有在真实项目上完整走一遍。
- 成长是“模型在复盘回合里写资产文件”，没有跨项目证据门槛，也不会自动改变成员的核心提示词；它不能当作“已实现成长”来对用户宣称。
- 完成事件是 renderer 级 `localStorage`，按浏览器/应用数据隔离；交付记录/SQLite 才是任务事实源。
- 任务 dock 只展示活跃任务；历史通过交付记录查看。
- 旧完整 social UI 不再挂载，七个 renderer 模块保留为 dormant；旧 `noema-project-executor.mjs` 保留为 fallback。不要仅凭零引用删除，恢复需要真实入口和验收。
- AgentRuntime 阶段 1 只接入 Noema 的回合事件和工具轨迹；执行者核心已创建，但执行仍由 `SocialWorkService`/DSH 承担，执行者自己的运行事件尚未接入。可见执行者私聊目前是已有 specialist direct room，不新增独立 AgentRuntime 事件流；`@Noema` 尚未接入。Core Chat 不经过旧 `RootAgent`。
- 编辑仍是破坏性截断/覆盖：旧用户消息及后续消息被删除，助手旧正文被覆盖；删除/覆盖前已写入 `conversation_archives`，顶栏可恢复最近一次存档，但恢复只回退对话，不随对话回滚工作区文件。
- 架构图由 `figure:check` 保证与 `docs/ARCHITECTURE.md` 同步：改了架构文档必须运行 `npm run figure:build`（需要本机 Archify 技能与 Edge），CI 只跑 `figure:check`，不重出图。
- `main.ts` 仍是组合根；main/service/UI 的进一步拆分以真实缺口为驱动，不做无验收的大搬迁。
- 项目工作区选择在项目创建时完成；项目创建后更换目录仍走对话框，取消选择不改变已有绑定。
- `apps/desktop/out/Noema-win32-x64/resources/app.asar` 曾被本会话 DSH desktop-host 进程的只读句柄（share mode 不含 `FILE_SHARE_DELETE`）占住，导致 `make` 回退 `.tmp/forge-out`（D-024）；句柄关闭后默认 `out/` 可用。属本机进程占用，不是产品缺陷，CI 不受影响。

## 计划在哪

STATUS 不写计划（D-026）：候选能力与顺序在 [GitHub Project「Noema V1 路线」](https://github.com/orgs/Noema-Harness/projects/1) 的卡片上，卡片状态就是当前进度；本轮切口的执行计划在 `openspec/changes/` 的活动变更里。两者都变化频繁，本文档不镜像。

## 交付判断

当前是可日常使用的 0.7.6 工程版，不是已完成 V1。核心对话、编辑/存档/恢复、执行链路和项目成长记录可用；组织模型、成长证据门槛、会话拓扑、六模块、工作区回滚和证据完整性仍是未交付项。任何“完成”结论必须有文件/命令/测试证据，不能以模型自述或计划代替。
