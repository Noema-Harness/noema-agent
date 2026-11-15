# STATUS

Authority: 本文件只回答一个问题——按现有证据，今天这个版本能说到什么程度。内容是当前版本、最后一次验证的证据、未验证项与交付判断。
Update when: 每次交付、打包或验证结果变化。
Does not own: 产品行为与边界（见 [PRODUCT](PRODUCT.md)）；结构与代码实况（见 [ARCHITECTURE](ARCHITECTURE.md)）；决定与理由（见 [DECISIONS](DECISIONS.md)）；命令、安装与诊断（见 [OPERATIONS](OPERATIONS.md)）；治理与门槛（见 [AGENTS](../AGENTS.md)）；计划与进度（见 GitHub Project 看板与 `openspec/changes/`，D-026）。

最后更新：2026-11-15

## 版本与基线

- 源码版本：`0.7.6`；当前源码基线：`f592a9b release: Noema 0.7.6`；功能基线 `b7c41fa`。
- 便携构建在 `apps/desktop/out/Noema-win32-x64/Noema.exe`；安装包由 `npm run make:desktop` 产出（构建陷阱与回退见 [OPERATIONS](OPERATIONS.md)，决定见 D-024）。

## 最后一次验证（2026-11-15）

- `npm run check`：**873/873，0 fail，33,917ms**；链为 `workspace:check`（含 `branches:check`）→ `docs:check` → `figure:check` → `plan:check` → `source:check` → `lint` → `typecheck` → `tools:test`（31 个维护脚本测试）→ `test`。
- 安装包：`npm run make:desktop` 产出 `Noema-0.7.6 Setup.exe`（170,410,496 字节，sha256 `6E773C854FBF6E4B0A39720608737555114E5E95E9F5526F1E05D7A32964BCDC`）、`noema_desktop-0.7.6-full.nupkg`、`RELEASES`；把 `TEMP`/`SQUIRREL_TEMP` 指到可写目录后 `Setup.exe --silent` 能装出 `app-0.7.6`（载荷验证）。
- CI：run `43699905215` success（9.9 分钟，commit `ed11513`），干净 Windows runner 上含 `make:desktop` 与安装/升级/卸载数据保留验证。
- 架构图：`figure:build` 端到端跑通（Archify 四 gate 全 pass → Edge 截图 → 摘要回写），`figure:check` 保证与 `docs/ARCHITECTURE.md` 同步。

## 未验证

- 真实 provider 的完整对话链与长时运行。
- 真实 `%LOCALAPPDATA%` 安装与跨版本升级：本机工作区带 Low 完整性标签，区内构建的 exe 写不了用户目录；CI 覆盖了这条路径，本机只验证到载荷安装。
- 真实项目上把成长批次跑通并产出资产（现有证据是测试与一次真实库的失败样本，见 D-014 与看板 C6）。

## 交付判断

维护层已收口：治理变更 `maintenance-workflow-v3` 于 2026-11-15 归档，当前没有活动变更；开始下一轮前按看板选卡立项（AGENTS §1）。

0.7.6 是可日常使用的工程版，不是完成 V1。上面的未验证项就是当前证据的上限；“完成”只能由文件、命令或测试证据支撑，不能以模型自述或计划代替。
