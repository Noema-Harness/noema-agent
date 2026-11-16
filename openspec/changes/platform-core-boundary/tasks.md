# 任务

## 1. 计划

- [x] 1.1 看板 #151（D-20261116-platform-layers 第 ① 刀）；`npm run plan:check` 通过，计划单独提交

## 2. 端口与核心边界

- [ ] 2.1 `src/main/runtime/work-runtime.ts`：`WorkRuntime`、`WorkTaskInput`、`WorkTaskHandle`、`WorkTaskOutcome`、`WorkRuntimeEvent`；`work-runtime-registry.ts` 改用它
- [ ] 2.2 `platform/workspace-identity.ts` 新增 `workspacePathKey()`，`compareWorkspaceIdentities` 与 `chat/workspace-command-batch-store.mjs` 共用
- [ ] 2.3 `diagnostics/database-recovery.ts` 去掉 `electron` 类型引用
- [ ] 2.4 `test/main/core-boundary.test.mjs`：核心目录不导入 `electron`/`child_process`、不比较 `process.platform`

## 3. 验证

- [ ] 3.1 `npm run typecheck`、`npm run lint`、受影响测试
- [ ] 3.2 macOS 全量 `npm test`，失败用例与 main 对照

## 4. 交接

- [ ] 4.1 开 issue 请维护者：核心导入规则提升进 `source:check`，`docs/ARCHITECTURE.md` 代码地图标注三层
- [ ] 4.2 发 PR，写验证证据与平台说明；更新卡片正文（现在能做什么 + 手测步骤 / 还没做）由维护者在收口时做
