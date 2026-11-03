## ADDED Requirements

### Requirement: Windows runner validates the serialized command policy before preparation
The native runner MUST strictly decode the bounded D2 policy v2 from IPC and verify protocol, request identity, policy version, fixed backend identity/version, workspace grants, environment policy, and network identity before backend preparation. Every directory root MUST carry a main-process volume/file identity that matches the native no-reparse handle. Missing or unknown fields, changed identities, aliases, and unsupported identities MUST be rejected.

#### Scenario: serialized policy is incomplete or incompatible
- **WHEN** an execute request omits a policy field, adds an unknown field, or supplies an unsupported policy/backend identity
- **THEN** the native runner rejects the IPC request before backend preparation

#### Scenario: a root identity differs from the native handle
- **WHEN** a root's serialized volume/file identity does not match the directory opened by native admission, or two distinct policy roots resolve to the same native directory object
- **THEN** admission rejects the request before readiness or child creation

### Requirement: Windows runner pins policy directories without following reparses
Before readiness or preparation, the native runner MUST open each existing workspace, read, write, and working-directory root through a local disk-volume path with reparse traversal disabled, retaining the resulting handles through admission. Any unresolved, missing, non-local, or reparse-backed path MUST be denied.

#### Scenario: a policy path resolves through a junction or cannot be pinned
- **WHEN** a policy directory is missing, cannot be opened as a local directory, or any path component is a reparse point
- **THEN** admission returns a bounded path reason and does not proceed to readiness or child creation

### Requirement: Windows runner readiness responses use a strict versioned schema
Windows runner probe responses MUST include protocol/request identity, backend and policy versions, OS build/UBR/architecture, AppContainer profile/package SID status, filesystem ACL journal status, network-filter status, blockers, and required capabilities. Missing or unknown fields and identity/version mismatches MUST reject the response before command admission. A separate sandbox account, its credentials, and restricted-token status are not v1 prerequisites.

#### Scenario: probe response is incomplete or from an incompatible helper
- **WHEN** a probe response omits a required field or reports an unsupported protocol, helper, or policy version
- **THEN** the runner rejects the response with a bounded reason and does not admit the command

### Requirement: Windows command admission requires complete readiness
The OS baseline, AppContainer profile/setup and filter state, blockers, readiness flag, and all required capabilities MUST pass the current release gate before command admission. Readiness is only a prerequisite and MUST NOT bypass later policy, AppContainer launch, or process-tree controls.

#### Scenario: OS baseline or setup is below the supported floor
- **WHEN** the Windows build/UBR is below the current Noema support floor, or sandbox setup or network filters are not ready
- **THEN** the runner rejects the command before process creation and reports the relevant readiness reason

#### Scenario: required capability is missing
- **WHEN** readiness reports any blocker, `ready=false`, or a required capability as unavailable
- **THEN** the runner rejects the command before process creation

#### Scenario: readiness passes while launch controls remain unimplemented
- **WHEN** the probe reports a complete readiness snapshot but AppContainer launch or process-tree controls are not implemented and verified
- **THEN** the runner still denies execution and does not create a child process

#### Scenario: setup marker exists but live AppContainer or enforcement state is stale
- **WHEN** versioned setup files exist but the AppContainer profile/package SID differs from the helper-verified state, or profile, current-request filesystem grants, or required network filters are missing, inconsistent, or cannot be queried
- **THEN** readiness remains false with a bounded repair reason, and no command child is created

#### Scenario: process interruption leaves setup in progress
- **WHEN** the host restarts after AppContainer profile, ACL, or network setup began but before readiness was committed
- **THEN** startup treats the identity as repair-required, revalidates actual OS state under the setup lock, and denies commands until recovery is complete

### Requirement: Windows filesystem roots use unambiguous Win32 path components
Windows command policy roots MUST reject path components that invoke alternate data streams, Win32 reserved device names, forbidden path characters, dot traversal, or trailing ASCII spaces/periods. This lexical check is only an admission check and MUST NOT replace native handle identity, reparse-point, or hard-link verification.

#### Scenario: a grant uses an ambiguous Win32 path
- **WHEN** a workspace, external, runtime, or working-directory root contains a colon outside its drive designator, a reserved device component, a forbidden Win32 character, a `.`/`..` component, or a trailing ASCII space/period
- **THEN** policy compilation or native policy admission rejects it with a bounded path reason before process creation and does not include the path in diagnostics

#### Scenario: a lexically valid grant still has an unresolved filesystem identity
- **WHEN** the path syntax is valid but native object identity is unresolved, a write root contains any reparse point, scanning fails or exceeds its bounded entry/depth limits, or a regular file at or under a write root has more than one hard link
- **THEN** the backend rejects the command before process creation and gives an actionable reason, including telling the user to remove or resolve a hard link; lexical validation alone does not mark the path safe

#### Scenario: ACL grant partially applies or rollback fails
- **WHEN** applying or recovering a sandbox write grant fails for any verified filesystem object, including failure while rolling back earlier ACL changes
- **THEN** the sandbox identity remains locked and the command is denied until setup recovery verifies the ACL state; a successful root ACL call alone does not prove descendant ACL propagation completed

### Requirement: Windows command starts only after isolation and process controls are ready
系统 MUST 仅在已编译策略、已确认后端与 setup 能力、隔离 child 已绑定进程树控制并成功完成启动前准备后，才允许 Windows 命令执行。任何策略、隔离、进程树控制或通信准备失败 MUST 阻止命令进入运行态，且 MUST NOT 改用宿主执行。

#### Scenario: backend and process controls are ready
- **WHEN** Windows 命令的 workspace grant 已编译，backend 与持久 setup 均通过当前能力探测，受限 child 已创建并绑定进程树控制
- **THEN** 系统允许 child 开始执行，并将 spawn 结果关联到原 tool call、SocialWork task 与诊断 execution

#### Scenario: launch preparation fails
- **WHEN** policy serialization、AppContainer profile/package SID、capability set、child 创建、Job 绑定或 required pipe 准备任一步失败
- **THEN** 命令不得进入运行态，不调用宿主 shell；若无法确认 child 未运行或已清理，则将副作用标记为 outcome unknown

### Requirement: Windows command output and terminal outcome remain associated
Windows runner MUST 将 stdout、stderr、退出码、耗时以及完成、失败、超时或取消原因关联到原 command request 和 tool call。流式输出 MUST 有界；截断时系统 MUST 明确显示截断事实，且不得把部分输出呈现为完整结果。

#### Scenario: command produces output and exits
- **WHEN** 已隔离的 Windows child 写入 stdout/stderr 并退出
- **THEN** 系统保留有序、有界的输出及确定的退出结果，并将其交回原执行器记录

#### Scenario: output exceeds the configured bound
- **WHEN** stdout 或 stderr 达到 Noema 限额
- **THEN** 系统停止保留超出部分、标明对应流已截断，并继续收束 child 生命周期

### Requirement: Windows command cancellation confirms process-tree cleanup
系统 MUST 将 Stop、超时和宿主收束映射为同一命令进程树的取消请求，并等待有界清理结果。只有确认 child tree 已退出后才可标记 cancelled/terminated；清理失败或状态未知 MUST 保留 outcome unknown，且 MUST NOT 自动重新执行该命令。

#### Scenario: cancellation terminates the full child tree
- **WHEN** 用户停止命令或命令超时，且 backend 确认同一 Job 内 child tree 已结束
- **THEN** 系统记录取消/超时原因、清理完成和最终退出状态，并保留已产生的文件副作用

#### Scenario: cancellation cannot confirm cleanup
- **WHEN** runner IPC、Job termination 或退出确认失败/超时
- **THEN** 系统记录 cleanup unknown 与有限原因码，将工具副作用保留为 outcome unknown，并要求显式人工检查后才能继续任务

### Requirement: Windows runner diagnostics trace lifecycle without command contents
系统 MUST 以同一 request/tool/task identity 关联 probe/readiness、policy 编译、spawn 阶段、child 生命周期、输出截断、cancel/timeout、退出与清理事件。主进程与 native helper 的严格响应 MUST 区分 AppContainer child 是否已 resume、stdout/stderr 的有界采集事实、确定退出以及 cleanup-confirmed/unknown；helper IPC 中断导致结果不确定时必须保留 outcome unknown。常规诊断 MUST NOT 保存命令文本、参数、完整环境变量、工作区路径、输出正文或凭据；仅本地进程标识及有限数值/枚举可按 allowlist 记录。

#### Scenario: inspect a completed Windows command
- **WHEN** 用户查看本机执行时间线
- **THEN** 可按 request/tool/task identity 查看 backend、阶段、持续时间、退出/取消/cleanup 结果与截断计数，不显示 command、路径或输出正文

#### Scenario: runner diagnostics sink is unavailable
- **WHEN** 本机诊断存储不可用
- **THEN** runner 仍按隔离执行结果完成或失败，不因诊断写入失败改用宿主执行或重放命令
