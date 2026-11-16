## 事实影响

- 类别：仅执行
- 依据：只改打包脚本与 CI 工作流，产品结构、接口与可观察行为不变；`docs/OPERATIONS.md` 记录新的打包矩阵。

## 用户决策

- 无：`D-20261116-platform-layers` 已确认“② 打包按系统拆分，CI 改为 Windows/macOS/Linux 矩阵”，本刀按该切法执行。

## 目标

- `apps/desktop/scripts/smoke-package.mjs` 在 win32/linux/darwin 上都能定位产物并完成启动冒烟；Windows runner 与托盘断言只对 win32 生效，win32 行为不变。
- `Desktop package` 工作流按系统拆成矩阵：每个平台各自 `npm ci`、`package:desktop`、`smoke:package`、`make`；Windows 保留 dev smoke 与 Squirrel 安装生命周期。
- artifact 按平台命名（`noema-windows-portable-*`、`noema-linux-portable-*`、`noema-macos-portable-*`），dispatch 时上传。
- 文档与决议记录第②刀结果。

## 非目标

- 不发布 macOS/Linux 安装包，不改变“产品只支持 Windows”的定位。
- 不为 macOS/Linux 增加签名、公证或自动更新。
- 不把 Linux 的 RPM/DEB 或 macOS 的 ZIP 变成发布渠道。

## 取舍

- Linux 冒烟用 `xvfb-run` + `--no-sandbox`：GitHub 的 ubuntu-latest 无特权用户命名空间，Electron 默认沙箱会直接退出；这两个标志只存在于测试脚本与 CI，不进产品。
- 三平台都跑 `make`，但只验证“配置在该平台能跑通”：macOS 出 ZIP、Linux 出 DEB/RPM；安装生命周期（Squirrel）只有 Windows 有。
- 平台路径与 runner 断言收在 `smoke-package.mjs` 内部，按 `process.platform` 分支；CI 不复制平台判断。

## 用户可观察的改变

- 无：Windows 上的安装、启动与功能不变。

## 手测步骤

- Windows：`npm run package:desktop && npm run smoke:package` 仍通过；`npm run make:desktop && npm run smoke:installer` 不变。
- macOS/Linux 只能由 CI 矩阵验证；本机没有这两个平台，只做脚本语法检查与工作流审阅。

## 验收

- 三平台矩阵 dispatch 全绿；Windows job 行为与今天一致，Linux/macOS job 各自产出 `Noema-<platform>-<arch>` 并上传。
- `npm run check` 全绿。
