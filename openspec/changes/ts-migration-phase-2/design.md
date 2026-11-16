# design

## 事实影响

- 类别：结构
- 依据：源码文件扩展名与类型注解变化，模块划分、依赖方向与运行时行为不变；`docs/ARCHITECTURE.md` 里 `agent-runtime-core.mjs` 的文件名需要同步，属维护者路径，已在 #153 交接（本 PR 不改该文件，因此本机提交门的「结构需同改 ARCHITECTURE」会失败，见 #152）。

改动落点：`apps/desktop/src/main/**` 39 个模块（`git mv` 改名 + 类型）。
共享逻辑是否要移动：否。
是否新增路径或兼容层：否。

## 用户决策

- 无新增。沿用 D-039（已决定）。

## 实现选择

- 运行时等价靠“去类型后比对”验证：HEAD 的 `.mjs` 与新 `.ts` 经 TypeScript 去类型、去注释、oxfmt 统一格式后逐文件比对，只剩 3 处排版差异（维护者判断，可推翻）。
- 宽类型源头在尚未转换的大模块里（如 `hydrateSocialWorkTask`），本批用 `any` 并写注释说明，不扩大改动去改大模块。

## 用户可观察的改变

- 无。应用功能与界面不变；开发者侧 `npm run typecheck` 覆盖的模块增加 39 个。

## 手测步骤

1. `npm ci` 后 `npm run dev`，正常启动并能收发消息、打开项目。
2. `npm run typecheck` 0 错误。
