---
name: noema-project-work
description: 续接或交付有实质范围的 Noema 工作时，核对代码现场、当前变更与源码发布；小修不启动完整管理流程。
---

# Noema 项目衔接

结合最近真实讨论、Git 状态、分支与近期提交，找到正在进行的 OpenSpec change。沿 `.codex/workspace.json` 的当前文档入口恢复本项背景，再读相关代码与必要历史；不靠旧 Issue、旧看板或聊天摘要独自决定下一步。

阶段方向与退出条件在 `docs/ROADMAP.md`，变更设计、细任务与验证在 change。GitHub 保留源码、PR 与外部问题，Project 已封存；不新建卡片、不重复同步任务状态。范围变化更新 change，阶段重点变化才更新 ROADMAP。当前工作方式见 `docs/PROJECT_OPERATIONS.md`。

恢复、交付与资料生命周期使用用户级 `development-maintenance` 的相关部分。Noema 的本地约定和独立可用命令见 `docs/PROJECT_OPERATIONS.md`；没有该用户级技能的环境沿用这些仓库约定，不必先安装新工具。

本机 GitHub connector 传输异常时，使用仓库中已验证的 `scripts/gh-direct.ps1` / `scripts/git-direct.ps1`；它们合并进程/用户 NO_PROXY 提供直连路径，具体故障仍按当次证据判断。当前 Actions 账户阻断与源码同步分开处理，不重跑已知无法启动的 job；发布后核对远端 SHA。

需要本机连接诊断、截图、打包或真实模型执行入口时，读 [运行与平台说明](references/runtime.md)；其他工作不必加载。
