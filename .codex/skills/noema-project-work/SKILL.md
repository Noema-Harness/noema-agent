---
name: noema-project-work
description: 续接或交付有实质范围的 Noema 工作时，核对代码现场、GitHub 交付状态与发布结果；小修不启动完整项目管理流程。
---

# Noema 项目衔接

本技能负责代码现场与 GitHub，规格和实现细任务由 OpenSpec 管理。按当前用户任务恢复最近真实工作，不能只靠旧 Issue 或聊天摘要选下一步。

开始时检查 git status、分支与近期提交、关联 Issue 最新正文/评论和 Project 状态，找到已有 change；只读本项相关的决定和代码。没有关联交付项的实质产品开发建立 Issue；小修和有明确范围的工具维护不为流程制造 Issue。

Issue 说明用户结果、退出条件和阶段依赖，并链接 change；change 保存技术设计、任务及证据。仅在阶段完成、方向改变、阻塞或交接时，更新 Issue 的简短续接点：结论与提交、必要缺口、下一动作。避免复制 change 全文。

Project 生命周期、字段操作和多人交接见 `docs/PROJECT_OPERATIONS.md`。新增 Issue 确认已进入 Project；修改字段前查询实际字段。Done 表示退出条件已满足；取消用 not planned 关闭并设为 Canceled，不将待审视作已验收。

GitHub connector 发生传输故障后切到 `scripts/gh-direct.ps1`，Git 使用 `scripts/git-direct.ps1`；它们合并进程/用户 NO_PROXY，提供可明确比较的直连路径。当前网络、认证、权限和 connector 故障分别判断，不把一次 EOF 固定解释为代理问题。

发布前核对未提交改动归属、工作流触发条件和现有失败原因。只提交本项文件；已确认的 Actions 账户阻断不妨碍集成分支源码同步，也不代表 CI 通过。完成后核对远端提交与看板实际结果。

需要本机连接诊断、截图、打包或真实模型执行入口时，读 [运行与平台说明](references/runtime.md)；其他工作不必加载。
