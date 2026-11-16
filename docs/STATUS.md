# STATUS

Authority: 本文件只回答一个问题——按现有证据，今天这个版本能说到什么程度。内容是当前版本、最后一次验证的证据、未验证项与交付判断。
Update when: 每次交付、打包或验证结果变化。
Does not own: 产品行为与边界（见 [PRODUCT](PRODUCT.md)）；结构与代码实况（见 [ARCHITECTURE](ARCHITECTURE.md)）；决定与理由（见 [DECISIONS](DECISIONS.md)）；命令、安装与诊断（见 [OPERATIONS](OPERATIONS.md)）；治理与门槛（见 [AGENTS](../AGENTS.md)）；计划与进度（见 GitHub Project 看板与 `openspec/changes/`，D-026）。

最后更新：2026-11-16

## 版本与基线

- 源码版本：`0.7.6`；当前源码基线：`f592a9b release: Noema 0.7.6`；功能基线 `b7c41fa`。
- 便携构建在 `apps/desktop/out/Noema-win32-x64/Noema.exe`；安装包由 `npm run make:desktop` 产出（构建陷阱与回退见 [OPERATIONS](OPERATIONS.md)，决定见 D-024）。

## 最后一次验证（2026-11-16）

- `npm run check`（= `governance milestone`）：**887/887，0 fail，57,287ms**；链为 `workspace:check` → `branches:check` → `docs:check` → `figure:check` → `plan:check` → `source:check` → `lint` → `typecheck` → `tools:test`（39 个维护脚本测试）→ `test`。
- 安装包：`npm run make:desktop` 产出 `Noema-0.7.6 Setup.exe`（170,410,496 字节，sha256 `6E773C854FBF6E4B0A39720608737555114E5E95E9F5526F1E05D7A32964BCDC`）、`noema_desktop-0.7.6-full.nupkg`、`RELEASES`；把 `TEMP`/`SQUIRREL_TEMP` 指到可写目录后 `Setup.exe --silent` 能装出 `app-0.7.6`（载荷验证）。
- CI：run `43699905215` success（9.9 分钟，commit `ed11513`），干净 Windows runner 上含 `make:desktop` 与安装/升级/卸载数据保留验证。
- 架构图：`figure:build` 端到端跑通（Archify 四 gate 全 pass → Edge 截图 → 摘要回写），`figure:check` 保证与 `docs/ARCHITECTURE.md` 同步。
- TypeScript 迁移：PR #131 合并了第一批 57 个主进程模块（`d32257e`），PR #146 合并了第二批 39 个 ≤330 行模块（只改类型、不改行为，决定见 D-039）；`apps/desktop/src` 剩余 `.mjs` 28 个，`source:check` 上限同步下调到 28。验证：`tsc --noEmit` 0 错误、全量测试 885/885、88 个改动文件 oxfmt 通过。
- macOS 开发环境（2026-11-16）：`.githooks/pre-commit` 带可执行位（`100755`）；合并提交只检查与两个父提交都不同的路径（`stagedPaths`，新增单测）；锁文件补齐 oxlint 的 darwin-arm64/darwin-x64/linux-x64/linux-arm64 原生包，macOS 上 `npm run lint` 可跑。来自协作者的 #154（原 PR #150），本机验证 `maintenance.test.mjs` 20/20。
- 计划先于代码（change `plan-before-code`）：`pre-commit` 在提交产品代码时要求本轮 change 已在 `HEAD`，否则报“本轮变更的计划还没有提交”；计划与实现因此分成两次提交。
- 交付观察口（D-20261115-delivery-observability）：产品变更的 `design.md` 必须写「用户可观察的改变」与「手测步骤」（`plan:check` 强制），`milestone:check` 要求 tasks 记“更新卡片正文”；决定编号改为 `D-YYYYMMDD-<短名>`（D-20261115-decision-ids）。
- 治理模型（change `governance-model`）：规则登记表 `RULES` 与 `node scripts/governance.mjs audit` 落地（26 条拦截 / 3 条提醒 / 5 条观察期）；兼容层检查降为提醒；无证据规则（待决上限、DECISIONS 五字段必填）已删。新建规则须有一次真实触发记录，观察期规则连续两个里程碑无触发即降级（D-20261115-governance-model）。
- 规划层与执行层（change `evidence-in-repo`）：`milestone:check` 不再要求卡片证据评论，只要求 tasks 记“更新卡片正文”；14 张能力卡正文统一为「现在能做什么（含手测步骤）/ 还没做 / 边界」并清空 11 条交付评论；交付证据留在提交信息、变更 tasks 与 STATUS（D-20261115-evidence-in-repo，D-037 作废）。
- 成长写入（change `project-growth-integrity`）：迁移 43 重建 `social_project_growth_members`（`brief` 只在 `completed` 必填，历史 `no_change` 简报已清空）；provider 对“工具调用写成正文”先做一次修正重试，仍失败返回可重试错误；`no_change` 不再保存或注入简报。规格已合并进 `openspec/specs/specialist-agents/spec.md`。
- DSH 支持 macOS（change `dsh-macos`，PR #149 已合并）：`resolveDshHeadlessRuntime` 在 macOS 上从打包目录 `dsh-runtime/node` 或 PATH 上的 npm 全局 `dsh`（解析到 `@deepseek-ai/dsh/lib/bin.js`）加 Node 24.21+ 启动 DSH；worker 补丁只开宿主平台的 shell 工具（macOS `tool-bash`、Windows `tool-pwsh`），环境白名单按平台。平台事实集中在新模块 `src/main/platform/host-platform.ts`，适配器与 `stage-dsh-runtime.mjs` 不再自己判断平台。本机实测：Mac 版 DSH 0.2.2-rc.1 在 Noema 补丁下 `--dump-config` 显示 `tool-bash` 开、`tool-pwsh`/`pwsh-sandbox` 关；macOS + Node 24 全量 885 个测试 864 过、20 败（均为只在 Windows 上能过的用例，无新增），原先 2 个 Windows 专属的 DSH 查找测试现在任一主机可过。`npm run e2e:dsh-fake-model`（本地假模型驱动真实 DSH）4 项全过：可写模式 `ls` 返回工作区清单、`touch` 写入工作区、只读模式拒绝写入、可写模式拒绝写到家目录（临时目录可写是 DSH 可写模式的默认行为）。2026-11-15 同机实测：`npm run smoke` 通过，`npm run package` 产出 `Noema-darwin-arm64/Noema.app` 并能启动建库。

- 工作区检查（2026-11-15）：`0e621c8` 在仓库根新增 `skills/` 但没登记进 `scripts/workspace.config.json` 的 `rootDirectories`，main 与之后合并的 PR 的 `workspace:check` 都失败；已在 PR #149 登记，本机 `node scripts/workspace.mjs check` 只剩本机目录 `.claude`（CI 中不存在）。

- 平台侧提交门（2026-11-16）：`Desktop checks` 的 `range` 步骤在 PR diff 上跑提交门（`node scripts/maintenance.mjs range --base origin/<base>`）：产品代码必须带计划/状态、未确认决议不能改产品代码、治理变更不夹带产品代码；协作者不装本机钩子也躲不过。`scripts/maintenance.test.mjs` 17/17，`tools:test` 53/53。
- 协作契约（2026-11-16）：`CONTRIBUTING.md` 重写为协作者契约；`scripts/collaboration.mjs` 在 PR 上拦维护者路径（CI job `collaboration`）；CI 拆 `Desktop checks`（`npm run check`）与 `Desktop package`（触达桌面端才跑）；PR #149 审核结论见 `openspec/changes/workflow-closure/design.md`。
- 公开仓库与分支保护（2026-11-16）：仓库 `visibility=public`（Free 组织 public 仓库的标准 runner 免费，此前的 Actions 额度故障解除）；`main` 启用保护——`verify`、`collaboration`、`platform` 必过（strict）、至少 1 位维护者审核、新提交 dismiss 旧审核、对话必须解决、禁 force push 与删除，`enforce_admins: false`；MIT 许可已补齐（`LICENSE`、`package.json`、README）。保护设置核对：`gh api repos/Noema-Harness/noema-agent/branches/main/protection`。

- 治理收口（change `workflow-closure`，2026-11-16）：AGENTS 收敛为九步 + 三类出口 + 事实所有权 + 门槛 + 工程边界；design 强制 `## 事实影响` 并由提交门/PR 门按类别配对；4 条原「预防」规则改观察期；六角色表删除、工作流图暂不入库（`.work/workflow/`，待结构稳定后再进 `docs/assets/`）。证据：`docs:check` OK、`plan:check` OK、`scripts/maintenance.test.mjs` 19/19、`tools:test` 55/55、`governance audit` 22 拦截 / 2 提醒 / 4 观察期。

- **平台门（2026-11-16）**：`platform` job 在 main 推送与每个 PR 上检查“本地至多一个活动变更、main 的树没有未收口变更”；main 还留着未收口变更时 PR 会显式报「main 上还有未收口 change」。证据：`scripts/maintenance.test.mjs` 18/18、`npm run tools:test` 55/55、`node scripts/maintenance.mjs platform` 在当前 main 上按预期失败（待验收的 workflow-closure）。

## 外部收件箱桥（2026-11-16）

- DSH 插件 `plugins/inbox-bridge/`（v1.2.0，默认 2 分钟轮询）+ 仓库侧 `scripts/inbox-bridge.mjs`：外部事件注入下一次对话步骤，三态 pending/delivered/done。
- 低干扰规则：`delivered` 6 小时未处理会再次提醒（`resurfaceMs`）；同组新 run 成功时 `recovered` 自动收口旧失败；`startup_failure` 等基础设施异常归 `infra`，只提醒一次并自动 `done`；同一 workflow+branch 只保留最新一次失败；只在 agent 空闲（回合边界）注入，执行中到达的事件挂起到下一轮（`injectWhileRunning` 默认关闭）。
- 仓库范围：插件从工作区 `origin` 推断 `owner/name`（或显式 `repo`），只拉该仓库；没连仓库时最多 12 小时提示一次，由 agent 转告用户。
- 证据：`node --test scripts/github-inbox.test.mjs scripts/inbox-bridge.test.mjs` 30/30、`plugins/inbox-bridge/index.test.mjs` 6/6；`npm run tools:test` 79/79；`node .work/probe-inbox-plugin.mjs` → injected 1 / delivered；插件已安装为 `dsh-inbox-bridge@1.3.0`（重启 DSH 后在真实会话生效）；旧 Windows 计划任务已删除。
- `npm run inbox` 现在是带状态的列表；`npm run inbox:ack --done -- <key>` 是唯一会停止重复提醒的写法；旧的 `github-inbox.mjs --poll` 仍是抓取后端；来源不可用（gh 掉线/离线）时只打印 `skipped` 并退出 0，不阻塞任何门槛。

## 治理分层（2026-11-16）

- 技能只留模板（立项三件套 + 决议条目骨架），流程/门槛/出口/命令各归 AGENTS 与 OPERATIONS。
- `scripts/figure.mjs` 支持两张图；新增治理全景图 `docs/assets/noema-governance.*`（提示层 / 事实流 / 机器门），AGENTS 顶部链接，不进 README。
- 条目验收项可勾选，勾完 `npm run decisions:sync` 自动收口；`npm run review` 显示勾选进度。

## 未验证

- 真实 provider 的完整对话链与长时运行。
- 真实 `%LOCALAPPDATA%` 安装与跨版本升级：本机工作区带 Low 完整性标签，区内构建的 exe 写不了用户目录；CI 覆盖了这条路径，本机只验证到载荷安装。
- 真实项目上把成长批次跑通并产出资产：本轮只修写入可靠性（测试覆盖迁移与修正重试），没有在真实 provider 上重跑一次项目复盘；现有真实样本仍是一次 `no_change` 的失败记录。
- 类型检查覆盖（D-039）：`src` 下仍有 67 个 `.mjs` 不受类型检查（含 `social-chat-service`/`social-chat-store`/`social-work-service`/`root-store`/`root-ipc`），`strict` 未在 tsconfig 显式开启（TypeScript 6.0.3 的默认值生效，后续按 D-039 评估）；已转换的 `.ts` 由 `npm run typecheck` 覆盖，`source:check` 保证 `.mjs` 数量只减不增。
- macOS 上用真实模型从界面派发一个跑命令的项目任务（DSH 执行路径已由 `e2e:dsh-fake-model` 验证，界面与真实模型这一段未跑）；未签名 Mac 包在别的机器上能否打开；Linux 只走同一条 POSIX 分支，未实测。

## 交付判断

维护层已收口（`maintenance-workflow-v3`、`delivery-observability`、`governance-model` 均已归档）。产品侧第一刀是 `project-growth-integrity`（2026-11-15 归档，规格合并进 `openspec/specs/specialist-agents/spec.md`）：成长复盘只在真的写入经历时记 `completed`，`no_change` 不保存也不注入简报，迁移 43 清掉历史污染文本。看板 C6 #137 仍在 In Progress，剩余项是成员经历可查看/删除与真实 provider 重跑验收。

0.7.6 是可日常使用的工程版，不是完成 V1。上面的未验证项就是当前证据的上限；“完成”只能由文件、命令或测试证据支撑，不能以模型自述或计划代替。
