# Tasks

## 1. 收敛 Codex 源码与 native crate 边界

- [x] 1.1 从固定快照为 provisioning、token、path identity、ACL/WFP、process/Job、IPC 分别建立实际模块/调用/依赖图，并确认可裁剪边界；已将入口图与上游文件路径记录于 `.work/planning/research/noema/CODEX_RUNNER_SOURCE_SLICE.md`，固定源树整体 SHA 校验见 `SNAPSHOT.md`。源文件复制时的逐文件 SHA/本地差异台账及实际最小 Cargo closure 留在 1.2 实施时验证。
- [x] 1.2 建立 Noema Windows native crate 与严格版本化 IPC/policy schema，不引入 Codex workspace crates；用 `cargo tree --locked --offline` 核对依赖树并用 `cargo metadata --locked --offline` 记录许可证入口，见 crate 内 `DEPENDENCY_LICENSES.md`。
- [x] 1.3 使用 Rust Windows x64 target 编译 helper 并运行可执行的 protocol/policy tests；记录目标机 Windows enforcement 之外仍未验证的内容。已用 MSVC 14.44 与 Windows SDK 10.0.26100.0 通过。
- [x] 1.4 将 capability、Windows build/UBR、helper 版本、AppContainer profile/setup health 编成 typed readiness 结果；用静态 fixture 核对缺字段、旧版、unsupported build、setup incomplete 都拒绝命令。Strict JSON response parser 与 readiness reason validator 完成；覆盖缺字段/未知字段、旧 protocol/helper/policy、unsupported Windows build、setup/filter 不完整、blocker、capability 缺失和 request identity mismatch；实际执行仍硬拒绝。

## 2. 接入 D2 policy 与 fail-closed 准备阶段

- [x] 2.1 将 D2 policy v2 序列化到 native IPC，重验 schema/version/backend identity；使用有效与不支持策略 fixture 验证只有完整 policy 可进入 prepare。真实 bounded IPC parser 已覆盖完整 D2 JSON fixture、缺字段/未知字段、旧 policy version、backend ID/version mismatch 和 request identity mismatch；有效策略仍会被未完成的 readiness gate 拒绝。
- [x] 2.2 实现或适配可信路径对象、重解析点与硬链接预检，并在 JS/native admission 同步拒绝非法 Win32 路径；边界 fixture 证明身份不确定时不会创建 child。文件 ACL 事务与 profile/capability setup 已实现；本机源码门完成，OS enforcement 留给 3.3.b。
  - [x] 2.2.a JS/native 同步拒绝 Win32 alternate stream、保留设备名、非法字符、点段和尾随点/空格；policy fixtures 覆盖路径别名。
  - [x] 2.2.b native 将本地盘符映射至磁盘卷并通过 `OBJ_DONT_REPARSE` 打开 policy objects，句柄保持到 readiness admission；workspace/cwd 要求目录，显式 grant 可为文件或目录；缺失路径与 final/ancestor junction fail closed。
  - [x] 2.2.c 将可信 main-process bigint stat 预检的 volume/file identity 带入 policy v2，native 与 `OBJ_DONT_REPARSE` 对象句柄比对，拒绝对象别名或身份变化；JS/native targeted tests 通过，Windows command gate 仍关闭。
  - [x] 2.2.d 基于固定源码和 Win32 handle API 实现写授权目录/单文件普通文件 hardlink 检查：任一文件 link count > 1 即拒绝并提示处理；检查所有实际获 capability ACL 的 read roots（含 write roots），紧邻 ACL 事务，任一枚举、打开、查询或 ACL 错误都 fail closed。用户已确认一期把同一 Windows 用户下的宿主进程视为可信，不以全树排他句柄锁防御恶意宿主进程；read-only runtime roots 也纳入扫描，因为其 ACL 赋予读 capability。native handle-based directory scanner 与单文件 root link-count check 已实现。ACL 必须作用于经验证的对象句柄；main process 必须在任何 ACL helper 调用前原子持久化批量 grant journal（对象绝对路径、verified identity、read/write 模式、capability SID、对象类型），中断/部分失败时 journal 留在 repair-required 并阻止 command readiness；恢复时必须重开 no-reparse handles、比对身份并重新扫描；若 read-only live evidence 与已持久 snapshot 一致可清除 journal，若 ACL/树摘要变化则从持久 grants 幂等重做、刷新 verified snapshot，再进行只读核验后清除；只有所有对象 ACL、对象树摘要与目录未来子项继承 ACE 都经 live evidence 核验后才清除 journal。不得将 root DACL 成功当成所有子对象已成功继承的证明。`windows-runner-acl-journal.mjs` 提供 main-process 严格状态/原子侧车与逐根 live evidence 门槛；native `acl.rs` 实现 handle-based 按读写模式应用 DACL、应用后同句柄回读验证、SID结构/null/protected/deny ACE检查与内存ACL fixtures；`path_identity.rs` 实现递归 no-reparse ACL reconciliation、所有 grant roots 重新扫描/身份比对、逐对象ACL核验、目录继承核验与匹配journal字段的SHA-256对象身份证据。Rust helper 使用只含旧 grants 的严格版本化 ACL IPC，执行前拒绝 restricting-SID caller；main-process `windows-runner-native-helper.mjs` 提供 shell-free、allowlisted-env、bounded one-shot spawn/stdin/stdout 与严格 response/evidence validation。`windows-runner-acl-transaction.mjs` 在主进程先持久化 journal，再调用注入 helper reconciliation，保存 verified evidence 并在第二次只读核验后清账；进程内调用串行化，重启时只按 journal 中旧 grants 恢复，当前请求 fail closed 并要求 retry；verified 证据与现场不同时重新对账并更新快照。Node transport/journal fixtures 与 native IPC fixtures 覆盖顺序和 schema；开发验证不执行真实 ACL mutation；只读真实 helper IPC smoke 已验证请求往返和缺失 ACE 拒绝。生产 app helper resource resolve/readiness 属于后续 D4 集成，目标机 ACL 效果留给用户验收；AppContainer/profile/capability setup 进入 2.2.e，runner仍拒绝执行。
  - [x] 2.2.e 以普通 AppContainer 替换独立 sandbox account/restricted-token 路径。已实现 per-user profile lifecycle、当前请求 capability mapping，并退役旧产品执行代码。开发检查没有创建/删除 Windows 账户、创建 AppContainer profile 或修改 ACL/WFP；command readiness 保持 false。
    - [x] 建立一次性 UAC worker transport：runas 启动、owner/Admin/SYSTEM-only 本地 overlapped named pipe、精确 worker PID 对账、bounded frame、取消/提前退出处理；Windows x64 MSVC 59/59，release check 与 Rustfmt 通过。
    - [x] 增加独立只读 account probe：helper 重查本地 SID、standard-user/启用/非锁定/密码有效状态、直接与间接本地 Administrators 成员关系，并用 LogonUserW 验证存储凭据；其余 token/filesystem/network evidence 继续为 false。开发测试未查询或改变真实账户。
    - [x] 旧 sandbox-account token constructor 子任务由后续普通 AppContainer 设计取代，不再实现独立 runner/受限 token。当前可信 helper 从已核验 grant 派生当前请求 capability SID，经 `CreateProcessW` 以 `SECURITY_CAPABILITIES` 创建 suspended child，并通过 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 在创建时绑定 kill-on-close Job；`IsProcessInJob` 核验后才 resume。失败清理与 readiness gate 有 fixture 覆盖。当前 helper readiness 仍关闭，实际 OS enforcement 留给目标机验收。
    - [x] 2.2.e.1 用持久、可验证的 `(object identity, access mode) → capability name/SID` 映射替换随机 `S-1-5-21-*` SID；native 调用 `DeriveCapabilitySidsFromName` 并拒绝未知、重复或漂移记录。Electron main 的记录绑定文件对象身份、read/write 模式和稳定名称，helper 只接受匹配当前策略的名称并重新派生 SID 后才操作 ACL；保留 verified identity、ACL journal 和 all-root hard-link scan。Node 43/43、native 94/94 通过，未做真实 ACL mutation。尚未完成 AppContainer profile 建立或进程启动。
    - [x] 2.2.e.2 改造 setup/readiness 为当前 Windows 用户下的 Noema AppContainer profile：native 使用固定 moniker 幂等创建或解析 profile、独立查询 profile folder 并核对 package SID；main 在 helper 调用前持久化 repair-required，只有全新 probe 匹配 package SID 且 profile 存在才提交 ready。零 profile capability；setup 不创建账户/凭据、不启动 UAC。setup state 升为 v4；旧账户/token/WFP-evidence 状态被严格识别后只重置为 unconfigured，不被当作 profile ready，也不自动删除系统账户。Node setup/helper/state 33/33、native 90/90、release check 与 fmt check 通过。开发检查未创建 AppContainer profile、未运行受限命令、未修改 ACL/WFP。
    - [x] 2.2.e.3 删除确认无调用者的 `credential_protection.rs`、`credential_store.rs`、`restricted_token.rs`、`runner_host.rs`、`runner_protocol.rs`、`sandbox_account.rs`、`sandbox_runner.rs`、`setup_elevation.rs`；移除旧 `CreateProcessAsUserW` 启动函数和 NetManagement/UI-Shell 依赖特性，更新 native README。保留 `acl.rs`、`path_identity.rs`、`setup_mutex.rs` 和研究审计记录。源码引用检查、native 77/77、release check、Node runner 58/58、source:check、OpenSpec strict 与 diff check 通过。历史独立账户 live probe 不代表当前 AppContainer 行为。
  - [x] 2.2.f 身份缺失/变化、路径别名、workspace 与额外只读/读写根 reparse、目录/单文件 hard link、setup 不完整均有拒绝 fixture。Native execute 的 launch 分支只在 admission 完整通过后调用；当前 probe 恒 not-ready，因此所有请求 fail closed。通过源码调用顺序与 fixture 验证，没有运行真实命令或声称已验证 OS enforcement。Native suite 77/77、release check、Rustfmt 通过。
- [x] 2.3 使用 Windows AppContainer 默认网络隔离，不授予命令 child 任何网络 capability；删除重复的持久 WFP provider/filter、UAC worker、只读检查 CLI 和卸载清理。已有目标机实测：宿主正向控制连通本机 listener，固定 `curl.exe` 在零网络 capability AppContainer 内无法连通；profile create/probe 不再安装 WFP 或要求 UAC。Rust 88/88、3 ignored，release check、Rustfmt；相关 Node suite 47/47。
  - [x] 2.3.a 修复 AppContainer 启动基础：子进程 allowlist 加 `LOCALAPPDATA`；路径引用去除 UTF-16 NUL；Job Object 正常完成/超时清理改用 `QueryInformationJobObject` 的活动进程数，不将 Job handle 错当通用进程树退出信号。
  - [x] 2.3.b 目标机零网络 capability loopback 验收：host control 成功，AppContainer 请求失败，listener 未收到请求；无 UAC、无 ACL 修改。
  - [x] 2.3.c 网络隔离验收已由 2.3.b 的真实 loopback 探针完成；不再有 WFP setup/readback 子任务。
## 3. 创建受控 child 并完成 IO/cancel 生命周期

- [x] 3.1 将可信 native helper 改为直接创建 policy-compiled AppContainer command child；不再启动 sandbox-account runner 或传递 inner runner pipe。通过 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 在创建时直接加入 kill-on-close Job，核实成员关系后才恢复挂起主线程，避免先创建后加入 Job 的孤儿进程窗口。现有 readiness probe 仍 fail closed，故正常 admission 不会创建 child；未执行真实命令或验证 OS 隔离效果。
  - [x] 3.1.a–3.1.d 旧独立账户 runner 启动、pipe 与 restricted-token 子流程均已退役；其历史验证记录保留在 `.work/planning/PROGRESS.md`，不再视为当前代码实现。
  - [x] 3.1.e `CreateProcessW` 经 `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` 接收固定 package SID 与只含当前授权根的 capability SIDs。native fixture 验证 read/write SID 分离、拒绝网络 capability 和 malformed/重复名称、system `cmd.exe` bootstrap 路径；read/write roots 均做 hard-link scan。不执行真实命令，也不声称真实 ACL/网络 enforcement 已验证。
- [x] 3.1.f explicit std handle list、allowlisted environment、suspended process、`PROC_THREAD_ATTRIBUTE_JOB_LIST` 创建期 Job 归属、bounded stdout/stderr 和 helper cancellation 已合入同一路径。native 在恢复主线程前以 `IsProcessInJob` 独立核实 Job 归属；核验或恢复失败即终止并等待，清理状态未知时返回 outcome unknown。fixture 验证核验顺序、失败清理、输出截断和取消结果；未启动真实命令。
- [x] 3.2 独立 stdout/stderr pipe、每路 128 KiB bounded drain/truncation、流读取错误、退出码与耗时回报已实现；native fixtures 覆盖超限/恰达上限、读取错误及 truncation 语义。真实命令输出行为留待目标机验收。
- [x] 3.3 Stop/timeout 都作用于同一个 kill-on-close Job；Job 在进程创建时即绑定，helper 被终止时不会留下尚未加入 Job 的挂起 child。正常完成通过 `QueryInformationJobObject` 轮询 `ActiveProcesses == 0`，超时终止 Job 并有界等待整组进程退出，失败返回 cleanup unknown。fixture 与目标机 live acceptance 均覆盖根进程先退出但 Job 内仍有后代、timeout 和 Stop 后残留检测。
  - [x] 3.3.a Job wait 不以 root process exit 或 Job handle signal 代替 process-tree completion；通过 Job accounting 的活动进程数确认整组退出，timeout 对 Job 执行 `TerminateJobObject` 后等待活动进程清零。
  - [x] 3.3.b 目标机 live probe 通过：root 退出后仍等 Job 后代完成（2.123 秒），超时后约 1.010 秒确认整组清理，终止 helper 后 profile marker 检查为 `child_residue=none`。该 acceptance 未修改 ACL/WFP，也不代表文件 ACL enforcement 已验收。

- [x] 3.4 在目标机 ACL、网络 deny、process-tree 三项 enforcement evidence 完整后，移除 unconditional `RunnerImplementationIncomplete` blocker；capability flags 只报告已实现项，并由当前 Windows build/architecture 与真实 AppContainer profile 决定 native readiness。实测 ACL：read capability 可读但不可写，write capability 可写，无 capability 不可写；Electron main 的真实 setup store、journal-before-ACL transaction、helper 两次 evidence 核验和 sandbox command 对临时工作区的完整链路也通过，命令写入 proof 文件并正常退出。保持 execute admission 的二次 native probe与最终 ACL核验；缺少/错误 capability、缺失必要字段、旧 helper/policy、unsupported platform、身份变化、hard link、reparse、ACL/journal失败仍拒绝。只读 helper probe 当前回报 Win10 build 19045、profile ready、全部必需 capability ready、network broker false。Rust 88/88，release check、fmt 通过；runner Node targeted tests 通过。打包版资源验证属于 D4，目标机普通工作区使用仍待用户日用验收。
- [x] 3.4.a 将 `identity_bound_network_broker` 明确为条件能力：一期 deny-only 网络策略不要求 broker；若未来支持 prompt-per-destination，policy admission 必须继续在 broker 能力未实现或未就绪时拒绝。native 与 Electron readiness 对其余必需能力仍逐项 fail closed。

## 4. 接入 Noema task 与诊断时间线

- [x] 4.1 将 main-process admission 与 Electron task 身份接入可信 helper/resource owner；仅在 backend、durable/live setup readiness 完整后才允许 policy 进入 native execute，renderer 无法自报 backend capability 或授权 root。开发期 native readiness 保持 false，命令门关闭。
  - [x] NoemaProjectExecutor 为每次 run_command 传递 request/execution/task/tool-call identity；Electron admission service 在 main process 重新读取 backend readiness、持久 setup 状态和本次 policy/root identity，再经 durable ACL transaction 后才请求 native execute。
  - [x] 将 bounded task identity 与已验证 capability grants 随 execute request 通过 Electron-main → native-helper 单一协议传递；移除已退役的内部 runner pipe/protocol。主进程不能由 renderer 自报 helper/backend capability 或授权 root。
  - [x] 将 admission service 接入 Electron main 的可信 helper/resource owner；helper 路径由主进程按打包/开发固定位置解析，启动只读 probe，不触发 setup reconcile。资源或 probe 失败时 fail closed，不回退 SRT/宿主 shell；renderer 不能指定 helper/backend/grants。target-machine acceptance 后 native readiness 按实际平台/profile/capabilities 开放，但 Electron 仍要求 durable setup state 和 ACL journal transaction ready。
- [x] 4.2 将 Windows runner 阶段事件接入 diagnostics，并以隐私断言确认只保存安全事实，不保存 command、argv、path、env、host、输出正文或凭据。
  - [x] main admission 记录 probe/setup/policy、helper 启停、输出采集与 typed terminal result；ACL journal/recovery 阶段带 request/execution/task/tool-call identity。
  - [x] diagnostics 只保留阶段码、状态码、退出码、耗时、有限输出字节数、截断/timeout/cleanup 标志；测试断言命令、路径、环境和输出正文均被丢弃。
  - [x] native helper 协议 v6 对 child 是否 resume、typed exit/timeout 与 Job cleanup-confirmed/unknown 作严格分层返回；Electron 只在可信结果确认后记录 `sandbox_child_started`，输出事件仅记录 byte counts 与截断状态。Stop 导致 helper IPC 被终止时记录副作用与 cleanup unknown，不用 helper 子进程启停推断 sandbox child 已启动。
- [x] 4.3 将 backend typed result 映射到现有 tool ledger/checkpoint；确定的 completion/denial 保留对应 effect status，timeout/cleanup unknown 停止当前 task 并落入不可自动恢复的 `command_outcome_unknown`。Fake runner 与持久恢复 fixture 验证未知结果不继续模型轮次、不重放命令或从 ready checkpoint 恢复。
- [x] 4.4 区分桌面可用性、backend/profile/持久 setup 状态与命令能力；只在 setup state 可由本地幂等 profile reconcile 修复时显示“完成或修复隔离设置”。启动只做只读检查；用户点击该动作后 Electron main 持久化 repair state、调用 helper、核验 profile evidence 并提交 ready，不再弹出旧 WFP 方案遗留的 UAC 确认框。unsupported OS、诊断存储故障、helper 缺失和 backend implementation failure 时不显示 setup action。Capability-report targeted tests 6/6，runner Node targeted suite、TypeScript 与受影响文件 lint/format 通过；Windows package startup/tray + 当前 setup 状态文案 smoke 通过。

## 5. 集成与交付门

- [x] 5.1 对 native crate 和 Electron adapter 执行可用的 targeted checks、`source:check`、OpenSpec strict validation 与包资源清单检查，并记录未能在当前主机验证的 OS 行为。
  - [x] Native tests/release check、Electron targeted tests、TypeScript、受影响文件 lint/format、`source:check`、strict validation 与 diff check 均通过。
  - [x] 检查并验证 `forge.config.mts`：构建时编译 Windows x64 native runner，资源目录只含 helper 和版本化 manifest；package smoke 核对 protocol/backend/version 与 executable SHA-256，拒绝 SRT 或重复 helper 资源。
  - [x] 记录目标机 AppContainer ACL/hard-link enforcement、child/job lifecycle、托盘后台运行和安装更新仍需用户最终验收；本阶段没有真实 OS mutation。
- [x] 5.2 通过 gate fixture 验证 helper/resource 缺失、backend version 不符、Windows build/architecture 不支持、durable/live setup 未就绪与 diagnostics sink failure 都不能开放 Windows command gate；diagnostics sink 运行中写入失败会关闭 main-process 共享 gate，阻止后续命令。没有执行受限命令或安装系统 identity/WFP。
- [x] 5.3 以当前 readiness activation 与 setup UI 构建 Squirrel x64 package；`npm run smoke:package` 通过 packaged renderer startup、诊断窗口文案、托盘 close-to-hide/restore/shutdown；runner manifest protocol v8 的 SHA-256 与包内 helper 一致，Squirrel `RELEASES` SHA-1 与 nupkg 匹配。未将候选安装覆盖用户当前 `%APPDATA%\Noema`。

## Workflow follow-up

- 目标机器通过实际 OS enforcement 验收前，Windows 命令 gate 保持关闭；D4 负责统一打包与资源就绪契约。
- 按项目 OpenSpec 工作流归档前，核对归档 spec 与 `docs/NOEMA_V1_PLAN.md`、`.work/planning/PROGRESS.md` 的阶段状态一致。
- 3.4 live target-machine gates are complete; the remaining active D4 work is rebuild/package smoke on the activated source and release/lifecycle verification. Do not install over the user's current application data as part of package smoke.




