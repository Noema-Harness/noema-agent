---
name: noema-project-work
description: 续接或交付有实质范围的 Noema 工作时，核对代码现场、当前要求与源码发布；小修不启动完整管理流程。
---

# Noema 项目衔接

先核对用户最近讨论、Git 状态、分支与未提交工作，再沿 `.codex/workspace.json` 读取本项必要入口。`docs/CURRENT_CONTEXT.md` 保存本轮明确要求，`docs/ARCHITECTURE.md` 只用于定位当前代码。

本技能及项目技能以 `.codex/skills` 为编写源，`.dsh/skills` 是 DSH 镜像；改动后运行 `npm run skills:sync`，用 `npm run skills:check` 验证。两套 harness 的指令、技能和 CLI 差异见 `docs/HARNESS_ALIGNMENT.md`。

范围发现先从外部参考源码的实际模块和契约展开，再对照 Noema；不从现有功能、旧提交或旧 Issue 恢复旧规划。参考项目的成熟度和适用性逐项核实，不自动采用其整套架构。源码研究、规划和开发的当前授权以最近用户要求为准。

现有行为参考 `openspec/specs/`，实际变更再使用对应 change。资料和源码交付按 `docs/PROJECT_OPERATIONS.md` 处理；GitHub 保留源码与外部协作，不重复维护内部状态。

GitHub connector 传输异常时使用 `scripts/gh-direct.ps1` / `scripts/git-direct.ps1`。故障按当次证据判断，同步后核对远端 SHA。

本机 shell、连接、截图、打包或模型执行入口按需读 [运行说明](references/runtime.md)。
