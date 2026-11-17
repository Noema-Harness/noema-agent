# macOS 临时目录软链：设计

改动落点：两个测试文件的临时目录、`test-support/electron/isolated-worker-e2e.mjs` 的结果路径检查。
共享逻辑下沉：无；每处就地取真实路径，不加共用辅助。
不新增兼容层：产品代码不改。

## 事实影响

- 类别：仅执行
- 依据：只改测试与测试辅助，产品的可观察行为、结构与取舍不变；`docs/` 无需改动。

## 用户决策

- D-20261116-platform-layers

## Context

- main `46145bc` 的 macOS 全量失败：`read tools inspect files without exposing writes`、`approved paths and network requests are scoped to the current command`、`tooling/isolated-worker-e2e.test.mjs` 全部 6 个用例。
- E2E 辅助里 `e2eRealDirectory` 是 `realpathSync` 之后的目录，`resultPath` 是调用方给的原始绝对路径；`writeResult()` 自己用未解析的 `e2eDirectory` 检查，两处口径不一致。

## 实现选择（协作者判断，维护者可推翻）

- **E2E 检查统一到未解析目录**：数据库与工作区仍按真实路径检查（防软链逃逸）；结果文件尚未存在，按调用方给的目录检查，与写入时的检查一致。

## 用户可观察的改变

- 无。

## 手测步骤

1. 不涉及界面。在 macOS 上执行 `cd apps/desktop && npm test`。
2. 预期：0 失败。

## 验证

- macOS 全量 `npm test` 0 失败（改动前 8 败）；`npm run typecheck`、`npm run lint`。
- Linux/Windows 由 CI 确认。
