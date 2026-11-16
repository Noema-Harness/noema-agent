# 平台解耦第一刀：设计

改动落点：`src/main/runtime/work-runtime.ts`（新端口类型）、`platform/workspace-identity.ts`、`chat/workspace-command-batch-store.mjs`、`diagnostics/database-recovery.ts`，加一条核心边界测试。
共享逻辑下沉：路径大小写折叠从核心挪到宿主层的 `workspace-identity.ts`，比较与存储共用一个函数，不加转发层。
不新增兼容层：端口类型只描述现有调用，DSH 与 native 两个实现不改。

## 事实影响

- 类别：结构
- 依据：只改模块边界与依赖方向（新增端口类型、平台判断移出核心、加边界测试），工单、执行与存储的可观察行为不变；`docs/ARCHITECTURE.md` 的代码地图需由维护者补上三层标注（维护者路径，见 issue）。

## 用户决策

- D-20261116-platform-layers

## Context

- `SocialWorkService` 只通过构造参数 `adapter` 调用执行后端：`startTask(input)` 返回 `{ started, done, stop }`，`onEvent` 收 `session`/`status`/`tool-call`/`tool-result`/`runtime-checkpoint` 五类事件，`done` 解析为 `{ status, sessionId, result, toolCallCount, errorCode, retryAfterSeconds }`。
- 后端在宿主侧装配：`app/agent-runtime.ts` 建 `DshHeadlessAdapter`，`main.ts` 建 `NoemaProjectExecutor`，再交给 `createWorkRuntimeRegistry`。
- 实测核心目录（`agents chat projects storage runtime tools providers mcp plugins diagnostics archive` 与 `src/shared`）里只剩两处违规：`chat/workspace-command-batch-store.mjs:65` 与 `diagnostics/database-recovery.ts:49`。

## 实现选择（协作者判断，维护者可推翻）

- **核心的范围按目录列**：上述 11 个 `src/main` 目录加 `src/shared`。`app/`、`platform/`、`ipc/`、`integrations/`、`testing/`、`main.ts`、`preload/` 是宿主；`execution/` 暂不列入，因为 `SocialWorkService`（核心逻辑）与 native 执行器、Windows Runner、git 审查（用 `child_process`）还在同一目录，拆目录单独一刀。
- **边界先写成产品测试**：`test/main/core-boundary.test.mjs` 随 `npm test` 跑。决议要求由 `source:check` 拦，那是维护者路径，另开 issue 请维护者提升；提升后删掉这条测试，避免两处规则。
- **类型导入也算**：`import('electron')` 的类型引用同样让核心依赖 Electron 的类型包，测试一并拦。
- **端口类型只描述今天的读写**：字段来自 `SocialWorkService` 实际读取的内容，不预留未来字段。

## 用户可观察的改变

- 无。工单派发、执行轨迹、命令批次记录与数据库启动失败对话框都与改动前一致。

## 手测步骤

1. `npm start` 启动 Noema，在项目里派发一个会改文件的任务，确认执行轨迹与改动记录正常出现。
2. 预期：与改动前一致；本刀没有新的界面入口。

## 验证

- 单测：`workspacePathKey` 在 `win32` 折叠大小写、在 `darwin`/`linux` 保持原样；`compareWorkspaceIdentities` 现有用例不变；命令批次存储现有用例不变。
- 单测：核心边界测试在当前树上通过；人为在核心目录加一行 `process.platform` 时失败（本机临时验证，不入库）。
- `npm run typecheck`、`npm run lint`、受影响测试；macOS 上全量 `npm test` 的失败数不多于 main。
