## 1. 产物冒烟按平台

- [x] 1.1 `apps/desktop/scripts/smoke-package.mjs` 按 `process.platform`/`process.arch` 解析默认产物目录与可执行文件路径（win32/linux/darwin）。
- [x] 1.2 Windows runner 资源与托盘生命周期断言只在 win32 执行，win32 断言内容不变。
- [x] 1.3 Linux 启动追加 `--no-sandbox`，其余平台参数不变。

## 2. CI 矩阵

- [x] 2.1 `Desktop package` 工作流改为 `windows-latest`/`ubuntu-latest`/`macos-latest` 矩阵，三平台都跑 `npm ci`、`package:desktop`、`smoke:package`、`make`。
- [x] 2.2 Windows 专属步骤（dev smoke、Squirrel 安装生命周期）限定 `runner.os == 'Windows'`。
- [x] 2.3 Linux job 安装 `xvfb`/`rpm` 并用 `xvfb-run` 跑冒烟；artifact 按平台命名上传。
- [x] 2.4 `MakerDeb`/`MakerRpm` 的安装器 helper（`electron-installer-debian`、`electron-installer-redhat`）声明为 `apps/desktop/package.json` 的 `optionalDependencies`，让 `npm ci` 在 Linux/macOS 装上、Windows 跳过；`docs/OPERATIONS.md` 记录原因。
- [ ] 2.5 `MakerDeb` 传 `options.bin = 'Noema'`：Linux 包的可执行名来自 `productName`，安装器默认取 `package.json` 的 `name`（`noema-desktop`）。
- [ ] 2.6 移除 `MakerRpm` 与 `electron-installer-redhat` optional 依赖，Linux CI 不再安装 `rpm`；`docs/OPERATIONS.md` 记录 rpmbuild ≥ 4.20 不兼容、产品不发布 RPM 的原因。
- [ ] 2.7 Squirrel 安装生命周期的目录搬移加有限重试（CI 上偶发文件占用）。

## 3. 文档与决议

- [x] 3.1 `docs/OPERATIONS.md` 打包小节记录矩阵、各平台命令与 Linux 沙箱例外。
- [ ] 3.2 `docs/STATUS.md` 与 `docs/DECISIONS.md` #151 记录第②刀结果，批次行更新为「②已归档，④待排期」。

## 4. 验证与收口

- [x] 4.1 `node --check apps/desktop/scripts/smoke-package.mjs`、`npm run check` 全绿。
- [ ] 4.2 dispatch 三平台矩阵，确认各平台 job 绿并上传 artifact；归档变更、提交推送。
- [ ] 4.3 用户可见的门槛留在 `D-20261116-platform-layers` §3 验收（macOS/Linux 安装与启动），本刀只宣称“可打包、冒烟通过”，不宣称可安装发布。
