# 工作方式

本页记录仍在使用的维护入口，不承担产品定位或开发排期。

## 依据与材料

[当前上下文](CURRENT_CONTEXT.md) 只保存用户本轮明确要求；[源码导航](ARCHITECTURE.md) 只说明现有代码。`.codex/workspace.json` 指定当前文档及更新时机。

`openspec/specs/` 是现有可观察行为的回归参照。经明确授权开始行为变更时，由相应 change 记录差异、设计和验证；现有规格不自动决定一期范围。当前没有进行中的规划 change。

研究、参考源码、临时脚本和运行产物放入 `.work/`。只保留仍有用途的内容；不在工作区内积存被替代的规划、历史任务表或旧设计副本。用户数据、凭据、依赖和必要 fixture 不属于可丢弃材料。

GitHub 用于源码、PR、发行及外部协作问题，不复制内部阶段和任务状态。提交、同步和发行分别依据授权与真实结果判断，发布后核对远端 SHA。

## 命令入口

- `npm run check`：结构、格式、类型和服务测试。
- `npm run source:check`：产品源码导入边界与循环。
- `npm run workspace:check`：当前文档分类、链接和过程材料边界。
- `npm run workspace:test`：维护工具的清理边界回归。
- `npm run workspace:clean`：预览 runs/scratch；追加 `-- --apply` 才执行。生成物可用 `-- --generated` 纳入，清理前先确认无运行进程使用。
- `scripts/gh-direct.ps1` / `scripts/git-direct.ps1`：按可用代理路由 GitHub 流量，代理路径使用 OpenSSL/HTTP/2。

批量整理前核对实际用途、未提交工作和来源/目标绝对路径，保存必要恢复快照。源码不能依赖过程目录。并行修改按实际需要隔离 worktree，避免覆盖同一资产。

本机 shell、模型探针、截图与打包细节按需读 [运行说明](../.codex/skills/noema-project-work/references/runtime.md)。真实模型检查遵守当前上下文中的成本优化前置条件。
