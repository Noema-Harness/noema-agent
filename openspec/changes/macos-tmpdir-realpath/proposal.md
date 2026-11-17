Plan: https://github.com/Noema-Harness/noema-agent/issues/151

# macOS 上临时目录软链导致的 8 个测试失败

## Why

D-20261116-platform-layers 的第 ③ 刀已由维护者合入（`96f95be`：Windows 专属用例标记为 `windowsOnly`，Ubuntu 上的可移植门全绿）。2026-11-17 在 main（`46145bc`）上用 macOS 跑全量 `npm test`：901 个，880 过、8 败、13 跳过。8 个失败都不是 Windows 专属，而是 macOS 独有：`os.tmpdir()` 在 `/var/folders/…`，它的真实路径在 `/private/var/folders/…`。Linux 的 `/tmp` 不是软链，所以 CI 没暴露。

- `noema-read-tools`（1 个）、`project-command-sandbox`（1 个）：被测代码返回真实路径，测试拿未解析的临时目录比较。
- `tooling/isolated-worker-e2e`（6 个）：`test-support/electron/isolated-worker-e2e.mjs` 把未解析的结果路径与解析过的目录比较，在 `tmpdir()` 是软链的系统上永远判为越界，属于测试辅助的真缺陷。

## What Changes

- 两个测试的临时目录先取真实路径。
- 隔离 E2E 辅助的结果路径检查改为与 `writeResult()` 同一个未解析目录比较（结果文件此时还不存在，无法取真实路径）。

## Impact

- 代码：`apps/desktop/test/main/chat/noema-read-tools.test.mjs`、`apps/desktop/test/main/execution/project-command-sandbox.test.mjs`、`apps/desktop/test-support/electron/isolated-worker-e2e.mjs`；产品代码不变。
- 不做：把 `windowsOnly` 标记的 12 个用例改成三平台都跑（另议）；在 CI 里加 macOS 测试任务（维护者路径 `.github/`）。
