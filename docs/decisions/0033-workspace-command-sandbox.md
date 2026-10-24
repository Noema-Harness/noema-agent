# ADR 0033：项目命令的工作区沙箱与按次越界授权

- 状态：已接受（实现中；Windows 本机执行后端尚未通过）
- 日期：2026-10-24
- 确认：用户选择“所选工作区默认可写、网络与工作区外访问默认受限；只有越界时才对具体操作申请临时授权”。

## 决定

项目命令在操作系统级沙箱中运行。所选工作区是默认读写范围；系统运行时和应用明确配置的工具目录只读。外部路径访问和网络目的地必须按单次命令向用户展示具体对象、权限与用途，获准后仅对本次命令开放。拒绝、用户关闭对话框、沙箱未安装或初始化/清理失败时均不得退回到当前桌面用户身份执行。

在 Electron 主进程采用可替换的 sandbox-runtime 适配层，初版固定 `@anthropic-ai/sandbox-runtime@0.0.81`。Windows 使用独立本地沙箱账户与 WFP 出站过滤；安装必须跳过整个用户配置目录授权。由于 SRT 的 Windows 读取默认开放，逐一拒绝交互用户资料目录不足以兑现工作区边界：每次执行先拒绝已挂载且可应用 ACL 的本地卷根，再仅放行工作区、系统运行目录、执行工具、SRT 隔离账户自身目录和本次批准路径。映射网络磁盘或无法应用 NTFS ACL 的可访问卷会失败关闭。写入仍限于工作区及明确批准的路径。命令范围按实际批准的文件和网络需求组装。由于该库的 Windows ACL 写根会跨会话保留，正常清理后还必须移除本次命令留下的持久写授权；若无法确认撤销，后续命令失败关闭。

## 依据与限制

- Codex 的 Windows 执行设计将审批决策与文件/网络沙箱分开，并对后端无法严格表达的权限形状失败关闭；Noema 复用这一边界原则，不移植其 Rust 执行栈。
- OpenCode 的会话级权限请求生命周期适合作为用户批准的交互参考；Noema 的短时批准仍需绑定具体命令和对象，不能保存成全局 allow 规则。
- `sandbox-runtime` 提供 Windows 原生 token、NTFS ACL 与 WFP 机制及网络按命令授权；上游将 Windows 标为 alpha，且已知令牌模拟与系统服务代发流量限制。它不能被描述为完全隔离或成熟稳定的 Windows 安全边界。
- 本机续查：Windows 10 Pro 22H2（build 19045.6093）；SRT 账户、凭据和安装标记存在，`seclogon` 状态为 `ok`。从 C 盘工作区启动时 SRT 报 `mapped_drive_cwd`，但 Windows 将 C: 识别为固定 NTFS 磁盘；从 D: 工作目录启动则复现 `CreateProcessWithLogonW(srt-sandbox): Access is denied (0x80070005)`。因此服务启动状态和安装成功都不足以证明 runner 可启动。
- 对照 Codex 原生 elevated 后端时，`:workspace` 允许读取临时目录；自定义 profile 可拒绝用户资料目录，但把整个磁盘根设为 deny 会在启动时因“requires effective `:root` read access”失败。当前设备的 MXC 探测明确返回 unavailable。系统自带 Windows Sandbox 初始为 Disabled；已执行启用并核验状态为 Enabled、`RestartNeeded=True`，尚未重启，故不能声称该运行时可启动。上述均未达到“仅工作区 + 按次额外授权”的完整验收，不据此选择更宽松模式或执行无沙箱回退。
- Windows Sandbox 官方 `.wsb` 可关闭网络、映射目录并执行启动命令，但官方 `wsb exec` 当前不提供进程标准输入/输出，且要求活动用户会话；因此它不是 Noema 流式命令、取消和进程回收接口的直接替代物。[配置文件说明](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)；[命令行说明](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli)。若要使用，需另建基于共享目录的命令/日志/取消协议并实机验证，不能把启用组件当作可用后端。
- SRT `0.0.81` 是当前 npm latest；上游问题 #363 记录了在原生 Windows PowerShell 中安装成功后仍发生相同的 `CreateProcessWithLogonW(srt-sandbox): Access is denied (0x80070005)`。本机 seclogon、账户和凭据检查通过，重装并轮换密码仍未修复；本地登录权策略尚未核实，当前 Codex 命令策略也拒绝了只读导出探测。不得把它归因于某一原因，不重复重装或擅改系统登录策略。[上游问题 #363](https://github.com/anthropics/sandbox-runtime/issues/363)。
- Microsoft 新增的 `Experimental_CreateProcessInSandbox` 暴露 AppContainer、路径 ACL、网络代理等原生约束，但官方标为实验性且最低要求 Windows 11；本机实测是 Windows 10 22H2 build 19045，`processmodel.dll` 不存在。因此它不是本机可用的替代执行器，也不能作为降低边界的理由。[Microsoft API 文档](https://learn.microsoft.com/en-us/windows/win32/secauthz/createprocessinsandbox)。
- 真实隔离命令未通过，故本机 Windows 集成仍未落地；应用必须失败关闭，不得把集成代码或包构建通过表述为边界已生效。重启后首先复测 SRT 原生 runner 与卷根拒绝策略；若仍无法启动，再验证 Windows Sandbox 是否能通过共享目录协议满足命令输出、取消、外部路径隔离、网络默认关闭、按次授权和进程回收，未完成这些测试前不把它接入应用。
- `npm audit` 报告该运行时的传递依赖 `node-forge@1.4.0` 与 `zod@3.25.76` 有高危公告。Noema 不启用 TLS 终止；`zod/v3` 兼容实现单独打包使用桌面工作区的 Zod 4.6.7，但开发依赖树仍解析到上游声明的 Zod 3，且 node-forge 暂无可用修复版本。需在更新上游或替换适配器时重新评估，不扩大 TLS/证书解析用途。

## 取舍与重审条件

选用 OS 实际执行边界，避免把“命令以工作区为 cwd”误当成访问控制。接受 Windows alpha 的局限，是因为本地可验证且可替换，并且相较无沙箱状态能提供真实的账户、文件和出站约束。若安装/清理无法在当前平台可靠闭环、额外授权不能单次撤回、或上游已知限制无法满足 Noema 的威胁边界，则暂停该适配器并评估 Codex Windows backend 或其他原生执行边界；不得降级为无沙箱执行。

## 退出检查

未安装、已安装、默认拒绝外网、临时批准外网、拒绝外网、默认拒绝额外路径、单次读/写额外路径、任务取消、正常结束、清理失败及进程重启后的权限回收均需要可验证。只有真实 Windows 安装后的隔离命令与回收结果通过，才能把安全边界标为已落地。
