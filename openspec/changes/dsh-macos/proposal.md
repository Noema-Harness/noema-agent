Plan: https://github.com/Noema-Harness/noema-agent/issues/148

# DSH 执行内核支持 macOS

## Why

2026-11-15 在 macOS arm64 上实测，Noema 能启动、聊天、打包，但项目任务只能读写文件、不能执行命令：

- `apps/desktop/src/main/integrations/dsh-headless-adapter.mjs` 的 `resolveDshHeadlessRuntime` 一开头就对非 Windows 报 `dsh_platform_unsupported`；查找方式也全是 Windows 写法（`where.exe dsh.cmd`、`node.exe`、`D:\NoemaTools\...`）。
- DSH 启动失败后，`main.ts` 把工单交给原生执行器，而原生执行器在生产环境没有命令通道（`run_command` 被隐藏）。

DSH 本身支持 macOS：`@deepseek-ai/dsh`（0.2.2-rc.1）在公开 npm 上、没有平台限制；它的 headless 配置在非 Windows 上自动启用 `tool-bash` + `bash-sandbox`（`dsh --profile headless --dump-default-config` 已核对）。卡住的是 Noema 自己的适配器。

## What Changes

- `resolveDshHeadlessRuntime` 支持 macOS：打包目录 `dsh-runtime/node`，或 PATH 上的 `dsh`（npm 全局安装）加 Node 24.21+。路径拼接按目标平台选择 `path.win32` / `path.posix`。
- worker 配置补丁按平台开启 shell 工具：Windows `tool-pwsh`，其他平台 `tool-bash`。
- worker 环境变量白名单补上 POSIX 变量（`HOME`、`USER`、`LOGNAME`、`SHELL`、`TMPDIR`、`LANG`、`LC_ALL`、`LC_CTYPE`）。
- `scripts/stage-dsh-runtime.mjs` 能在 macOS 上暂存（Node 文件名 `node`，默认用当前 Node 与 npm 全局目录）。

## Impact

- 规格：`project-execution` 新增需求「DSH 执行内核按宿主平台启动」。
- 代码：`apps/desktop/src/main/integrations/dsh-headless-adapter.mjs`、`apps/desktop/scripts/stage-dsh-runtime.mjs`、`apps/desktop/test/main/integrations/dsh-headless-adapter.test.mjs`。
- 不做：把 DSH 打进安装包（Windows 现在也没有打进 `extraResource`，单独一刀）；签名、公证、DMG；`macos-latest` CI；复用 DeepSeek Harness.app 自带的命令行。
