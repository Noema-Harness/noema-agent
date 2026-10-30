---
name: noema-project-work
description: 续接或交付有实质范围的 Noema 工作时，核对代码现场、当前变更与源码发布；小修不启动完整管理流程。
---

# Noema 项目衔接

结合最近真实讨论、Git 状态、分支与近期提交，找到正在进行的 OpenSpec change。沿 `.codex/workspace.json` 的当前文档入口恢复本项背景，再读相关代码与必要历史；不靠旧 Issue、旧看板或聊天摘要独自决定下一步。

阶段方向与退出条件在 `docs/ROADMAP.md`，变更设计、细任务与验证在 change。GitHub 保留源码、PR 与外部问题，Project 已封存；不新建卡片、不重复同步任务状态。范围变化更新 change，阶段重点变化才更新 ROADMAP。当前工作方式见 `docs/PROJECT_OPERATIONS.md`。

新增资料先明确职责与维护时机；进行中的研究、截图、下载和运行材料统一进入 `.work`。采用的结论进入对应代码或当前文档，旧材料不作为现行规格。完成后运行 `npm run workspace:check`；清理用 `npm run workspace:clean` 先预览，不删除未核实的数据。

GitHub connector 发生传输故障后切到 `scripts/gh-direct.ps1`，Git 使用 `scripts/git-direct.ps1`；它们合并进程/用户 NO_PROXY，提供可比较的直连路径。当前网络、认证、权限和 connector 故障分别判断，不把一次 EOF 固定解释为代理问题。命令尚未启动就被策略拒绝时，不当作 Windows ACL 故障处理；根据实际拒绝理由修正操作范围，不能通过其他执行器规避拒绝。

发布前核对未提交改动归属、工作流触发条件和现有失败原因。只提交本项内容；已确认的 Actions 账户阻断不妨碍集成分支源码同步，也不代表 CI 通过。完成后核对远端 SHA，报告交付、真实证据、必要缺口与下一动作。

需要本机连接诊断、截图、打包或真实模型执行入口时，读 [运行与平台说明](references/runtime.md)；其他工作不必加载。
