# 打包按系统拆分并交给 CI 矩阵

## Why

`Desktop package` 工作流只有 `windows-latest` 一个 job：macOS/Linux 的 makers 与平台产物路径从未被执行过，`smoke:package` 把 `Noema.exe`、`Noema-win32-x64` 和 `windows-runner` 资源写死，非 Windows 打包今天既跑不了也测不了。`D-20261116-platform-layers` 的第②刀要求把打包按系统拆开、CI 改成矩阵（issue #151）。

## What Changes

- `apps/desktop/scripts/smoke-package.mjs` 按宿主平台解析产物：win32 `Noema.exe`、linux `Noema`、darwin `Noema.app/Contents/MacOS/Noema`，默认目录 `out/Noema-<platform>-<arch>`；Windows runner 与托盘生命周期断言只在 win32 执行；Linux 启动追加 `--no-sandbox`（CI 无特权用户命名空间）。
- `.github/workflows/desktop-package.yml` 改为 `windows-latest` / `ubuntu-latest` / `macos-latest` 矩阵：三平台都 `npm ci` → `package:desktop` → `smoke:package` → `make`；Windows 额外保留 dev smoke 与 Squirrel 安装生命周期验证；artifact 按平台命名。

## Impact

- 行为：产品仍只发 Windows；本刀让打包与产物冒烟在每个平台各自可验证，不改变用户可观察行为。
- 结构：打包验证从“Windows 单点”变成“每平台各自打包 + 产物启动冒烟”；平台差异只保留在 `smoke-package.mjs` 一处。
- CI：触及桌面端的 PR 会多跑两个打包 job（Linux/macOS），失败按平台可见。

Plan: https://github.com/Noema-Harness/noema-agent/issues/151
