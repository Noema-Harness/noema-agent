# 本机运行说明

实际命令以当前 package.json、源码和运行结果为准。

## Shell

本机按实际运行环境探测，不以旧记录代替结果：

- Codex：PowerShell 7（`pwsh`）；2026-11-02 实测 7.6.5。
- DSH（DeepSeek Harness）：Windows PowerShell 5.1（`powershell.exe`）；2026-11-07 实测 `$PSVersionTable.PSVersion` 为 5.1.19041。避免使用 `??`、`?:`、`&&` 等 PS7 语法。

PowerShell 执行策略为 CurrentUser `RemoteSigned`（2026-11-07 设置），仓库内本地 `.ps1` 可直接运行；若仍被策略阻止，用 `powershell -ExecutionPolicy Bypass -File <脚本>`，不要为此改机器策略。`npm` 可能解析到 `npm.ps1`；执行策略允许后可直接使用，也可用 `npm.cmd`。

POSIX 脚本需要先确认实际 Git Bash 路径。`C:\Windows\System32\bash.exe` 不能当作 Git Bash。复杂结构化输入优先用参数数组或 `.work` 下的脚本/数据文件；文件操作使用 `-LiteralPath`。

开发 shell 与产品命令执行分开。Windows 命令目前因严格隔离边界未成立而关闭，更换 shell 不能作为启用依据；当前 guard 和回归见源码导航。

## 工具链（DSH）

DSH 侧的可移植工具位于 `%LOCALAPPDATA%\NoemaTools`，不依赖 Codex 运行时：

- Git：`NoemaTools\git\cmd\git.exe`（2.53.0）；`NoemaTools\dsh\git.cmd` 作为 PATH 入口。Node 子进程不能直接执行 `.cmd`，仓库脚本通过 `scripts/git-exec.mjs` 定位 `git.exe`。
- Node/npm：`NoemaTools\node-v24.21.0`；`dsh`：`NoemaTools\dsh`；`gh`、`openspec` 由用户级程序目录提供。
- `markitdown`：`NoemaTools\dsh\markitdown.cmd`（优先 DSH 工具目录，其次 Codex 的本地环境）。
- 需要一次性补齐 PATH 时，在新 shell 开头执行 `. .\scripts\harness-env.ps1`。用户级 PATH 已包含 `NoemaTools\git\cmd`，但需要新进程或重新打开应用后生效。

技能与常驻指令的对照、导入和验证见 [harness 对齐说明](../../../../docs/HARNESS_ALIGNMENT.md)。

## GitHub 与截图

Git/GitHub 连接使用项目脚本，必要时核对 `scripts/github-env.ps1` 实际代理路由。多行外部正文可用临时文件，只有获授权时才发送。

`scripts/capture-window.ps1 -WindowTitleRegex '^Noema$' -OutputPath <绝对路径>` 可原生捕获窗口。截图超时先判断窗口是否响应；renderer 状态日志位于用户数据目录的 `renderer-health.jsonl`。区分截图通道故障与应用无响应。

## 模型与隔离检查

真实模型调用遵守 `docs/CURRENT_CONTEXT.md` 的前置条件。`npm run e2e:social-work --workspace noema-desktop` 使用隔离数据；`--synthetic` 只验证合成服务行为，真实模式会调用已配置模型并产生用量。临时模型覆盖使用 `NOEMA_E2E_MODEL`，不回写用户配置。

FreeLLMAPI 仅为兼容接入，按其 operations 技能排障，不把它当作所有客户端检查的前提。凭据仅由正常应用路径读取，不输出或复制到命令行。

## 构建与 CI

工作流位于 `.github/workflows/desktop-checks.yml`；源码同步与 CI 账户状态分别核实。Forge/Vite 打包依赖 `.vite`，better-sqlite3 等主进程原生依赖由打包配置复制。构建成功和真实启动分别验证。发布或安装问题按当次证据定位，不沿用旧错误结论。
