## ADDED Requirements

### Requirement: DSH 执行内核按宿主平台启动

系统 SHALL 在 Windows 与 macOS 上都能发现并启动 DSH headless worker。打包目录内的 DSH 运行时 MUST 优先于外部安装；macOS 上外部安装 MUST 从 PATH 上的 `dsh` 解析到 `@deepseek-ai/dsh` 的入口，并使用 24.21 及以上的 Node。worker 补丁 MUST 只开启宿主平台对应的 shell 工具（Windows 为 PowerShell，macOS 为 bash），worker 环境 MUST 只携带宿主平台需要的白名单变量。找不到 DSH 或合适的 Node 时 MUST 返回可诊断的错误码，并且不启动任何 DSH profile。

#### Scenario: macOS 从 npm 全局安装发现 DSH

- **WHEN** macOS 上 PATH 中有指向 `@deepseek-ai/dsh/lib/bin.js` 的 `dsh` 链接，且 PATH 中有 Node 24.21+
- **THEN** 系统返回该入口与 Node 作为外部运行时，且发现过程不启动 DSH profile

#### Scenario: macOS 没有安装 DSH

- **WHEN** macOS 上 PATH 中没有 `dsh`，打包目录里也没有 DSH 运行时
- **THEN** 系统返回 `dsh_not_found`，项目任务退回原生执行器

#### Scenario: worker 只开启宿主平台的 shell 工具

- **WHEN** 系统为 macOS 生成 worker 补丁
- **THEN** 补丁开启 bash 工具、不开启 PowerShell 工具；为 Windows 生成时相反
