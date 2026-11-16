# 任务

## 1. 计划

- [x] 1.1 看板 #151（D-20261116-platform-layers 第 ① 刀）；`npm run plan:check` 通过，计划单独提交

## 2. 端口与核心边界

- [x] 2.1 `src/main/runtime/work-runtime.ts`：`WorkRuntime`、`WorkTaskInput`、`WorkTaskHandle`、`WorkTaskOutcome`、`WorkRuntimeEvent`；`work-runtime-registry.ts` 改用它。接上后 tsc 指出两个后端的 `startTask` 签名与端口不符（DSH 的 `onEvent` 声明为 `(event: object)`，native 无声明、`taskId` 被推成 UUID 模板类型），两处补 JSDoc 声明端口类型，只改类型（`checkJs` 未开，函数体不受影响）
- [x] 2.2 `platform/workspace-identity.ts` 新增 `workspacePathKey()`，`compareWorkspaceIdentities` 与 `chat/workspace-command-batch-store.mjs` 共用
- [x] 2.3 `diagnostics/database-recovery.ts` 去掉 `electron` 类型引用
- [x] 2.4 `test/main/core-boundary.test.mjs`：核心目录不导入 `electron`/`child_process`、不比较 `process.platform`；本机临时在 `chat/records.ts` 末尾加 `process.platform` 引用，测试报 `main/chat/records.ts compares process.platform`，还原后通过

## 3. 验证

- [x] 3.1 `npm run typecheck` 通过；`npm run lint`（oxfmt 329 个文件）通过；`npm run source:check` 无错误；受影响目录（platform/runtime/chat/diagnostics/integrations/execution + 边界测试）501 个测试 486 过、14 败，main 上同一组 498 个 483 过、14 败，失败用例名逐条相同
- [x] 3.2 macOS（Node 24.22.3）全量 `npm test`：890 个，869 过、20 败，与 STATUS 记录的 macOS 基线 20 败一致（均为 Windows 专属用例）

## 4. 交接

- [x] 4.1 开 issue 请维护者（#156，含本机钩子与 PR 检查不一致的两条）：核心导入规则提升进 `source:check`，`docs/ARCHITECTURE.md` 代码地图标注三层
- [x] 4.3 `docs/ARCHITECTURE.md` §6 代码地图按目录标出核心/宿主/暂例外，并改正已过时的目录名（`models/`→`providers/`、`stores/`→`storage/`，补 `runtime/`、`integrations/`、`testing/` 等）；架构图需维护者重出（`figure:build` 只在维护者本机可跑）
- [ ] 4.2 发 PR，写验证证据与平台说明；更新卡片正文（现在能做什么 + 手测步骤 / 还没做）由维护者在收口时做
