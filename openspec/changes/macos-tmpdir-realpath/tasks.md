# 任务

## 1. 计划

- [x] 1.1 看板 #151（D-20261116-platform-layers 的 macOS 余项）；`npm run plan:check` 通过，计划单独提交

## 2. 修复

- [x] 2.1 `noema-read-tools`、`project-command-sandbox` 测试的临时目录取真实路径
- [x] 2.2 `test-support/electron/isolated-worker-e2e.mjs` 结果路径检查与 `writeResult()` 同口径

## 3. 验证

- [x] 3.1 macOS（Node 24）全量 `npm test`：901 个，888 过、0 败、13 跳过（改动前 880 过、8 败；跳过的是 `windowsOnly` 等既有标记）；`npm run typecheck`、`npm run lint`（336 个文件）通过

## 4. 交接

- [ ] 4.1 发 PR，写验证证据
