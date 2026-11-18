# STATUS

Authority: 本文件只回答一个问题——按现有证据，今天这个版本能说到什么程度。内容是当前版本、最后一次验证的证据、未验证项与交付判断。
Update when: 每次交付、打包或验证结果变化。
Does not own: 产品行为与边界（见 [PRODUCT](PRODUCT.md)）；结构与代码实况（见 [ARCHITECTURE](ARCHITECTURE.md)）；决定与理由（见 [DECISIONS](DECISIONS.md)）；命令、安装与诊断（见 [OPERATIONS](OPERATIONS.md)）；治理与门槛（见 [AGENTS](../AGENTS.md)）；计划与进度（见 GitHub Project 看板与 `openspec/changes/`，D-026）。

最后更新：2026-11-18

## 版本与基线

- 源码版本：`0.7.6`；当前源码基线：`f592a9b release: Noema 0.7.6`；功能基线 `b7c41fa`。
- 便携构建在 `apps/desktop/out/Noema-win32-x64/Noema.exe`；安装包由 `npm run make:desktop` 产出（构建陷阱与回退见 [OPERATIONS](OPERATIONS.md)，决定见 D-024）。

## 最后一次验证（2026-11-18）

- 条目创建两步门（change `decision-entry-approval`，2026-11-18）：新建条目前先申请，不能先建后说。`npm run decision:draft` 只写 `.work/decisions-draft/<id>.md`（含“草稿，未落库”头）并打印「本次条目创建是否已得到用户明确批准？批准原话是哪一句？」，不碰 `docs/DECISIONS.md`；`npm run decision:accept -- <D-…> --approval "<用户原话>"` 要求原话 ≥10 字，把 `批准创建（用户原话：「…」，日期）` 追加进「来源」，先按 `checkDecisionEntries` 校验草稿全文、通过才写入并删草稿，失败抛「草稿落库前校验失败（条目没有写进文件）」并保留草稿。规则写进 `AGENTS.md`（新建条目前先申请）、`skills/noema-development`（draft/accept 用法）、`docs/OPERATIONS.md`（命令与失败修法）、`docs/DECISIONS.md` 头部。证据：`npm run decision-entry:test` **7/7**、`npm run tools:test` **62/62**、`npm run check` **901/901，0 fail，76,418ms**（链含 `docs:check`、`figure:check`、`tools:test`、`test`）、治理图按章节判断重出（source `b2e0fc3fe387`，理由：AGENTS 只多一条规则，三层与节点关系未变）。

- macOS 临时目录软链（change `macos-tmpdir-realpath`，PR #167，2026-11-18，协作者 `ichika0130`）：macOS 的 `os.tmpdir()` 是 `/var/folders/…` 软链、真实路径在 `/private/var/folders/…`，两个测试的临时目录改为 `realpathSync(mkdtempSync(…))` 先取真实路径，`test-support/electron/isolated-worker-e2e.mjs` 的结果路径检查与 `writeResult()` 同口径（数据库与工作区仍按真实路径校验，防软链逃逸不削弱）。macOS + Node 24 全量 `npm test` 由 880 过 / 8 败转为 **888 过 / 0 败 / 13 跳过**（跳过的是既有 `windowsOnly` 等标记），`npm run typecheck`、`npm run lint` 通过。CI run `44166645986`（verify、portable、platform、collaboration）与 `44166646301`（windows / ubuntu / macos 三个 package job）全绿。产品可观察行为不变（仅测试与测试辅助）。

- 成员经历（change `member-asset-review`，2026-11-17）：`npm run check` **901/901，0 fail，53,356ms**（链含 `workspace:check` → `branches:check` → `docs:check` → `figure:check` → `plan:check` → `source:check` → `lint` → `typecheck` → `tools:test` → `test`）。

- 开工仪式（change `execution-ritual`，2026-11-17）：讨论期只写条目、文档与调研，不动产品代码；进执行前走 DSH 计划模式（`/plan` → `exit_plan_mode` 交开工清单：改哪些文件或模块、建哪个 `openspec/changes/`、怎么验证），用户批准后才动手，回答设计问题/选选项/含糊「可以」不算授权；条目决定可写 `用户原话：「…」，YYYY-MM-DD`（原话 ≥10 字，机器门拒绝短引用与自盖的「用户确认」）。`.work` 只放一次性材料（文档、载荷、探针、日志、截图），收口后删除，`npm run workspace:clean -- --days N` 按保留期清理（保留目录见 `scripts/workspace.config.json` 的 `artifactRetention`）。证据：`npm run check` **901/901，0 fail，54,407ms**、`tools:test` 54/54、治理图按章节判断重出（`f93223312764`）；`.work` 从 2,705 文件 / 940MB 降到 109 个顶层条目 / 666MB（余 `releases/`、`session-compact/` 为保留项）。同轮修掉一个静默漏洞：条目标题阶段标记写错（如 `## 💬 D-…`）时条目不被解析、从 `npm run review` 消失并把正文并进上一条，`docs:check` 也不报；现由 `checkDecisionEntries` 拒绝并给出修法（`maintenance.test.mjs` 26/26）。

- 门归属（change `gate-ownership`，2026-11-17）：PR 的 `verify` 把架构图漂移降为提示（`NOEMA_FIGURE_SOFT=1`），`main` 与里程碑仍严格，图由维护者重出；新增报告期的 `portable` job（`ubuntu-latest` 跑同一套测试、不拦 PR），先暴露 Windows-only 用例，按 `D-20261116-platform-layers` 第③刀标记后转必过（已于 2026-11-17 落地，见下节）。本机 `npm run check` 890/890、0 fail、67,571ms。soft 只由 `figure:check` 的命令行读取，库调用默认严格，`figure.test.mjs` 因此在 `NOEMA_FIGURE_SOFT=1` 下也通过（PR #164 verify 修复）。
- `npm run check`（= `governance milestone`）：**887/887，0 fail，52,458ms**；链为 `workspace:check` → `branches:check` → `docs:check` → `figure:check` → `plan:check` → `source:check` → `lint` → `typecheck` → `tools:test`（80 个维护脚本测试）→ `test`。
- 安装包：`npm run make:desktop` 产出 `Noema-0.7.6 Setup.exe`（170,410,496 字节，sha256 `6E773C854FBF6E4B0A39720608737555114E5E95E9F5526F1E05D7A32964BCDC`）、`noema_desktop-0.7.6-full.nupkg`、`RELEASES`；把 `TEMP`/`SQUIRREL_TEMP` 指到可写目录后 `Setup.exe --silent` 能装出 `app-0.7.6`（载荷验证）。
- CI：run `43699905215` success（9.9 分钟，commit `ed11513`），干净 Windows runner 上含 `make:desktop` 与安装/升级/卸载数据保留验证。
- 架构图：`figure:build` 端到端跑通（Archify 四 gate 全 pass → Edge 截图 → 摘要回写），`figure:check` 保证与 `docs/ARCHITECTURE.md` 同步。
- TypeScript 迁移：PR #131 合并了第一批 57 个主进程模块（`d32257e`），PR #146 合并了第二批 39 个 ≤330 行模块（只改类型、不改行为，决定见 D-039）；`apps/desktop/src` 剩余 `.mjs` 28 个，`source:check` 上限同步下调到 28。验证：`tsc --noEmit` 0 错误、全量测试 885/885、88 个改动文件 oxfmt 通过。
- macOS 开发环境（2026-11-16）：`.githooks/pre-commit` 带可执行位（`100755`）；合并提交只检查与两个父提交都不同的路径（`stagedPaths`，新增单测）；锁文件补齐 oxlint 的 darwin-arm64/darwin-x64/linux-x64/linux-arm64 原生包，macOS 上 `npm run lint` 可跑。来自协作者的 #154（原 PR #150），本机验证 `maintenance.test.mjs` 20/20。
- 计划先于代码（change `plan-before-code`）：`pre-commit` 在提交产品代码时要求本轮 change 已在 `HEAD`，否则报“本轮变更的计划还没有提交”；计划与实现因此分成两次提交。
- 交付观察口（D-20261115-delivery-observability）：产品变更的 `design.md` 必须写「用户可观察的改变」与「手测步骤」（`plan:check` 强制），`milestone:check` 要求 tasks 记“更新卡片正文”；决定编号改为 `D-YYYYMMDD-<短名>`（D-20261115-decision-ids）。
- 治理模型（change `governance-model`）：规则登记表 `RULES` 与 `node scripts/governance.mjs audit` 落地（26 条拦截 / 3 条提醒 / 5 条观察期）；兼容层检查降为提醒；无证据规则（待决上限、DECISIONS 五字段必填）已删。新建规则须有一次真实触发记录，观察期规则连续两个里程碑无触发即降级（D-20261115-governance-model）。
- 治理时间轴（change `lifecycle-table`）：流程文字收成一张表 `scripts/lifecycle.mjs`（决策中/执行中/待验收/已收口，每次转移绑一道门，重开回决策中），`scripts/maintenance.mjs` 的阶段枚举引用它；`AGENTS.md` 从 108 行 / 21,023 字节压到 44 行 / 2,752 字节，只留时间轴、事实所有权、何时问人、五条不变量与边界；命令与修法在 OPERATIONS、模板在技能。同时按“决议是存思考的地方”去掉两处过度拦截：待验收不再限制开新变更（只阻塞自身里程碑），产品代码也不再因任意未决/待验收条目被挡。治理全景图的“九步执行”改为“一轮推进（四态与门）”。证据：`node --test scripts/lifecycle.test.mjs scripts/maintenance.test.mjs` 26/26、`npm run tools:test` 80/80、`figure:check` 两图通过。
- 规划层与执行层（change `evidence-in-repo`）：`milestone:check` 不再要求卡片证据评论，只要求 tasks 记“更新卡片正文”；14 张能力卡正文统一为「现在能做什么（含手测步骤）/ 还没做 / 边界」并清空 11 条交付评论；交付证据留在提交信息、变更 tasks 与 STATUS（D-20261115-evidence-in-repo，D-037 作废）。
- 成长写入（change `project-growth-integrity`）：迁移 43 重建 `social_project_growth_members`（`brief` 只在 `completed` 必填，历史 `no_change` 简报已清空）；provider 对“工具调用写成正文”先做一次修正重试，仍失败返回可重试错误；`no_change` 不再保存或注入简报。规格已合并进 `openspec/specs/specialist-agents/spec.md`。
- DSH 支持 macOS（change `dsh-macos`，PR #149 已合并）：`resolveDshHeadlessRuntime` 在 macOS 上从打包目录 `dsh-runtime/node` 或 PATH 上的 npm 全局 `dsh`（解析到 `@deepseek-ai/dsh/lib/bin.js`）加 Node 24.21+ 启动 DSH；worker 补丁只开宿主平台的 shell 工具（macOS `tool-bash`、Windows `tool-pwsh`），环境白名单按平台。平台事实集中在新模块 `src/main/platform/host-platform.ts`，适配器与 `stage-dsh-runtime.mjs` 不再自己判断平台。本机实测：Mac 版 DSH 0.2.2-rc.1 在 Noema 补丁下 `--dump-config` 显示 `tool-bash` 开、`tool-pwsh`/`pwsh-sandbox` 关；macOS + Node 24 全量 885 个测试 864 过、20 败（均为只在 Windows 上能过的用例，无新增），原先 2 个 Windows 专属的 DSH 查找测试现在任一主机可过。`npm run e2e:dsh-fake-model`（本地假模型驱动真实 DSH）4 项全过：可写模式 `ls` 返回工作区清单、`touch` 写入工作区、只读模式拒绝写入、可写模式拒绝写到家目录（临时目录可写是 DSH 可写模式的默认行为）。2026-11-15 同机实测：`npm run smoke` 通过，`npm run package` 产出 `Noema-darwin-arm64/Noema.app` 并能启动建库。

- 工作区检查（2026-11-15）：`0e621c8` 在仓库根新增 `skills/` 但没登记进 `scripts/workspace.config.json` 的 `rootDirectories`，main 与之后合并的 PR 的 `workspace:check` 都失败；已在 PR #149 登记，本机 `node scripts/workspace.mjs check` 只剩本机目录 `.claude`（CI 中不存在）。

- 平台侧提交门（2026-11-16）：`Desktop checks` 的 `range` 步骤在 PR diff 上跑提交门（`node scripts/maintenance.mjs range --base origin/<base>`）：产品代码必须带计划/状态、未确认决议不能改产品代码、治理变更不夹带产品代码；协作者不装本机钩子也躲不过。`scripts/maintenance.test.mjs` 17/17，`tools:test` 53/53。
- 协作契约（2026-11-16）：`CONTRIBUTING.md` 重写为协作者契约；`scripts/collaboration.mjs` 在 PR 上拦维护者路径（CI job `collaboration`）；CI 拆 `Desktop checks`（`npm run check`）与 `Desktop package`（触达桌面端才跑）；PR #149 审核结论见 `openspec/changes/workflow-closure/design.md`。
- 公开仓库与分支保护（2026-11-16）：仓库 `visibility=public`（Free 组织 public 仓库的标准 runner 免费，此前的 Actions 额度故障解除）；`main` 启用保护——`verify`、`collaboration`、`platform` 必过（strict）、至少 1 位维护者审核、新提交 dismiss 旧审核、对话必须解决、禁 force push 与删除，`enforce_admins: false`；MIT 许可已补齐（`LICENSE`、`package.json`、README）。保护设置核对：`gh api repos/Noema-Harness/noema-agent/branches/main/protection`。

- 治理收口（change `workflow-closure`，2026-11-16）：AGENTS 收敛为九步 + 三类出口 + 事实所有权 + 门槛 + 工程边界；design 强制 `## 事实影响` 并由提交门/PR 门按类别配对；4 条原「预防」规则改观察期；六角色表删除、工作流图暂不入库（`.work/workflow/`，待结构稳定后再进 `docs/assets/`）。证据：`docs:check` OK、`plan:check` OK、`scripts/maintenance.test.mjs` 19/19、`tools:test` 55/55、`governance audit` 22 拦截 / 2 提醒 / 4 观察期。

- **平台门（2026-11-16）**：`platform` job 在 main 推送与每个 PR 上检查“本地至多一个活动变更、main 的树没有未收口变更”；main 还留着未收口变更时 PR 会显式报「main 上还有未收口 change」。证据：`scripts/maintenance.test.mjs` 18/18、`npm run tools:test` 55/55、`node scripts/maintenance.mjs platform` 在当前 main 上按预期失败（待验收的 workflow-closure）。

## 成员经历（2026-11-17）

- 成员可以查看、删除、恢复自己的经历（change `member-asset-review`，卡片 #137）：成员列表每行新增「经历」按钮，对话框列出路径、修订号、写入依据、来源项目与时间，展开可读全文；删除保留墓碑（列表里标“已删除”）并从历史版本恢复；归档成员只读。bridge 新增五个通道（`noema:social-agent-assets` / `-asset` / `-asset-history` / `-asset-delete` / `-asset-restore`），service 固定用户操作理由（`用户在成员资料中手动删除` / `手动恢复`），store 的 `listAgentAssets` 支持 `includeDeleted`——用户视图必须看到已删除条目，否则没有恢复入口。
- 证据：`npm run typecheck`；`test/main/ipc/bridge-transport.test.mjs` 7/7；`test/main/chat/social-chat-service.test.mjs` 成员资产用例（写入 → 列表 → 删除 → 墓碑 → 历史恢复 → 归档只读）；`npm run check` **901/901、0 fail**。
- 未做：界面真机手测（见「未验证」）；成长写入候选态与真实复盘重跑仍挂在卡片 #137 的「还没做」。

## 平台解耦（2026-11-17）

- 第①刀（PR #162，`c329d84`）：新增执行后端端口 `apps/desktop/src/main/runtime/work-runtime.ts`（`WorkRuntime.startTask` → `{ started, done, stop }` + 五类事件），DSH 与 native 后端各声明实现；`platform/workspace-identity.ts` 的 `workspacePathKey()` 收拢 Windows 路径折叠；`diagnostics/database-recovery.ts` 去掉 Electron 类型引用；`main/chat`、stores 等核心目录不再比较 `process.platform`。
- 第②刀（change `package-ci-matrix`，2026-11-17，run `43987410699` 三平台绿）：`apps/desktop/scripts/smoke-package.mjs` 按宿主平台解析产物（win32 `Noema.exe`、linux `Noema`、darwin `Noema.app/Contents/MacOS/Noema`，默认目录 `out/Noema-<platform>-<arch>`），Windows runner 与托盘断言只在 win32 执行；`Desktop package` 改为 `windows-latest`/`ubuntu-latest`/`macos-latest` 矩阵，三平台各自 `package:desktop` + 产物冒烟 + `make`（Linux 装 `xvfb`，冒烟用 `xvfb-run` + 测试侧 `--no-sandbox`），Windows 保留 dev smoke 与 Squirrel 安装生命周期；artifact 按平台命名并各自上传。Linux 产物为 DEB（`MakerDeb` 传 `bin: 'Noema'`，helper 走 `optionalDependencies`）；RPM maker 已移除——`electron-installer-redhat@4.0.0` 与 rpmbuild ≥ 4.20 不兼容，产品也不发布 RPM。产品仍只发布 Windows 包。
- 第③刀（change `platform-windows-only-tests`，2026-11-17）：新增 `apps/desktop/test/support/platform-cases.mjs` 的 `windowsOnly(reason)`（非 Windows 输出 `Windows-only: <原因>` 并跳过，Windows 上照常执行）；12 条 Ubuntu 失败用例按 CI 日志逐条标记（盘符 `path.resolve`/`path.isAbsolute` 2 条、`C:\` 绝对路径 1 条、`\` 分隔符/`..\` 越界/`cmd.exe` 进程树 5 条、`cd /d` 命令 1 条、`path.win32` 校验 3 条）；`portable` job 去掉 `continue-on-error`，PR 上 Ubuntu 测试失败即拦。Windows 用例集合不变；本机 `npm run check` **894/894、0 fail**（新增 3 条辅助测试与 1 条同类用例）。CI run `43978450945`（`workflow_dispatch`，提交 `5938ecf`）：`portable` 1m14s 绿（894 tests / 881 pass / **0 fail** / 13 skipped，其中 12 条是本轮标记、1 条是既有条件跳过）、`verify` 3m15s 绿、`platform` 绿；`collaboration` 在 dispatch 下按设计跳过。
- 边界检查：核心目录（`main/{agents,archive,chat,diagnostics,mcp,plugins,projects,providers,runtime,storage,tools}` + `src/shared`）的导入与 `process.platform` 规则由 `npm run source:check`（`scripts/source-structure.mjs`）承载；过渡测试 `test/main/core-boundary.test.mjs` 已删除（issue #156，2026-11-17）。
- 验证：Windows 10 `npm run check` **893/893，0 fail**（issue #156 后；894 减去删除的 2 条过渡测试、加上 1 条结构检查）；`verify`/`platform`/`collaboration` CI 全绿；`figure:check` 通过（架构图重出提交 `e12d59b`）。
- 第④刀（change `bridge-transport`，2026-11-17）：`window.noema` 的组装从 preload 抽到 `apps/desktop/src/shared/bridge/create-bridge.ts`，只依赖 `BridgeTransport`（`invoke` 一次请求、`on` 一次事件）；Electron 传输在 `src/preload/electron-transport.ts`，`preload.ts` 只剩 `contextBridge.exposeInMainWorld`；宿主通道由 `src/main/ipc/bridge-router.ts` 统一登记与分发（重复注册、未知通道报错），`root-ipc.mjs` 保留窗口授权与 dispose。用户选择本轮只做传输抽象，不做配对、鉴权或伴侣客户端；通道名、事件名与用户可观察行为不变。新增 `test/main/ipc/bridge-transport.test.mjs` 6 条（路由、方法映射、订阅退订、probe 开关、无 Electron 的假传输往返）。本机 `npm run check` **899/899、0 fail**（893 + 6 条；`governance: milestone OK`）；打包产物冒烟通过（`npm run package:desktop` + `npm run smoke:package`，真实 `app.asar` 里 `window.noema` 的社交状态/房间/诊断探针可用）。本机 dev smoke 未跑通：5173 落在 Windows 动态端口保留区（`EACCES`，本机无管理员释放），属环境限制，CI 的 Windows runner 不受影响。
- 未做：无；四刀已全部落地（①PR #162，②③④2026-11-17）。

## 治理机制记录

治理机制的落地记录与证据见 `governance/noema/changelog.md`；本页只写产品今天能用到哪、未验证什么。

## 未验证

- 真实 provider 的完整对话链与长时运行。
- 真实 `%LOCALAPPDATA%` 安装与跨版本升级：本机工作区带 Low 完整性标签，区内构建的 exe 写不了用户目录；CI 覆盖了这条路径，本机只验证到载荷安装。
- 真实项目上把成长批次跑通并产出资产：本轮只修写入可靠性（测试覆盖迁移与修正重试），没有在真实 provider 上重跑一次项目复盘；现有真实样本仍是一次 `no_change` 的失败记录。
- 类型检查覆盖（D-039）：`src` 下仍有 67 个 `.mjs` 不受类型检查（含 `social-chat-service`/`social-chat-store`/`social-work-service`/`root-store`/`root-ipc`），`strict` 未在 tsconfig 显式开启（TypeScript 6.0.3 的默认值生效，后续按 D-039 评估）；已转换的 `.ts` 由 `npm run typecheck` 覆盖，`source:check` 保证 `.mjs` 数量只减不增。
- macOS/Linux 真机安装与启动：CI 只验证打包产物能启动（`smoke:package`）；用户 2026-11-17 确认以此为验收口径，macOS 真机由协作者后续实机反馈，Linux 真机未安排。
- macOS 上用真实模型从界面派发一个跑命令的项目任务（DSH 执行路径已由 `e2e:dsh-fake-model` 验证，界面与真实模型这一段未跑）；未签名 Mac 包在别的机器上能否打开；Linux 只走同一条 POSIX 分支，未实测。
- macOS 全量测试由协作者在 macOS 上执行（PR #167：888 过 / 0 败 / 13 跳过），维护者本机是 Windows，CI 的 macos-latest 只跑打包与产物启动冒烟、不跑全量 `npm test`；这条仍依赖协作者反馈。
- 成员经历界面的真机手测：本机 harness 会话里 Electron 进程无法创建窗口（最小探针也立即退出，记事本能开窗），入口位置、信息量与删除/恢复手感没有人走过；自动证据只覆盖通道、service 与 store。

## 交付判断

维护层已收口（`maintenance-workflow-v3`、`delivery-observability`、`governance-model` 均已归档）。产品侧第一刀是 `project-growth-integrity`（2026-11-15 归档，规格合并进 `openspec/specs/specialist-agents/spec.md`）：成长复盘只在真的写入经历时记 `completed`，`no_change` 不保存也不注入简报，迁移 43 清掉历史污染文本。看板 C6 #137 仍在 In Progress，剩余项是成员经历可查看/删除与真实 provider 重跑验收。

0.7.6 是可日常使用的工程版，不是完成 V1。上面的未验证项就是当前证据的上限；“完成”只能由文件、命令或测试证据支撑，不能以模型自述或计划代替。
