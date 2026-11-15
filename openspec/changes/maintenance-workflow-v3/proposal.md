# 维护机制与展示的第三轮校准

Plan: none

## Why

用户 2026-11-15 的 11 点反馈指向同一类问题：维护机制本身还在制造新的不一致。

1. 计划仍有三个候选去处（看板、`openspec/changes/`、`docs/STATUS.md` 的「下一步」），`STATUS` 每轮既要记状态又要写下一步，和 change 重复。
2. OpenSpec 在工作流里被跳过：一轮交付常常直接改代码，change 成了事后补的记录，任务也不再按卡片切口拆分。
3. 架构图是用户和 agent 理解系统的唯一入口，但它只放在 README，没有接入任何门槛，改了代码图不会变，也没有标明哪些是已实现、哪些是计划。
4. GitHub 上的 CI 失败、PR 变动需要用户转告；仓库缺少主动通知。
5. 安装包签名与真实安装的结论散落在临时对话里，没有成为可执行的发布口径。

## What Changes

- 计划三层定死：规划与状态只在 GitHub Project；本轮执行计划只在 `openspec/changes/<name>/`；`docs/STATUS.md` 只记当前状态、已验证证据、缺口与已知限制，不再写「下一步」。
- 治理变更允许 `Plan: none`：`plan:check` 接受该写法，`pre-commit` 拒绝任何带 `apps/desktop/src/` 的治理变更提交，避免用治理变更偷渡产品行为。
- OpenSpec 回到工作流：每个看板卡片切口对应一个 change；change 的 proposal 指向卡片，tasks 是这次切口的可勾选拆分，卡片 Done 前必须归档。
- 架构图接入检查：`npm run figure:check` 校验图源、引用文件与产物一致；`docs:check` 调用它；README 的架构一节成为维护触发点。
- GitHub 通知本地化：`scripts/github-inbox.mjs` 拉取 CI/PR/Issue 变化并写入本地收件箱，配合 Windows 计划任务与每轮开始检查。
- 签名与安装口径：按 D-025 采用未签名发布并写清放行步骤；真实安装与升级作为发布卡片的用户验收项。

## Capabilities

无（纯机制、文档与展示变更；`skip_specs: true`，不改产品可观察行为）。

## Impact

- 文档：`AGENTS.md`、`docs/STATUS.md`、`docs/OPERATIONS.md`、`docs/DECISIONS.md`、`README.md`
- 工具：`scripts/maintenance.mjs`、`scripts/maintenance.test.mjs`、`scripts/figure-check.mjs`、`scripts/github-inbox.mjs`、`package.json`
- 展示：`docs/assets/noema-architecture.*`（图源进入仓库并由检查守护）
- 不触碰 `apps/desktop/src/` 的产品行为。
