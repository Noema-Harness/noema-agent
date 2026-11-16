# Tasks

## 1. 修复提交门的决议范围

- [x] 1.1 `checkPrecommit` 只被本变更引用的未确认决议阻塞（`scripts/maintenance.mjs`）
- [x] 1.2 单测覆盖“引用即阻塞、不引用只提示”（`scripts/maintenance.test.mjs`）

## 2. 验证

- [x] 2.1 `node --test scripts/maintenance.test.mjs` 20/20
- [ ] 2.2 提交并推送（pre-commit 验证本修复自身不被无关决议阻塞）
