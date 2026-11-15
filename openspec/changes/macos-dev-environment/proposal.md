# macos-dev-environment

Plan: none

## Why

协作者在 macOS 上开发时，提交钩子与 lint 都需要额外处理：钩子文件缺可执行位、合并 main 时本地提交门会把从 main 带进来的路径当成新写的代码、oxlint 的原生包没有进锁文件。

## What Changes

- `.githooks/pre-commit` 带上可执行位，macOS/Linux 上 git 才会执行它。
- `scripts/maintenance.mjs` 的 `stagedPaths` 只把合并提交自己解决的路径算作本次改动。
- `package-lock.json` 记录 oxlint 的 darwin/linux 原生包。
- 开发文档补充 macOS 环境步骤（由维护者在主分支补写，协作者不改 `docs/`）。

## Impact

- 只影响开发环境与提交门，不改变产品行为与系统结构。
- 不涉及 `apps/desktop/src/` 的产品代码。
