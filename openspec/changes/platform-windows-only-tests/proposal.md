Plan: https://github.com/Noema-Harness/noema-agent/issues/151

## Why

- `portable` job 目前是报告期：Ubuntu 上已知 12 条失败（run 43931274245 的 job 133524013682），但不拦任何 PR；`verify` 仍要求 Windows 全量，协作者在 macOS/Linux 上无法自证。
- 12 条失败逐条查过 CI 日志，全部是 Windows 语义耦合，不是产品缺陷也不是偶发：`path.resolve`/`path.isAbsolute` 不解析盘符、结果用 `\` 分隔符、测试内命令走 `cmd.exe`/`taskkill.exe`、`WindowsRunnerNativeHelper` 用 `path.win32` 校验 grant 路径。
- 不显式标记，就只能靠 `continue-on-error` 假装没失败：门看得见但不管事，第④刀以后还要再交一次同样的解释。

## What Changes

- 新增测试辅助 `apps/desktop/test/support/platform-cases.mjs`：`windowsOnly(reason)` 在非 Windows 返回 `{ skip }`，Windows 返回空选项；附带自测，跳过逻辑本身有测试。
- 12 条用例按各自失败证据逐条标记 Windows-only（`D-20261116-platform-layers` 第③刀）。
- CI `portable` 去掉 `continue-on-error`，PR 上 Ubuntu 的 `npm test` 必须全过；`main` 推送仍只跑 `platform` 门，`portable` 只在 PR 上运行。
- 文档与决议 #151 执行层记录标记依据与剩余 Windows-only 范围。

## Impact

- 新增：`apps/desktop/test/support/platform-cases.mjs`、`apps/desktop/test/tooling/platform-cases.test.mjs`
- 修改：`apps/desktop/test/main/platform/runtime-paths.test.mjs`、`apps/desktop/test/main/chat/social-chat-store.test.mjs`、`apps/desktop/test/main/execution/noema-project-executor.test.mjs`、`apps/desktop/test/main/execution/social-work-command-runner.test.mjs`、`apps/desktop/test/main/execution/windows-runner-native-helper.test.mjs`
- 修改：`.github/workflows/desktop-checks.yml`、`docs/OPERATIONS.md`、`docs/STATUS.md`、`docs/DECISIONS.md`
- 不改 `apps/desktop/src/`；不改 Windows 上的测试集合与产品行为。
