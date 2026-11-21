# 任务

## 1. 计划

- [x] 1.1 看板 #151（D-20261116-platform-layers 的跟进）；`npm run plan:check` 通过，计划单独提交

## 2. 夹具跨平台

- [x] 2.1 路径夹具按本机平台生成：touched files、越界写、search_files、linked worktree、runtime-paths
- [x] 2.2 ACL 授权夹具改用 Windows 路径字面量，3 个原生助手用例三平台都跑
- [x] 2.3 执行器测试的命令执行器在 POSIX 上用 `/bin/sh` 与进程组结束，3 个命令用例三平台都跑
- [x] 2.4 去掉 12 处 `windowsOnly`，保留 1 个盘符归一用例

## 3. 验证

- [x] 3.1 macOS（Node 24）全量 `npm test`：902 个，900 过、0 败、2 跳过；同机 main（`08939bb`）为 901 个，888 过、13 跳过，即 macOS 上多跑 12 个用例（11 个解除跳过 + 新拆出的 Windows 专属用例在 macOS 跳过、原两条 runtime-paths 用例改为本机路径后照跑）；连跑两遍结果相同；`npm run typecheck`、`npm run lint`（336 个文件）通过；diff 行数大是因为去掉 `windowsOnly` 参数后 oxfmt 把用例体减了一层缩进

## 4. 交接

- [ ] 4.1 发 PR，写验证证据
