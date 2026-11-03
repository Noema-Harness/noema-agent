# Spec Delta

## ADDED Requirements

### Requirement: Windows command readiness has one trusted user-visible source
Windows 命令能力报告 SHALL 由主进程基于已验证的 runner 资源与本机设置状态生成，并通过受信 IPC 提供给 renderer。报告 MUST 包含支持状态、有限拒绝原因、backend 标识/版本及设置状态；renderer MUST NOT 根据文件存在、平台推断或缓存状态自行宣称命令可用。

#### Scenario: renderer displays Windows command readiness
- **WHEN** 主窗口读取或刷新命令能力报告
- **THEN** 主进程返回当前已验证的状态与拒绝原因，界面按报告呈现且不自行推断支持

#### Scenario: command readiness report cannot be read
- **WHEN** renderer 无法读取当前能力报告
- **THEN** 界面将 Windows 命令显示为不可用，并说明状态暂不可查

### Requirement: Windows isolation setup is explicitly user initiated
Windows 命令隔离首次设置 MUST 由用户在可信主窗口明确触发。应用启动和普通状态刷新 MUST NOT 自动调用需要管理员确认的设置；用户取消、拒绝 UAC 或设置后核验失败时，命令 MUST 保持不可用，直到用户再次主动设置并通过核验。

#### Scenario: user starts first-time setup
- **WHEN** 用户从 Windows 命令能力状态界面明确选择设置
- **THEN** 主进程运行设置并重新核验状态，随后更新能力报告

#### Scenario: setup is canceled or fails verification
- **WHEN** 用户取消设置、拒绝系统确认或设置核验失败
- **THEN** 能力报告保持不可用并显示有限原因，命令执行不启动

#### Scenario: application starts with setup missing
- **WHEN** 应用启动时发现隔离设置未完成
- **THEN** 应用仅执行只读状态检查，不自动请求管理员确认，命令保持不可用

### Requirement: Windows runner package identity matches the executable backend
Windows 安装包 MUST 包含恰好一个由应用实际使用的 Noema Windows runner 资源，其平台、架构、协议和版本 MUST 与主进程支持报告一致。资源缺失、重复、不可读取或身份不符时，系统 MUST 禁止新命令，且 MUST NOT 调用 SRT helper 或宿主 shell 作为替代。

#### Scenario: packaged runner matches the reported backend
- **WHEN** Windows 安装版启动并验证已打包的 runner
- **THEN** 主进程报告与执行器使用同一 runner 身份和版本

#### Scenario: packaged runner is missing or mismatched
- **WHEN** Windows 安装版发现 runner 缺失、重复、损坏或版本/协议不匹配
- **THEN** 命令能力报告为不可用，执行入口给出受限原因，且不启动其他命令后端

### Requirement: runtime capability changes close the Windows command gate
Windows runner 资源或设置的运行时探测结果变化时，主进程 MUST 更新能力报告并阻止新的命令。已启动命令 MUST 按现有 runner 取消、超时与收尾契约处理；能力变化 MUST 通过本机诊断事件关联到相应 application execution 与 task identity。

#### Scenario: readiness changes before a new command
- **WHEN** 主进程在执行前发现 runner 或设置能力已不再匹配
- **THEN** 新命令被拒绝，界面收到更新后的有限原因，且记录关联的探测变化

#### Scenario: readiness changes while a command is running
- **WHEN** 探测结果变化时已有命令运行
- **THEN** 主进程关闭后续命令准入并按现有 runner 生命周期收束当前命令，诊断记录状态变化与收尾结果

### Requirement: Windows command setup UI does not promise the retired SRT backend
Windows 命令能力界面 MUST 只展示当前实际 runner 的支持状态和操作。界面 MUST NOT 提示安装或使用不参与执行的 SRT helper；能力报告不可用时，界面 MUST 说明当前原因且不得暗示命令会回退到宿主环境。

#### Scenario: Windows command capability is unavailable
- **WHEN** 用户查看 Windows 命令能力状态
- **THEN** 界面显示主进程提供的 runner 拒绝原因，并且不出现旧 SRT 安装承诺

#### Scenario: Windows command capability is available
- **WHEN** runner 资源与隔离设置均通过主进程核验
- **THEN** 界面仅依据当前主进程报告显示命令可用及对应 runner 身份
