# 治理落地记录（Noema）

治理机制每次落地的证据与状态。产品事实在 `docs/STATUS.md`；这里只记治理本体。

## 外部收件箱桥（2026-11-16）

- 外部收件箱：工具已移出本仓库（[c3115644151/dsh-inbox-bridge](https://github.com/c3115644151/dsh-inbox-bridge)，版本与配置以那里为准）；本仓库只留 `scripts/inbox.mjs` 转发器（`INBOX_CLI` 或同级 `..\dsh-inbox-bridge`）。
- 低干扰规则：`delivered` 6 小时未处理会再次提醒（`resurfaceMs`）；同组新 run 成功时 `recovered` 自动收口旧失败；`startup_failure` 等基础设施异常归 `infra`，只提醒一次并自动 `done`；同一 workflow+branch 只保留最新一次失败；只在 agent 空闲（回合边界）注入，执行中到达的事件挂起到下一轮（`injectWhileRunning` 默认关闭）。
- 仓库范围：插件从工作区 `origin` 推断 `owner/name`（或显式 `repo`/`INBOX_REPO`），只拉该仓库；没连仓库时最多 12 小时提示一次，由 agent 转告用户。
- 证据：插件自身 `npm test` 38/38（在本仓库已不再运行，随源码一起移走）。
- `npm run inbox` 是带状态的列表；`npm run inbox:ack -- --done -- <key>` 是唯一会停止重复提醒的写法（`--done` 必须在 `--` 之后，否则被 npm 吞掉）；来源不可用（gh 掉线/离线）时只打印 `skipped` 并退出 0，不阻塞任何门槛。

## 治理分层（2026-11-16）

- 技能分两份、各做一件事（change `governance-extraction`）：`noema-development` 留模板（立项三件套 + 决议条目骨架），`noema-governance` 做偏离盘查（三种偏差分类 + 六步，每步带产物；正常轮次不加载）。流程/门槛/出口/命令各归 AGENTS 与 OPERATIONS。
- `scripts/skill-sync.mjs` 用 `SKILL_NAMES` 同步两份技能到 `~/.dsh/skills`，`docs:check` 校验副本一致；`scripts/skill-sync.test.mjs` 5 条覆盖两份安装、单份安装、整份漂移与缺源文件。证据：两份技能 `skill-install: OK`（sha256 `51e27718272d` / `dfb48991bd5d`）、`npm run check` **899/899、0 fail**。
- `scripts/figure.mjs` 支持两张图；新增治理全景图 `docs/assets/noema-governance.*`（提示层 / 事实流 / 机器门），AGENTS 顶部链接，不进 README。
- 条目验收项可勾选，勾完 `npm run decisions:sync` 自动收口；`npm run review` 显示勾选进度。
- 条目归属（2026-11-17，change `decision-entry-ownership`）：`docs/DECISIONS.md` 由用户驱动，只有需要用户拍板、多方案取舍或跨轮次不可逆的才建条目；agent 不自行开条目、不把候选写成决定。盘查技能改成三档出口（直接修 / 只补检查或验证 / 才登记条目），`scripts/maintenance.mjs` 的 `checkDatedEntry` 要求「来源」以「用户」开头、阶段过决策中后「#### 1 决策」必须有「用户确认：YYYY-MM-DD」。证据：`scripts/maintenance.test.mjs` 22/22、`npm run check` **899/899、0 fail**。

- 条目分层（2026-11-17，change `decision-lifecycle-layers`）：条目是一个待定问题的审核入口，不是一轮工作的记录——决策中只写决策层，执行层与验收层各留 `- 未开始：…`，定案后才转入批次、发现与验收。头部只有 阶段/结构/来源/阻塞 四个字段（旧版 `**状态**` 由阶段表达）；一个专案只留一条，讨论收窄不另开占位条目。执行层只允许两样：批次指针（`- 批次：changes/<name>（commit …）`）与影响决定的发现；进度与任务状态看 change 与看板，不抄进条目。阶段过了决策中后没有批次指针，`docs:check` 直接报错，agent 不能凭自述推进阶段（change `decision-execution-pointer`）。证据：`scripts/maintenance.test.mjs` **25/25**；`npm run check` **901/901、0 fail**。

## 图的维护（2026-11-17）

- 图门判定内容（change `figure-content-gate`）：`docs/assets/*.source.json` 记录 `source.sections`（图依赖章节的摘要）与 `source.candidateSha256`；`figure:check` 报章节漂移与 candidate 不符，`figure:build` 在“章节变了但 candidate 没变”时拒绝，`--sections-changed "<理由>"` 记录判断且理由绑定当次章节状态（下次再变要重新判断）。`scripts/figure.test.mjs` 6/6；`npm run check` **899/899、0 fail**。
- 两张图已按当前结构重画：架构图补 bridge 传输、执行后端可换、本机文件与命令、按平台打包状态，计划节点对齐开放卡片（#144 六模块 / #139 会话拓扑 / #140 @Noema 跨房间）；治理图补“提示层 / 事实流 / 机器门”三块区域。
- 证据：测试 PR #165（只改 `docs/ARCHITECTURE.md`、不重出图）run `44004600340` 的 `verify` 在 `NOEMA_FIGURE_SOFT=1` 下 success，日志含两条“PR 只提示：图由维护者在合并前后重出”（整篇 sha 与“2. 进程与依赖方向”章节漂移各一条）。

## 协作文档门禁（2026-11-16）

- 协作者可直接改 `docs/**` 与 `openspec/specs/**`；只有治理机制（`AGENTS.md`、`.github/`、`.githooks/`、`scripts/`、`openspec/config.yaml`、根 `package.json`）维护者独占。审核移到 PR：以代码与运行证据为准，`docs:check` 在 PR 上照跑。
- `platform` 门支持 PR 模式：`node scripts/maintenance.mjs platform --base origin/<base>` 只允许本 PR 新开的 change；main 树仍要求 0 个未收口。CI 的 `platform` job 在 PR 上带 `--base`。
- 证据：`node --test scripts/collaboration.test.mjs scripts/maintenance.test.mjs` 25/25；`npm run check` 887/887（57,783ms）。
