# STATUS

Authority: 本文件只回答一个问题——按现有证据，今天这个版本能说到什么程度。内容是当前版本、最后一次验证的证据、未验证项与交付判断。
Update when: 每次交付、打包或验证结果变化。
Does not own: 产品行为与边界（见 [PRODUCT](PRODUCT.md)）；结构与代码实况（见 [ARCHITECTURE](ARCHITECTURE.md)）；决定与理由（见 [DECISIONS](DECISIONS.md)）；命令、安装与诊断（见 [OPERATIONS](OPERATIONS.md)）；治理与门槛（见 [AGENTS](../AGENTS.md)）；计划与进度（见 GitHub Project 看板与 `openspec/changes/`，D-026）。

最后更新：2026-11-15

## 版本与基线

- 源码版本：`0.7.6`；当前源码基线：`f592a9b release: Noema 0.7.6`；功能基线 `b7c41fa`。
- 便携构建在 `apps/desktop/out/Noema-win32-x64/Noema.exe`；安装包由 `npm run make:desktop` 产出（构建陷阱与回退见 [OPERATIONS](OPERATIONS.md)，决定见 D-024）。

## 最后一次验证（2026-11-15）

- `npm run check`：**878/878，0 fail，37,716ms**（`tools:test` 33 个）；链为 `workspace:check`（含 `branches:check`）→ `docs:check` → `figure:check` → `plan:check` → `source:check` → `lint` → `typecheck` → `tools:test`（31 个维护脚本测试）→ `test`。
- 安装包：`npm run make:desktop` 产出 `Noema-0.7.6 Setup.exe`（170,410,496 字节，sha256 `6E773C854FBF6E4B0A39720608737555114E5E95E9F5526F1E05D7A32964BCDC`）、`noema_desktop-0.7.6-full.nupkg`、`RELEASES`；把 `TEMP`/`SQUIRREL_TEMP` 指到可写目录后 `Setup.exe --silent` 能装出 `app-0.7.6`（载荷验证）。
- CI：run `43699905215` success（9.9 分钟，commit `ed11513`），干净 Windows runner 上含 `make:desktop` 与安装/升级/卸载数据保留验证。
- 架构图：`figure:build` 端到端跑通（Archify 四 gate 全 pass → Edge 截图 → 摘要回写），`figure:check` 保证与 `docs/ARCHITECTURE.md` 同步。
- TypeScript 迁移：PR #131 已合并（`d32257e`，57 个主进程模块只改类型、不改行为，决定见 D-039）；`source:check` 的 `.mjs` 上限保持 67。PR 的 Windows CI verify 13m41s 全绿，含打包、安装与安装/升级/卸载数据保留验证。
- 计划先于代码（change `plan-before-code`）：`pre-commit` 在提交产品代码时要求本轮 change 已在 `HEAD`，否则报“本轮变更的计划还没有提交”；计划与实现因此分成两次提交。
- 交付观察口（D-20261115-delivery-observability）：产品变更的 `design.md` 必须写「用户可观察的改变」与「手测步骤」（`plan:check` 强制），`milestone:check` 要求 tasks 记“更新卡片正文”；决定编号改为 `D-YYYYMMDD-<短名>`（D-20261115-decision-ids）。
- 成长写入（change `project-growth-integrity`）：迁移 43 重建 `social_project_growth_members`（`brief` 只在 `completed` 必填，历史 `no_change` 简报已清空）；provider 对“工具调用写成正文”先做一次修正重试，仍失败返回可重试错误；`no_change` 不再保存或注入简报。规格已合并进 `openspec/specs/specialist-agents/spec.md`。

## 未验证

- 真实 provider 的完整对话链与长时运行。
- 真实 `%LOCALAPPDATA%` 安装与跨版本升级：本机工作区带 Low 完整性标签，区内构建的 exe 写不了用户目录；CI 覆盖了这条路径，本机只验证到载荷安装。
- 真实项目上把成长批次跑通并产出资产：本轮只修写入可靠性（测试覆盖迁移与修正重试），没有在真实 provider 上重跑一次项目复盘；现有真实样本仍是一次 `no_change` 的失败记录。
- 类型检查覆盖（D-039）：`src` 下仍有 67 个 `.mjs` 不受类型检查（含 `social-chat-service`/`social-chat-store`/`social-work-service`/`root-store`/`root-ipc`），`strict` 未开启；已转换的 `.ts` 由 `npm run typecheck` 覆盖，`source:check` 保证 `.mjs` 数量只减不增。

## 交付判断

维护层已收口（治理变更 `maintenance-workflow-v3` 已归档）。产品侧第一刀是 `project-growth-integrity`（2026-11-15 归档，规格合并进 `openspec/specs/specialist-agents/spec.md`）：成长复盘只在真的写入经历时记 `completed`，`no_change` 不保存也不注入简报，迁移 43 清掉历史污染文本。看板 C6 #137 仍在 In Progress，剩余项是成员经历可查看/删除与真实 provider 重跑验收。

0.7.6 是可日常使用的工程版，不是完成 V1。上面的未验证项就是当前证据的上限；“完成”只能由文件、命令或测试证据支撑，不能以模型自述或计划代替。
