# desktop-host-lifecycle Specification

## Purpose
定义 Noema 桌面宿主、主窗口、系统托盘、单实例和显式退出的生命周期，使窗口隐藏期间主进程继续运行并可恢复。

## Requirements

### Requirement: 主窗口关闭进入托盘后台
Windows 桌面宿主 MUST 在显示主窗口前建立系统托盘入口。托盘可用时，用户关闭主窗口 MUST 隐藏该窗口而不退出 Electron 主进程、重建服务或取消活动任务。托盘菜单 MUST 提供恢复窗口和显式退出两项操作。

#### Scenario: 用户关闭主窗口
- **WHEN** Noema 正常运行且用户关闭主窗口
- **THEN** 原主窗口隐藏，系统托盘仍可见，主进程及其服务保持运行，活动任务不因窗口关闭而停止

#### Scenario: 从托盘恢复窗口
- **WHEN** 用户点击托盘图标或选择“打开 Noema”
- **THEN** 宿主显示、还原并聚焦原主窗口；若原窗口已不存在，只创建窗口而不重复初始化应用服务

#### Scenario: 托盘初始化失败
- **WHEN** 系统托盘图标或菜单初始化失败
- **THEN** 本机诊断记录 `tray.error`；主窗口保持可见，关闭操作按正常应用退出路径处理，不将应用留在无返回入口的隐藏状态

### Requirement: 单实例启动恢复现有窗口
桌面宿主 MUST 保持单实例运行。第二次启动 MUST 将现有实例窗口显示、还原并聚焦，不得新建第二组服务或任务 owner。

#### Scenario: 第二次启动应用
- **WHEN** 已有 Noema 实例运行时用户再次启动 Noema
- **THEN** 现有实例恢复并聚焦主窗口，第二个进程退出

### Requirement: 显式退出经过宿主 shutdown
系统托盘 MUST 提供明确的“退出 Noema”操作。显式退出 MUST 进入主进程现有 shutdown owner，而不是销毁 renderer 后依赖 `window-all-closed` 偶然退出。宿主 MUST 记录退出请求、shutdown 开始、完成或超时；等待 MUST 有界，超时仍允许进程结束且不得伪报为正常完成。

#### Scenario: 用户从托盘显式退出
- **WHEN** 用户选择托盘“退出 Noema”
- **THEN** 宿主执行一次 shutdown，完成后进程退出，托盘图标被销毁

#### Scenario: shutdown 超过期限
- **WHEN** 任一 shutdown 工作在规定期限内未结束
- **THEN** 本机诊断记录 `shutdown.timeout`，应用以超时结果继续退出，不将其记录为 `shutdown.completed`

### Requirement: 生命周期转移写入安全诊断事件
宿主 MUST 将 `window.hidden`、`window.restored`、`tray.ready`、`tray.error`、`exit.requested`、`shutdown.started`、`shutdown.completed`、`shutdown.failed` 和 `shutdown.timeout` 记录到本机诊断事件表，并使用当前 application execution ID。事件 MUST NOT 包含任务指令、窗口内容、凭据或本机文件路径。

#### Scenario: 关窗与恢复可追踪
- **WHEN** 主窗口隐藏后从托盘或单实例请求恢复
- **THEN** 事件表按顺序记录窗口隐藏和恢复，且不包含窗口标题之外的用户内容或本机路径

#### Scenario: 诊断存储不可用
- **WHEN** 生命周期诊断写入失败
- **THEN** 关窗、恢复和退出行为继续完成，不由诊断故障阻断宿主动作

### Requirement: Windows session end uses bounded task shutdown
Windows shutdown, restart, or user logout MUST be identified as `system_shutdown` and routed through the main-process shutdown owner. The host MUST persist the shutdown intent before stopping services, wait no longer than 12 seconds, clear the intent after clean completion, and preserve it if shutdown times out or fails. The reason MUST remain distinct from an explicit application exit.

#### Scenario: tasks stop during system shutdown
- **WHEN** Windows requests session end and active work settles within 12 seconds
- **THEN** the host records `system_shutdown`, drains services, clears the durable intent, and exits

#### Scenario: shutdown deadline is exceeded
- **WHEN** active work does not settle within 12 seconds
- **THEN** the host records a timeout and leaves the durable intent so startup can classify active tasks as `system_shutdown_incomplete`

#### Scenario: process is lost without a shutdown intent
- **WHEN** startup finds active tasks and no durable shutdown intent
- **THEN** it classifies recovery as `process_crash`, leaves possible side effects unknown, and does not replay them

### Requirement: Local diagnostics identify the application runtime and applied schemas
Diagnostics views and exports MUST include an allowlisted runtime manifest with product/runtime versions, platform and architecture, packaged status, and the applied SocialChat and diagnostics schema versions when readable. The manifest MUST omit personal paths and content.

#### Scenario: User reviews a diagnostic report
- **WHEN** local diagnostics are opened or an export preview is prepared
- **THEN** the report identifies the Noema/Electron/Node build context and applied data schemas without including user paths or conversation content

#### Scenario: Migration metadata cannot be read
- **WHEN** a migration ledger is absent or unreadable
- **THEN** its version is reported as unknown and normal diagnostics remain available without changing database state

### Requirement: Startup and data-schema outcomes are diagnosed safely
When the diagnostics event store is available, Noema MUST record successful SocialChat schema initialization and startup initialization failures with finite lifecycle codes. These events MUST NOT store raw error text or user data.

#### Scenario: SocialChat schema initializes
- **WHEN** the SocialChat store is successfully constructed
- **THEN** diagnostics records the applied schema version as a bounded migration lifecycle event

#### Scenario: Later startup step fails
- **WHEN** host initialization fails after diagnostics become available
- **THEN** diagnostics records a fixed startup failure category and phase without message, stack, path or content, while the existing error dialog still appears

#### Scenario: Root database cannot open
- **WHEN** initialization fails before a diagnostics store is available
- **THEN** Noema shows its startup error dialog and does not attempt to fabricate a persistent diagnostics event

### Requirement: Local diagnostics report database health on demand
Noema MUST offer an on-demand, read-only integrity check for the open application database and show only a finite health status. The check MUST NOT run automatically during startup, and diagnostics MUST NOT expose raw SQLite errors, paths, or user data.

#### Scenario: Database integrity check succeeds
- **WHEN** the user opens or refreshes local diagnostics and the SQLite quick check succeeds
- **THEN** diagnostics shows that the database check passed

#### Scenario: Database integrity check reports a problem
- **WHEN** the SQLite quick check reports a problem or cannot run
- **THEN** diagnostics shows a bounded problem or unavailable status without the SQLite error text and continues to show other available diagnostics

### Requirement: User can open the fixed data directory for recovery
Noema MUST provide a user-initiated action to open its application data directory from diagnostics and from the startup error dialog when database initialization fails. The directory MUST be selected by the main process; the renderer MUST NOT provide or alter the path. Noema MUST NOT automatically restore, replace, or delete database or snapshot files.

#### Scenario: User opens the recovery location
- **WHEN** the user chooses the data-directory action
- **THEN** the operating system opens Noema's fixed application data directory and Noema explains that manual file recovery requires closing the application first

#### Scenario: Startup database initialization fails
- **WHEN** the application cannot initialize its database
- **THEN** the startup dialog offers the data-directory action and exiting, without opening the directory automatically
