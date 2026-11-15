# Tasks

本轮是治理变更（`Plan: none`，`skip_specs: true`）：只改机制、文档与展示，不改 `apps/desktop/src/` 的产品行为。

## 1. 计划边界

- [x] `plan:check` 支持治理变更 `Plan: none`，产品变更仍要求卡片链接；`checkPrecommit` 拒绝治理变更提交产品代码
- [x] `scripts/maintenance.test.mjs` 覆盖：治理变更通过、治理变更带产品代码被拒、缺 `Plan:` 仍报错
- [x] `docs/STATUS.md` 删除「下一步」整节，改为「计划在哪」一行指针；`Does not own` 增补计划与排序（D-026）
- [x] `AGENTS.md` 事实表 STATUS 行同步；§1 写清「卡片切口 = change」与治理例外
- [x] `docs/OPERATIONS.md` 同步 STATUS 边界与治理变更写法（计划与状态边界一节）

## 2. 工作流回到 OpenSpec

- [x] 关闭 `organization-growth-model`：未完成项移交 C6 #137 / C12 #143，变更归档
- [x] 新建本轮治理变更 `maintenance-workflow-v3`（proposal/design/tasks，`Plan: none`）
- [x] 在 `AGENTS.md` §1 明确：每个交付切口一个 change，tasks 只拆这一刀；不把一个阶段塞进一个 change

## 3. 架构图接入维护

- [x] 图源进入仓库：`docs/assets/noema-architecture.source.json`（Archify candidate + 生成时的 ARCHITECTURE 摘要 + 产物摘要）
- [x] 更新图内容：12 组件、4 张卡片，灰底 + 虚线区域标出「计划中（尚未实现）」；finalize 四道 gate 全 pass（html 850,941 字节）
- [x] `scripts/figure.mjs`：`check` 校验源摘要、HTML/PNG 摘要与 README 引用；`build` 调 Archify finalize + Edge 截图并回写摘要
- [x] `npm run figure:check` 接入 `npm run check`（figure:test 也进 check 链）；`docs/OPERATIONS.md` 写维护触发条件

## 4. GitHub 主动通知

- [x] `scripts/github-inbox.mjs`：CI 失败/恢复、PR 检查状态、新评论与 issue，带去重与本地收件箱
- [x] `scripts/github-inbox.test.mjs` 覆盖抽取/去重/恢复判定（17 项）
- [x] Windows 计划任务每 10 分钟运行（`NoemaGithubInbox`，Run 后 Last Result 0）；`AGENTS.md` 要求每轮开始先读收件箱

## 5. 发布口径与环境债

- [x] `docs/DECISIONS.md` 记录 D-025（未签名发布）与 D-026（计划三层、STATUS 不写下一步、治理变更 `Plan: none`）
- [x] `README.md` 安装节写清未签名安装的放行步骤与 portable 备选
- [x] 环境债已定位并写入 STATUS 已知限制：`out/` 锁 = DSH 宿主进程的只读句柄（关闭后默认 `out/` 恢复）；Setup 写不了 `%LOCALAPPDATA%` = 工作区 `Low Mandatory Level` 完整性标签（复制到 `%TEMP%` 即可安装，与签名无关）；报告 `.work/reports/env-debt.md`

## 6. 验收

- [x] `npm run check` 全绿（873/873，0 fail，35,425ms；收尾后复跑）
- [x] 看板：C12 #143 与 C6 #137 贴本轮证据（C6 comment 6889021474、C12 comment 6885266487）；治理轮不占能力卡
- [ ] [用户] 复核新的计划边界：STATUS 不再写下一步、治理变更 `Plan: none`、卡片切口=change，确认工作流可执行 → 证据：本变更 tasks 与 `AGENTS.md` §1

## 7. 仓库洁净与分支卫生

- [x] `.work/` 整体不入库：`.gitignore` 改为忽略整个 `.work/`，删除唯一被跟踪的 `.work/README.md`；README 目录表不再把 `.`work 当成仓库内容
- [x] 删除 `.codex/`：仓库结构与文档登记迁到 `scripts/workspace.config.json`（`scripts/workspace.mjs`、`scripts/maintenance.mjs` 及两份测试同步改路径；补 `historyRoots`）
- [x] `scripts/branches.mjs` + `branches.test.mjs`：已合入 `origin/main` 的远端分支直接失败，陈旧未合入分支只提示；`prune` 默认预演、`--apply` 才删；`workspace:check` 已串上 `branches:check`
- [x] 清理 8 个过时远端分支（`codex/*` 7 个 + `feat/noema-context-margin-prototype`），保留 `ts-migration-phase-0-1`（PR #131）；删除前备份 `.work/archive/branches-2026-11-15.bundle`（7,299,401 字节）与 `branch-inventory.txt`
- [x] 源码规模盘点（168 文件、17 个 >1000 行、6 个 >2000 行）与不确定项清单交给用户决定，不在本轮做大迁移
- [x] `docs/OPERATIONS.md` 新增「仓库结构与分支卫生」；`CONTRIBUTING.md` 说明残留分支由 `branches:check` 发现
- [x] `npm run check` 全绿
