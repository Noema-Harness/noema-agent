# 维护与协作门（Noema 适配）

维护门槛、审核入口与协作检查的完整说明在这里；命令与失败修法留在 `docs/OPERATIONS.md`。

## 门槛三层

门槛分三个频率，入口统一在 `scripts/governance.mjs`：`commit`（提交点，秒级）、`milestone`（一个切口收口时，全量）、`ci`（与 milestone 同源）。`npm run check` 即 `governance milestone`；`docs:check`/`figure:check`/`plan:check` 是同一批规则的单独入口（调试用），`milestone:check` 在归档前手动跑。规则清单登记在 `scripts/governance.mjs` 的 `RULES`：每条规则写明支撑的不变量、防的失败、触发证据与执行位置。`node scripts/governance.mjs audit` 打印登记表并列出观察期规则——连续两个里程碑没有触发就降级为提醒。

计划与状态边界（D-026）：`docs/STATUS.md` 只写已经发生的事实（版本、已验证证据、未交付、已知限制），不写「下一步」；候选与顺序在 GitHub 看板，本轮切口的执行计划在 `openspec/changes/`。写文档时如果想把“接下来做什么”写进 STATUS，改成更新卡片状态，或在活动变更的 tasks 里记。

## 审核入口与决议条目

`docs/DECISIONS.md` 只在需要用户定夺时才有条目（用户要求 / 多方案拍板 / 跨轮次不可逆取舍），普通工作不建条目。条目存在时它是用户审核的信息源（D-20261116-review-inbox）：

- 标题：`## D-… 标题`；有看板 issue 时写 `## [#N](https://github.com/Noema-Harness/noema-agent/issues/N) D-… 标题`（链接就是用户在 GitHub 上的入口）。
- 字段：第一条固定是 `- **阶段**：决策中 / 执行中 / 待验收 / 已收口`；其后按需写 `- **结构**`（机制类：入口 / 字段 / 校验 / 命令）、`- **来源**`、`- **阻塞**`。没有形态、状态、看板、用户确认字段——阶段就是状态。
- 三层：`#### 1 决策`（确认后写 `- 决定：`）、`#### 2 执行`（批次 / 发现）、`#### 3 验收`（立项写 v0，交付前按实际更新；已收口在末尾写 `- 用户确认：YYYY-MM-DD`）。阶段可回退：追加「重开」行、旧结论标“已被重开”、受影响 tasks 重开。
- 验收项写成 `- [ ] 怎么验 — 怎么跑`，在 GitHub 上直接勾选；勾完运行 `npm run decisions:sync`，全部勾选的待验收条目自动改 `已收口` 并补 `- 用户确认：当天日期`（`--dry-run` 预览）。
- `npm run review` 只读汇总「需要你决定 / 待你验收 / 执行中」，待验收条目显示勾选进度，条目正文仍是唯一权威源；`--json` 给脚本用。
- 新建条目前先申请：`npm run decision:draft -- --title "…" --slug <短名> --body <正文文件>` 只写 `.work/decisions-draft/<D-…>.md`，命令会打印「本次条目创建是否已得到用户明确批准？」并停下；拿到明确答复后才 `npm run decision:accept -- <D-…> --approval "<用户原话>"` 落库（原话≥10 字会写成「来源」里的 `批准创建（用户原话：「…」，日期）`）。没有批准就删草稿，不落库。
- 门：`docs:check` 校验阶段在第一条且在四种里、三层齐全、过决策中后执行层有批次指针、已收口有用户确认；`plan:check` 只把 `待验收` 列为提示；`milestone:check` 不要求 change 对应条目，只在“本变更引用的条目”仍未确认或未验收时拒绝；`pre-commit` 在 决策中/待验收 时挡 `apps/desktop/src/` 改动（本机兜底，约束在流程）。

## 协作与 PR 检查

- 契约：`CONTRIBUTING.md`（协作者可改/不可改、PR 必备、CI 覆盖）。合并只由维护者执行。
- 文档与规格：协作者可直接改 `docs/**` 与 `openspec/specs/**`，在 PR 的「文档改动」段说明原因；审核以代码与运行证据为准，维护者可改写措辞。`docs:check` 在 PR 上同样运行，未登记文档、缺头、决议结构错误都会被拦。
- 分支保护：2026-11-16 仓库转为 public（Free 组织的 public 仓库可以启用保护，标准 runner 免费）。`main` 已开启保护：必须通过 `verify` 与 `collaboration` 检查、至少 1 位维护者审核、新提交 dismiss 旧审核、对话必须解决、禁止 force push 与删除；`enforce_admins: false`，维护者可紧急绕过。核对：`gh api repos/Noema-Harness/noema-agent/branches/main/protection`。
- CI：`Desktop checks` 在 PR 与 main 推送上都跑 `npm run check`，并用 `range` 步骤把提交门套在 PR diff 上（`node scripts/maintenance.mjs range --base origin/<base>`：产品代码必须带计划/状态，未确认决议不能改产品代码）；另执行 `collaboration` 路径检查；`platform` 在 PR 上用 `--base origin/<base>` 只校验本 PR 新开的 change（base 上已有的未收口仍报错），main 推送要求全树 0 个未收口。`Desktop package` 只在触及 `apps/desktop/**`、`package.json` 或锁文件时（PR）与手动 `workflow_dispatch` 时跑：`windows-latest`/`ubuntu-latest`/`macos-latest` 三平台矩阵各自 `npm ci` → `package:desktop` → 产物冒烟 → `make`，Windows 额外跑 dev smoke 与 Squirrel 安装生命周期；发布前用 `gh workflow run "Desktop package"` 跑全流程。
- 可移植性门：PR 上的 `portable` job 在 `ubuntu-latest` 跑 `npm test`，失败就拦 PR（`D-20261116-platform-layers` 第③刀，2026-11-17 起不再报告期）。main 推送不跑它（推送走 `verify` + `platform` 快速路径）；发布前要确认整棵树在 Ubuntu 的结果，用 `gh workflow run "Desktop checks" --ref main` 手动触发。
  - 只有 Windows 才能验证的用例在文件内显式标记：`test('…', windowsOnly('跳过原因'), () => …)`，辅助在 `apps/desktop/test/support/platform-cases.mjs`；非 Windows 上输出 `Windows-only: <原因>` 并跳过，Windows 上照常执行。
  - 新用例默认必须两平台可过；发现平台耦合时先判断是不是产品代码里的平台假设，是则按第①刀把判断移进宿主层，只有确实验证 Windows 语义（盘符、`\` 分隔符、`cmd.exe`/`taskkill.exe`、`path.win32` 校验）才标记跳过。
  - 当前跳过清单共 12 条：`runtime-paths.test.mjs` 2、`social-chat-store.test.mjs` 1、`noema-project-executor.test.mjs` 5、`social-work-command-runner.test.mjs` 1、`windows-runner-native-helper.test.mjs` 3；标记依据见 `openspec/changes/archive/*-platform-windows-only-tests/`。
- Actions 额度：2026-11-16 曾因组织 Free 额度用尽，所有 job 4 秒内失败、注释为「recent account payments have failed or your spending limit needs to be increased」；同日仓库转 public 后标准 runner 免费，故障消失。若再现同类空日志 4 秒失败，先查 `https://github.com/organizations/Noema-Harness/settings/billing/budgets`。
- 路径检查的身份：PR 上按 **PR 作者**（`github.event.pull_request.user.login`）判定，`main` 推送按推送者（`github.actor`）判定。不能用 `github.actor` 判 PR——它是最后一次推送的人，维护者在协作者分支上补一个 commit 就会把越权 PR 洗绿（回归样本：PR #155 的 run 43862079239 失败、维护者补 commit 后 run 43868086384 通过；修复后第二次也必须是 fail）。
- 本地预演路径检查：`npm run guard -- --actor <登录名> --base origin/main`；维护者返回放行，协作者触碰维护者路径时列出被拦文件并以退出码 1 结束。
- 路径清单源码在 `scripts/collaboration.mjs` 的 `MAINTAINER_ONLY_PATHS`（治理机制：`AGENTS.md`、`.github/`、`.githooks/`、`scripts/`、`openspec/config.yaml`、根 `package.json`），改清单时同步 `CONTRIBUTING.md` 的表。
- 文档门禁不再禁止协作者改文档：路径守卫只管治理机制；文档准确性由审核与 `docs:check` 共同保证，这是 2026-11-16 的决定（用户要求“放开这块限制，重点放在文档改动的审核上”）。
