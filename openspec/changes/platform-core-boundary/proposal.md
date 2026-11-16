Plan: https://github.com/Noema-Harness/noema-agent/issues/151

# 平台解耦第一刀：执行后端端口与核心边界

## Why

D-20261116-platform-layers（用户 2026-11-16 确认）把桌面端拆成核心 / 端口 / 宿主三层，验收第一条是“核心不导入 `electron`、`node:child_process`，不比较 `process.platform`”。2026-11-16 在 main（`0c18850`）上实测：

- 工单通过 `runtime/work-runtime-registry.ts` 拿到执行后端（DSH 或 native），但端口只有 `{ startTask: (input: any) => any }`，输入、句柄、事件、结果都没有契约，核心和后端靠口头约定对齐。
- 核心目录里还有两处平台耦合：`chat/workspace-command-batch-store.mjs` 直接比较 `process.platform` 来折叠工作区路径大小写；`diagnostics/database-recovery.ts` 的参数类型引用 `import('electron')`。
- 没有任何检查会在核心重新导入平台模块时失败。

## What Changes

- 新增端口模块 `src/main/runtime/work-runtime.ts`：`WorkRuntime`、`WorkTaskInput`、`WorkTaskHandle`、`WorkTaskOutcome`、`WorkRuntimeEvent`，按 `SocialWorkService` 今天的实际读写写成类型；`work-runtime-registry.ts` 改用它。
- 工作区路径比较键 `workspacePathKey()` 放进 `platform/workspace-identity.ts`（宿主层），`compareWorkspaceIdentities` 与命令批次存储共用；核心不再比较 `process.platform`。
- `database-recovery.ts` 改用自己声明的最小对话框类型，不再引用 `electron` 类型。
- 新增核心边界测试：列出核心目录，扫描生产源码里的 `electron`、`child_process` 导入与 `process.platform`。

## Impact

- 代码：`src/main/runtime/`、`src/main/platform/workspace-identity.ts`、`src/main/chat/workspace-command-batch-store.mjs`、`src/main/diagnostics/database-recovery.ts` 与对应测试。
- 行为：不变（Windows 仍按不区分大小写比较工作区路径，其他平台区分）。
- 维护者路径（另开 issue，不在本 PR）：把核心导入规则提升进 `npm run source:check`；`docs/ARCHITECTURE.md` 代码地图标出核心 / 端口 / 宿主。
- 不做：拆分 `execution/`（`SocialWorkService` 与各后端适配器仍同目录，下一刀再定）；Windows Runner 接入端口；打包与 CI 矩阵（第 ② 刀）。
