# ADR 0033：项目命令的工作区沙箱与按次越界授权

- 状态：执行与按次授权流程已接通；隔离边界未达到权限合同，成熟度验收未完成
- 日期：2026-10-24；成熟度复核：2026-10-25
- 用户确认：所选工作区默认可写；工作区外文件和网络默认受限；越界权限按具体命令临时申请。2026-10-26 补充确认：Windows 10 暂不执行项目命令，直到严格边界有可验证后端。

## 决定

项目命令通过操作系统级沙箱执行。工作区是默认读写范围，执行工具目录只读；批准的外部路径和网络目的地仅加入当前命令的权限。拒绝审批、取消、后端缺失、初始化失败或权限回收失败时，不能退回当前桌面用户身份运行。

Electron 主进程复用 `@anthropic-ai/sandbox-runtime@0.0.81` 的运行器，Windows x64 使用基于上游 `v0.0.81`、回移 PR #661 祖先目录属性读取修复的 helper。helper 来源、补丁范围、构建方式和哈希见 `apps/desktop/vendor/srt-win/README.md`。此适配层隔离 Noema 的审批和执行生命周期，不自行重写 NTFS ACL 或 WFP 执行机制。未打包的架构失败关闭。

Noema 的权限合同仍是“所选工作区可写，其他路径默认不可写，越界需本次授权”。SRT 0.0.81 的 Windows token 会继承 `Everyone`、`Authenticated Users` 与 `BUILTIN\\Users` 的 host 权限，因此仅依赖用户 ACL 无法收窄到工作区边界。helper 安装时检查固定系统临时目录和已挂载本地卷根，对存在广泛写入 ACE 的对象添加仅针对 `srt-sandbox` SID 的继承拒绝规则。Noema 每条命令初始化前运行 `ambient ensure`：普通进程只核对可读取的卷根；新挂载或 ACL 漂移时才触发提权修复。Windows 会拒绝普通进程读取部分受保护系统目录的 ACL，因此这些固定目录由安装流程维护，不纳入逐命令复核。明确授权的更深层工作区规则仍可使用，卸载时仅移除 helper 自己的 SID ACE。

2026-10-26 用户选择保留严格边界，并暂时关闭 Windows 10 命令执行。当前 Windows 执行入口在权限提示、SRT 加载和命令启动前失败关闭。MXC ProcessContainer（Windows 11 24H2+）的 proxy-only 方案要求 `egress.default: deny` 与 `ingress.default: allow`；无身份代理还要开放双向 host-loopback。MXC 文档明确这会开放私有网络服务能力，身份less 配置只适合开发/调试。更严格的 MXC 方案通过 `allowedProxyPeer` 绑定代理包或 AppContainer profile 身份，并保持 host-loopback deny；Noema 当前的 SRT 代理没有可供 MXC 绑定的应用身份。2026-10-26 添加后又移除了 MXC identityless proxy spike：它在所有 Windows 版本上都无法运行，增加 SDK/原生二进制及打包依赖却没有严格边界，因此不保留为死分支。确切代码证据见 [MXC ProcessContainer networking contract](https://github.com/microsoft/mxc/blob/05a430bc17a3e1b3fa2131524fc52e4319e07298/docs/backends/process-container/networking.md)。

Codex 的 Windows 网络代理源码给出两个不可拆开的实现条件：Managed proxy 用 Windows restricted SID 将 sandbox token 的连接路由到独立代理实例；Windows 离线沙箱另用专用本地账号 SID 安装按用户作用域的入/出站规则，并以代理端口范围收窄 loopback。单拷防火墙规则或只开放端口不会复现其边界；Noema 尚未实现/验证对应的 sandbox token 身份与连接归因。源码参照：[Codex Windows proxy ingress](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/network-proxy/src/windows_proxy_ingress.rs)、[TCP identity attribution](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/network-proxy/src/windows_tcp_attribution.rs)、[sandbox firewall provisioning](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/windows-sandbox-rs/src/setup_provisioning/firewall.rs)。

边界证据：Windows x64 实际 runner 在 `D:` 工作区下可写，按次批准的 D 盘读取/写入可用，未授权跨盘写入被卷根 deny 拒绝；C、D 两根都登记了规则。已确认受保护 ACL 且自行授予宽泛写入的更深层子树可绕过卷根拒绝规则；此用例是失败证据，不得计入通过。不能声称所有工作区外路径均已可靠拒绝。对照上游文档和 Codex `windows-sandbox-rs/src/token.rs`，两者的传统 restricted-token 方案都把 `Everyone` 放入 restricting SID；SRT 文档也明确记录 Everyone-writable 路径仍可写。这不是 Noema 审批回调缺陷，而是该 token/host DACL 组合无法单独表达当前更窄合同。

试过缩窄 helper 的 restricting SID，以及把普通 token 中的 Everyone 设为 deny-only。前者使 SRT 的 WFP 子进程检查在 `CreateProcessWithLogonW` 处拒绝启动，后者的 WFP 验证在 30 秒后超时；均无可运行闭环，未回移到正式 helper。Windows 11 MXC 后端不适用于本机 Windows 10 Pro 22H2。现有 `.scratch-appcontainer/PackageWfpFilterProbe.cs` 已在真实 Windows 10 AppContainer 子进程上读取 `TokenIsAppContainer=1` 与 package SID，并通过动态 `ALE_PACKAGE_ID` WFP filter 验证：普通连接被阻断、代理 loopback 保持可用、filter session 关闭后外连恢复；这证明了 Win10 的身份与网络原语可用，但还没有把它接入 Noema 的 Node/命令进程与按次审批。该探针不覆盖文件系统授权。另一个临时 workspace ACL 探针对已有硬链接传播 package SID ACE，会改变同一底层文件的安全描述符，因此 AppContainer 不能只靠把当前 SRT ACL grant 原样搬过去解决硬链接逃逸。

## 验收证据

- Noema 实际 runner 在独立临时工作区内成功执行命令；每次初始化前的 `ambient ensure` 快速路径返回完成且无需提权。
- 最新正式 helper 的 Windows x64 E2E 执行了 22 项具名断言，22 项通过（100%）。含 D 盘工作区写入、未经授权的跨盘哨兵拒绝、获批跨盘读取/写入、范围受限的外部读取/写入。预置 hardlink 在 ACL grant 前被拒绝；沙箱创建跨边界 hardlink 的场景未能改写外部哨兵。其他通过项覆盖普通工作区外写入拒绝、ADS、两层 junction 与 workspace junction alias、UNC 预拒绝、真实 HTTPS 单次批准/拒绝/撤销、直连公网 OS 拒绝、超时后无迟到写入、后续命令恢复及授权回收。helper 安装状态确认 C、D 根规则均存在，运行后持久授权为 `none`。正式 helper SHA-256 为 `E3B878903A16FB82C03F6C9F85AC8B85D1C0606AD97243217AD37E4C4386695A`。
- 已移除的 MXC adapter spike 单测 17/17 仅曾验证参数转换、清理和失败关闭，不是 Windows OS 边界或产品成熟度证据。保留的 SRT helper 单测 193/193、持久授权集成 2/2、安全描述符矩阵 5/5，以及执行器提交 `46cb93c` 的桌面 275 项、typecheck 与 x64 打包记录仍为既有实现证据。自动化 mock 不代替 Windows OS 边界实测。

## 成熟度对照

- SRT 固定版本的 [Windows 集成测试 `winsrt.test.ts`](https://github.com/anthropics/sandbox-runtime/blob/v0.0.81/test/sandbox/winsrt.test.ts) 覆盖真实 sandbox 账户、WFP、子进程身份、输出传输、网络和持久 ACL 生命周期；Noema 复用该底层，但仍需验证自己的授权编排和命令生命周期。
- Codex 的 [Windows sandbox smoke harness](https://github.com/openai/codex/blob/main/codex-rs/windows-sandbox-rs/sandbox_smoketests.py) 有 58 个场景标签，包含 workspace/TEMP、junction 与 symlink、ADS、设备/管道、受保护目录、网络、超时清理等；其中包含宿主可选/跳过场景及一个明确标为 known fail 的用例，不能把标签数当作全通过数。Codex traditional restricted-token [token implementation](https://github.com/openai/codex/blob/main/codex-rs/windows-sandbox-rs/src/token.rs) 也包含 `Everyone`；其 [Windows backend contract](https://github.com/openai/codex/blob/main/codex-rs/core/README.md) 将精确拆分文件系统能力交给 elevated backend，新的 MXC 后端不是本机 Windows 10 可用选项。Noema 当前 runner 的 22/22 证明修复了本机的跨盘写入缺口，但不等同于其余对抗性验收已完成。
- 当前仍有已知安全缺口：SRT Windows WFP 诊断曾发现匿名令牌可能绕过仅按用户 SID 匹配的出站限制。AppContainer package SID 探针未接入实际命令启动器。因此目前只能确认常规 runner 的工作区和按次授权路径，不足以宣称抵御主动令牌模拟或达到成熟对抗性沙箱标准。
- 尚未覆盖的高价值回归包括：真实 lowbox 命令进程和代理闭环、符号链接、硬链接/ADS/设备接口、竞态替换、匿名/低完整性令牌下的直接网络、实际 UI 审批全链路、应用启动/ACL 初始化卡死时的有界恢复。UNC 已验证为启动前拒绝；跨盘已验证但默认拒绝失败。成熟度结论应在这些边界被明确划分为“不支持并失败关闭”或被可靠覆盖后再更新。

## 可量化验收账本

成熟度按固定的 19 个验收族追踪；每族必须有可重复的 Noema 真实 runner 验收，或有明确的失败关闭验证；确认行为违反权限合同的用例记为已知缺口，不计入通过。该比例只表示通过族覆盖率，不代表安全概率、产品完成度或成熟度评分。成熟门槛是 19/19 通过，且不存在已知 residual；声明不支持的能力也必须验证为失败关闭。

| ID | 验收族 | 当前状态 | 证据/缺口 |
| --- | --- | --- | --- |
| SBX-01 | 工作区内写入可用 | 通过 | `e2e:sandbox` |
| SBX-02 | 未授权工作区外写入被拒绝 | 已知逃逸 | 真实 runner 从 C 盘工作区改写 D 盘受保护子树中的哨兵；该子树 ACL 显式授予 Everyone:F 并关闭继承。卷根 deny 无法保护它。 |
| SBX-03 | junction 越界写入被拒绝 | 通过 | `e2e:sandbox` |
| SBX-04 | 按次批准的外部读取生效 | 通过 | `e2e:sandbox` |
| SBX-05 | 按次批准的外部写入生效 | 通过 | `e2e:sandbox` |
| SBX-06 | 未批准的域名在代理转发前被拒绝 | 通过 | Node/OpenSSL `--use-env-proxy` 的真实 HTTPS 请求；批准回调拒绝，命令捕获代理错误 |
| SBX-07 | 超时终止子进程，且不能在可写工作区迟到写入 | 通过 | `e2e:sandbox` |
| SBX-08 | 超时清理后下一条命令可运行 | 通过 | `e2e:sandbox` |
| SBX-09 | 命令结束后无持久文件授权残留 | 通过 | `e2e:sandbox` |
| SBX-10 | 批准域名仅在本命令内可连接，结束后撤销 | 通过 | 同一真实 runner：批准 `example.com:443` 返回 HTTPS 200，下一命令拒绝同一 host |
| SBX-11 | 绕过代理的直接 TCP 外连被阻断 | 通过 | Node `--no-use-env-proxy` 直连真实公网域名返回 `EACCES`，且没有触发网络审批回调 |
| SBX-12 | 匿名模拟令牌不能直接外连 | 已知 residual | 本地探针发现 WFP package/user SID 边界差异；未测真实公网，不能记为通过 |
| SBX-13 | 低完整性/deny-only 身份的外连边界 | 部分 | SRT 独立验证有证据；仍需 Noema runner 回归 |
| SBX-14 | UNC 与跨盘路径按策略拒绝或精确授权 | 通过 | UNC 在 launch 前拒绝；D 盘工作区、获批跨盘读写成功，未授权写入由安装期卷根规则拒绝 |
| SBX-15 | 深层 reparse、symlink 与 junction 变体不越权 | 部分 | simple/nested junction 越界拒绝、workspace junction alias 通过；Windows symlink 尚未测 |
| SBX-16 | hardlink、ADS、设备与命名管道边界 | 部分 | ADS 写入被拒绝；命令启动前拒绝写根中已有 hardlink，真实 runner 未能把硬链接改写外部文件；设备与命名管道未测 |
| SBX-17 | 路径替换竞态不能扩大权限 | 未验证 | 需并发替换实测 |
| SBX-18 | UI 批准、拒绝、取消与授权回收完整闭环 | 未验证 | 当前为 runner 检查，非 UI 端到端 |
| SBX-19 | 初始化/ACL 卡死有界退出、清理并可恢复 | 未验证 | Noema 尚无初始化阶段 deadline 验收 |

**当前进度：11/19 验收族通过（57.9%）；3 部分、2 个已知缺口、3 未验证。基线真实 runner 为 22/22；新增受保护子树对抗用例为 0/1，已确认卷根 deny 可被子树自定义 DACL 绕过。预置 hardlink 在 ACL grant 前被拒绝，runner 创建跨边界 hardlink 的场景也未能改写外部哨兵。成熟度门槛：19/19 通过且 residual 为 0。验收族与 runner 断言统计不同层面的证据，不互相替代。helper 单测 193/193、持久授权集成 2/2、安全描述符矩阵 5/5 是实现回归证据，不额外计入产品验收分子；移除的 adapter mocks 不计入当前代码或成熟度。

## 已知限制与重审条件

- SRT 的 Windows WFP 验证曾报告 `anonymous-loopback`、`deny-only-user-sid` residual；测试发现匿名模拟身份可能绕过仅按用户 SID 匹配的出站规则。AppContainer package SID + 动态 WFP 的本机探针能阻断该路径，但尚未接入生产启动器。因此当前验证支持正常项目命令的工作区/按次授权行为，不足以宣称可抵御恶意代码主动模拟令牌或构成完整网络隔离。
- 当前只在 Windows 10 Pro 22H2 x64 实机验证；Windows ARM64 明确失败关闭。Windows 11 MXC 与本机 Docker 均不是此环境下已验证的替代后端。后续优先验证可复用的身份绑定代理路径（Codex restricted SID 路由或 MXC AppContainer peer），而非再次引入 identityless proxy；代码与运行环境可证明该边界前，Windows 命令继续失败关闭。若产品要求强对抗恶意代码，须在重新评估执行后端并验证子进程、网络与取消回收后，才扩大安全承诺。
- SRT 上游将 Windows 实现标为 alpha。若后续 SRT 更新改变 ACL/WFP/helper 协议，必须重新验证授权生命周期；不能仅以包升级或 helper 安装成功视为验收。

本 ADR 记录产品权限边界和实现取舍，不把已知后端限制包装为安全保证。当前实现可用于常规项目命令授权流程，但不能标为成熟、强隔离完成。后续优先复用经过验证的系统执行后端；若保留 SRT，先处理真实 runner 的 WFP residual 和上述逃逸面，而不是继续增加底层实验。最新进展以 Issue #112 为准。
