## 1. 标记依据

- [ ] 1.1 逐条核对 run 43931274245 的 Ubuntu 失败日志，把 12 条归因写进用例旁（盘符解析、`\` 分隔符、`cmd.exe`/`taskkill.exe`、`path.win32` 校验）。

## 2. 测试辅助

- [ ] 2.1 新增 `apps/desktop/test/support/platform-cases.mjs`：`windowsOnly(reason)` 在非 Windows 返回 `{ skip: "Windows-only: …" }`。
- [ ] 2.2 新增 `apps/desktop/test/tooling/platform-cases.test.mjs`，覆盖 Windows 与非 Windows 两种返回值。

## 3. 标记 12 条用例

- [ ] 3.1 `runtime-paths.test.mjs` 2 条（盘符 `path.resolve`/`path.isAbsolute`）。
- [ ] 3.2 `social-chat-store.test.mjs` 1 条（`C:\` 绝对路径判定）。
- [ ] 3.3 `noema-project-executor.test.mjs` 5 条（`\` 分隔符、`..\` 越界、`cmd.exe` 命令、进程树停止/超时）。
- [ ] 3.4 `social-work-command-runner.test.mjs` 1 条（`cd /d` 命令断言）。
- [ ] 3.5 `windows-runner-native-helper.test.mjs` 3 条（`path.win32` 校验 grant/userData）。

## 4. CI 与文档

- [ ] 4.1 `.github/workflows/desktop-checks.yml` 的 `portable` 去掉 `continue-on-error`，注释改为“平台专属用例已显式标记”。
- [ ] 4.2 `docs/OPERATIONS.md` 写明 `portable` 已是 PR 必过门、跳过必须带 `Windows-only:` 原因。
- [ ] 4.3 `docs/STATUS.md` 与 `docs/DECISIONS.md`（#151 执行层）记录第③刀结果与剩余范围。

## 5. 验证与收口

- [ ] 5.1 Windows `npm run check` 全绿（用例数不减）。
- [ ] 5.2 推送后 `verify`/`portable`/`platform`/`collaboration` 四项在 PR/CI 全绿。
- [ ] 5.3 归档变更、更新 STATUS 计数并提交。
