# 任务

## 1. 计划

- [x] 1.1 看板 #151（D-20261116-platform-layers 的跟进）；`npm run plan:check` 通过，计划单独提交

## 2. 夹具跨平台

- [ ] 2.1 路径夹具按本机平台生成：touched files、越界写、search_files、linked worktree、runtime-paths
- [ ] 2.2 ACL 授权夹具改用 Windows 路径字面量，3 个原生助手用例三平台都跑
- [ ] 2.3 执行器测试的命令执行器在 POSIX 上用 `/bin/sh` 与进程组结束，3 个命令用例三平台都跑
- [ ] 2.4 去掉 12 处 `windowsOnly`，保留 1 个盘符归一用例

## 3. 验证

- [ ] 3.1 macOS 全量 `npm test` 0 失败；`npm run typecheck`、`npm run lint` 通过

## 4. 交接

- [ ] 4.1 发 PR，写验证证据
