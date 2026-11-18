# Noema 适配层

内核契约（`../core/README.md`）在本仓库的落地：文档路径、看板、命令、CI 接线与两处例外。

## 文档路径

| 事实 | 位置 | 说明 |
|---|---|---|
| 产品定位、角色、可观察行为 | `docs/PRODUCT.md` | 产品本体 |
| 结构与边界、数据与代码地图 | `docs/ARCHITECTURE.md` | 产品本体 |
| 取舍与理由、条目记录 | `docs/DECISIONS.md` | 治理核心基础（例外：条目格式与记录留在这里） |
| 命令、环境、失败修法、发布 | `docs/OPERATIONS.md` | 命令与修法；治理规则指回本目录 |
| 今天能用到哪、未验证什么 | `docs/STATUS.md` | 只写已发生的事实 |
| 系统层规则 | `AGENTS.md` | 阶段地图 + 边界 + 指针（例外：治理只能挂载） |
| 本轮增量 | `openspec/changes/<name>/` | 执行主体 |

权威文档清单登记在 `scripts/workspace.config.json` 的 `currentDocuments`，`npm run docs:check` 校验。新增权威文档要 one-in-one-out，并同步 `AGENTS.md` 的文档表。

## 看板

排序与状态只在 [GitHub Project「Noema V1 路线」](https://github.com/orgs/Noema-Harness/projects/1)，不在文档里镜像。卡片 `[C<n>]` issue 表示能力与交付状态（Done / In Progress / Todo）；「本轮正在做」由活动 change 表示，至多 1 个。卡片正文只写现在：现在能做什么（含手测步骤）/ 还没做；证据留在提交、change 与 `STATUS`。

## 命令接线

治理命令的实现都在 `scripts/`（批次二新增，见根 `package.json`）：

| 命令 | 脚本 | 门 |
|---|---|---|
| `npm run review` | `scripts/review.mjs` | 只读 |
| `npm run decision:draft` / `decision:accept` | `scripts/decision-entry.mjs` | 原话准入 |
| `npm run decisions:sync` | `scripts/review.mjs` | 标题与勾选同步 |
| `npm run docs:check` / `figure:check` / `plan:check` / `milestone:check` | `scripts/maintenance.mjs`、`scripts/figure.mjs` | 产物门 |
| `npm run check` | `scripts/governance.mjs` | 里程碑全量门 |
| `npm run stage -- <阶段>` | 批次二 | 阶段注入 |
| `npm run transition -- <kind>` | 批次二 | 过渡文档注入 |
| `npm run decision round/settle/advance` | 批次二 | 行为门 |

检查项引用门规则时用 `gate:<id>`，id 取自 `scripts/governance.mjs` 的 `RULES`。

## CI 接线

`.github/workflows/desktop-checks.yml`：

- `verify`：PR 与 main 推送都跑 `npm run check`（Windows）。
- `platform`：PR 上 `--base origin/<base>` 只校验本 PR 新开的 change；main 推送要求全树 0 个未收口。
- `collaboration`：PR 治理字段与路径守卫（维护者独占路径见 `scripts/collaboration.mjs` 的 `MAINTAINER_ONLY_PATHS`）。
- `portable`：PR 在 Ubuntu 跑测试；Windows-only 用例用 `windowsOnly(reason)` 标记。

本机提交门：`git config core.hooksPath .githooks`（维护者本机安装，协作者靠 `npm run check`）。

## 阶段规则包与模板

- `workflow/discussion.md`：讨论段——默认只产出证据、怎么记、会议总结与两次确认、例外协议。
- `workflow/execution.md`：执行段——进入条件、低干扰、change 分工、退回、交接。
- `workflow/acceptance.md`：验收段——验收页、三种标记、禁止项、收口权限。
- `workflow/transition/`：设计方案、条目收口、开工清单、执行交接、验收报告五份模板。

## 治理图

`assets/noema-governance.png`（交互版 `.html`，源 `assets/noema-governance.source.json`）。图源章节固定为「怎么推进一件工作」「事实所有权」；章节漂移时用 `npm run figure:build -- --sections-changed "理由"` 记录判断，不手改 candidate。

## 引用位置

`AGENTS.md` 顶部的治理入口、`docs/OPERATIONS.md` 的治理规则指针、`docs/STATUS.md` 的治理事实指针、两份技能的入口，都指向本目录。