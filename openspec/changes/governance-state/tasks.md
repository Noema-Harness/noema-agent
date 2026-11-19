# Tasks

## 1 数据与内核

- [ ] 1.1 `governance/data/state.json`：初始运行数据（`version`、`current`、`log`、`threads`），随命令创建
- [ ] 1.2 `governance/core/state.mjs` 纯逻辑：`STATES`、`setState`、`appendStateLog`、`ensureThread`、`addRound`、`addWait`、`dropWait`、`archiveThread`、`resumeThread`、`validateState`
- [ ] 1.3 `governance/core/state.test.mjs`：切换与日志、会话创建与恢复续编号、轮次、待裁增删、归档、非法状态拒绝

## 2 命令

- [ ] 2.1 `scripts/state.mjs` CLI：默认读；`set`、`round`、`wait add|drop`、`archive`、`resume`、`log`
- [ ] 2.2 `package.json`：`state`、`state:test`；`stage` 退役为提示（输出「阶段已改为状态：npm run state -- <讨论|执行|验收>」）
- [ ] 2.3 规则包取用改按状态（`state` 打印对话 / 执行 / 验收规则包 + 会话摘要），`gate:` 校验保留

## 3 规则包与文档

- [ ] 3.1 重写 `governance/noema/workflow/discussion.md`：会话对象、轮次、待裁滚动、两种结束、产出边界、检查项
- [ ] 3.2 `AGENTS.md`：阶段地图改为状态图（三态 + 进入方式 + 收口目标）
- [ ] 3.3 `governance/README.md` 增「状态」一节与命令表；`governance/core/README.md` 模块表加 `state`
- [ ] 3.4 `docs/OPERATIONS.md`：命令块与失败修法（未知状态、非法切换、会话不存在）

## 4 测试与验证

- [ ] 4.1 既有测试适配：`governance/core/kernel.test.mjs` 的 `stage` 引用、规则包 gate 校验、`scripts/maintenance.test.mjs`
- [ ] 4.2 `npm run check` 全绿；`npm run governance -- check net` 无新增要求

## 5 收尾

- [ ] 5.1 `docs/STATUS.md` 增「状态生命周期（change governance-state，2026-11-19）」条
- [ ] 5.2 归档 `governance-state`；提交推送；更新条目执行层与设计稿状态