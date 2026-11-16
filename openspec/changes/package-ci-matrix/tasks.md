## 1. 产物冒烟按平台

- [ ] 1.1 `apps/desktop/scripts/smoke-package.mjs` 按 `process.platform`/`process.arch` 解析默认产物目录与可执行文件路径（win32/linux/darwin）。
- [ ] 1.2 Windows runner 资源与托盘生命周期断言只在 win32 执行，win32 断言内容不变。
- [ ] 1.3 Linux 启动追加 `--no-sandbox`，其余平台参数不变。

## 2. CI 矩阵

- [ ] 2.1 `Desktop package` 工作流改为 `windows-latest`/`ubuntu-latest`/`macos-latest` 矩阵，三平台都跑 `npm ci`、`package:desktop`、`smoke:package`、`make`。
- [ ] 2.2 Windows 专属步骤（dev smoke、Squirrel 安装生命周期）限定 `runner.os == 'Windows'`。
- [ ] 2.3 Linux job 安装 `xvfb`/`rpm` 并用 `xvfb-run` 跑冒烟；artifact 按平台命名上传。

## 3. 文档与决议

- [ ] 3.1 `docs/OPERATIONS.md` 打包小节记录矩阵、各平台命令与 Linux 沙箱例外。
- [ ] 3.2 `docs/STATUS.md` 与 `docs/DECISIONS.md` #151 记录第②刀结果，批次行更新为「②已归档，④待排期」。

## 4. 验证与收口

- [ ] 4.1 `node --check apps/desktop/scripts/smoke-package.mjs`、`npm run check` 全绿。
- [ ] 4.2 dispatch 三平台矩阵，确认各平台 job 绿并上传 artifact；归档变更、提交推送。
- [ ] 4.3 [用户] 确认 Windows 打包/安装行为未变，接受 macOS/Linux 产物为“可打包但未发布”。
