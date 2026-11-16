# TypeScript 迁移阶段 2：39 个中等模块

Plan: https://github.com/Noema-Harness/noema-agent/issues/153

## 为什么

D-039 决定主进程逐步从 `.mjs` 迁到 TypeScript，只改类型、不改行为。阶段 1（#131）转了 57 个小模块；剩下的 `.mjs` 不受 `npm run typecheck` 覆盖，跨模块传递的宽类型（`any`）让已转换模块的检查打折扣。

## 改什么

- `apps/desktop/src/` 下 39 个 ≤330 行的 `.mjs` 改为 `.ts`，补类型注解；导入改写为 `.ts` 扩展名。
- 修正 3 处过时的 JSDoc 导入路径；为跨文件宽类型补重载或显式返回类型。

## 不改什么

- 不改运行时行为、进程结构、测试框架；测试（`test/**/*.mjs`）不迁移。
- 维护者路径（`scripts/source-structure.mjs` 棘轮、DECISIONS D-039、STATUS、ARCHITECTURE 里的文件名）由维护者处理，见 #153。
