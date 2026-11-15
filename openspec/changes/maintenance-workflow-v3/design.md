# Design

## Context

前两轮维护机制（D-020 门槛 v2、D-022 看板）解决了“不同步会失败”，但留下了三个未收敛的点：

- `docs/STATUS.md` 同时承担「当前状态」与「下一步」，而下一步与看板、change 重复；用户明确要求规划只存在一处。
- 工作流只写在 `AGENTS.md`，实际执行时 change 常被跳过；`plan:check` 只能检查 change 的格式，不能保证“每个交付切口都有 change”。
- 架构图是用户理解系统的主要入口，但纯人工维护：改代码后图不会更新，也没有区分已实现与计划。

## Goals / Non-Goals

Goals：

- 计划只落在看板与 change 两处，各自职责不重叠；STATUS 只写事实。
- 治理变更与产品变更走同一套门槛，但用 `Plan: none` 明确边界，防止治理变更偷渡产品代码。
- 架构图有图源、有产物、有检查，README 只做入口。
- GitHub 事件能在本地被主动发现，不依赖用户转告。
- 把签名与安装口径固定下来（D-025），真实安装演练归属发布卡片。

Non-Goals：

- 不改产品行为、不迁前端、不动 `apps/desktop/src/`。
- 不新增第二个看板、第二套计划或第二份架构说明。
- 不引入需要联网的硬门槛（离线必须可用）。

## 方案

### 1. 计划三层，不再重叠

| 层 | 位置 | 内容 | 变化频率 |
| --- | --- | --- | --- |
| 总规划 | GitHub Project「Noema V1 路线」 | 能力、排序、阶段、Todo/In Progress/Done、里程碑 | 每次选卡/收口 |
| 执行规划 | `openspec/changes/<name>/` | 这一次交付切口的 proposal/design/tasks | 每轮 |
| 当前状态 | `docs/STATUS.md` | 版本、已验证证据、未交付、已知限制 | 交付节点 |

`STATUS` 的「下一步」整节删除，改为一行指针：候选在卡片，本轮在活动变更。计划结构变化时只改 GitHub，不改常驻文档。

### 2. 治理变更：`Plan: none`

产品变更的 proposal 必须写卡片链接；纯机制/文档/展示变更写 `Plan: none`，并在 `checkPlan` 里产生一条 notice。`checkPrecommit` 在活动变更是治理变更时拒绝 `apps/desktop/src/` 的提交，理由是产品行为必须有卡片和规格增量。

这样治理不再需要伪造一个能力卡，同时也不能用治理变更做产品改动。

### 3. 工作流：卡片切口 = change

- 选卡 → 卡片移到 In Progress → 建 change（proposal 写 `Plan: <卡片链接>`）。
- tasks 按这次切口拆，不把一个阶段塞进一个 change（上一轮 `organization-growth-model` 累积 8 节 56 项就是反例）。
- 收口：`npm run check` → `npm run milestone:check` → 归档 → 卡片贴证据（commit、check 计数、STATUS 链接）→ 卡片 Done/关 issue。
- 治理轮（本次）例外：`Plan: none`，不占用能力卡，但同样要 change、tasks、里程碑与证据。

### 4. 架构图作为维护锚点

- 图源：`docs/assets/architecture/noema-architecture.spec.json`（Archify candidate，进入仓库）。
- 产物：`docs/assets/noema-architecture.png`（README 用）与 `.html`（交互版）。
- 检查：`scripts/figure-check.mjs` 校验图源可解析、每个 `sources[].path` 存在且行号在文件范围内、PNG/HTML 存在且非空、README 引用了 PNG；`docs:check` 调用它。
- 图中必须区分「已实现」与「计划中」，计划项不得伪装为现状（与 `ARCHITECTURE.md` 只写结构不写路线图一致）。

### 5. GitHub 通知本地化

`scripts/github-inbox.mjs` 用 `gh` 拉取 main 的 workflow 失败、open PR 检查状态、新评论/issue，按去重键写 `.work/github-inbox/state.json`，新事件追加到 `.work/github-inbox/pending.md` 并尝试弹 toast。Windows 计划任务每 10 分钟跑一次；`AGENTS.md` 要求每轮开始时先读收件箱。gh 不可用或离线时静默跳过，不阻塞任何门槛。

### 6. 签名与安装口径（D-025）

按用户选择 B：暂不购买证书，发布未签名安装包，并在 README/OPERATIONS 写清放行步骤与风险；签名作为以后可选项保留。真实安装与升级演练登记为 C12 #143 的用户验收项，不阻塞本轮治理。

## 实现选择（维护者判断，用户可推翻）

- 图源用 Archify candidate JSON 而不是手写 SVG：可校验、可重生成；代价是依赖本地 Archify 技能生成新图（检查本身不依赖它）。
- 同步靠摘要而不是时间戳或重新渲染：`docs/assets/noema-architecture.source.json` 同时记录生成时的 `docs/ARCHITECTURE.md` 摘要与 HTML/PNG 摘要；`figure:check` 只做离线比较，不联网、不依赖 Archify。
- `figure:build` 负责真实重建：Archify finalize（四 gate）+ Edge headless 截 PNG + 回写摘要；CI 只跑 check，不重建图。
- 通知用轮询而不是 webhook：本机没有公网入口，轮询最简单且不引入服务。
- 收件箱状态放在 `.work/`（已被 `.gitignore` 排除），消息事实仍在 GitHub。

## 风险

- 图内容仍可能“过时但合法”：摘要只能保证「改 ARCHITECTURE 后必须重出图」，保证不了图画得对；画得对靠看图评审（卡片里贴 PNG）与 `figures` 的视觉 gate。
- 计划任务可能堆积 toast；只在有新事件时通知，且 10 分钟间隔。
- `Plan: none` 有被滥用的风险：靠 `checkPrecommit` 的路径限制兜底，评审仍要看 proposal 是否真的只做治理。

## 结果（2026-11-15 实现后回顾）

- 五道门槛落地：`docs:check`、`plan:check`、`figure:check`、`milestone:check`、`.githooks/pre-commit`；治理变更用 `Plan: none`，pre-commit 拒绝治理变更里出现 `apps/desktop/src/`。
- 架构图 v2：12 组件、4 卡片、6 类图例，灰底 + 虚线区域标出「计划中（尚未实现）」；`npm run figure:build` 端到端跑通，`figure:check`/`figure:test` 接入 `npm run check`。
- GitHub 收件箱：`scripts/github-inbox.mjs` + 17 项测试；Windows 计划任务 `NoemaGithubInbox` 每 10 分钟运行、`Last Result=0`；AGENTS §1 每轮开始先跑 `npm run inbox`。
- STATUS 删除「下一步」改为「计划在哪」；D-025/D-026 落库；AGENTS/OPERATIONS/README 同步。
- 个体组成先写进 `docs/ARCHITECTURE.md` §3.3，成长 L0–L3 边界记在 C6 #137；成长实现与环境债（360 拦截、`out/` 句柄锁）不在本轮，分别归 C6/C12 与已知限制。
- 验证：`npm run check` 873/873、0 fail、33,474ms；`maintenance:test` 6/6；`figure:test` 1/1；`inbox:test` 17/17。

## 待用户决定

（无。本轮为治理变更，方案由维护者判断；签名已由 D-025 定为未签名发布，不再列为待决。）
