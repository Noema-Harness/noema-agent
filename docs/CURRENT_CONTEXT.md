# 当前确认

本页记录 2026-11-02 本轮用户明确的要求，以及依用户授权的无回复默认规则收敛的暂行边界；两类内容分开标注。本页不是完整路线、目标架构或开发任务表。

## 本轮要求

- 旧的产品定位、规划、流程设想、过时说明与无用材料已经清理。用户正式授权的规划主线已完成：按 `.work/planning/PLANNING_CONTRACT.md` 研究外部参考、形成 Noema 对照和细致阶段计划；用户随后已正式授权进入一期开发。开发长期目标、当前工作项与唯一下一项见 `.work/planning/PROGRESS.md`。
- 重新构思规划必须严谨，不沿用旧定位、旧任务顺序或旧结构逻辑代替重新判断。
- 一期先供用户在现有 Windows 电脑上日常使用。用户最初提出 2026-11-03 12:00（北京时间）开始使用；该时间后按本页“规划默认项”所述授权默认正式撤销，不再是硬性日期。
- 本机命令执行属于一期必要能力。应用必须支持后台进程，关闭窗口不能直接中断正在执行的任务。
- 核心使用闭环充分验证后交付，其他未成熟入口可以暂时隐藏。
- 真实模型验证预算不设上限；调用前先完成成本优化前置工作，重点是提高缓存命中率、减少整体 token 消耗。沿用用户此前提供的配置，不在工作材料中复制 API key。
- 工程能力由用户自主使用 Noema 开发进行最终验收。助手负责可有效执行的检查、源码对照和模块完整性审查，不反复长测自己无法证明的结论；模块标准同时核对参考实现的职责、状态、失败路径与生命周期。
- 用户进一步明确：一期既然要求任务在后台持续运行，工作区开发能力就必须完整形成可用闭环，不能只做好后台任务基础设施。按真实开发任务贯通理解代码、制定/调整方案、编辑、授权执行、检查结果、审阅变更、失败恢复与诊断；复杂社交房间等与开发闭环无关的扩展仍单独评估。
- 调试系统是贯彻整个应用的基础设施。所有功能模块在规划时都要考虑相应的调试入口，覆盖状态、执行链路、故障与恢复；成本追踪只是其中一项用途。成本优化不强求本轮证明实际收益，但应在工程理论和请求构造上尽可能做好，并为后续追踪提供依据。
- 后续学习系统由 Noema 在自身内部搭建，用于检验其工程能力；学习系统的完成不等于本体完成，也不属于上述本体上线时间目标。
- Pi、DeepSeek Super Agent、DSH、Goose、OpenHands Software Agent SDK、Letta Code 是当前本地研究起点，不是封闭名单；过程中可基于源码证据自主取舍或引入更适合的参考。研究先从参考项目的实际模块和丰富度建立领域认识，再对照 Noema；不能用 Noema 自身已有目录或助手经验限制能力广度。
- 架构选择维持当前主体组织，不做 DSH 式全应用插件化重构；领域扩展的插件边界在研究后具体化，认可参考设计不等于整套迁入。
- 规划前先逐一深拆参考源码，明确独立模块、边界和契约。有充足把握后，再形成包含阶段及阶段内工作内容的细致规划，让每项工作完成后的下一项明确，支持长期自主推进。“广积粮，高筑墙，缓称王”是本轮研究与规划的原则。
- 一期权威范围与阶段验收计划见 [NOEMA_V1_PLAN.md](NOEMA_V1_PLAN.md)。规划阶段的研究标准、阶段门、工作项颗粒度和上下文恢复规则，以 `.work/planning/PLANNING_CONTRACT.md` 为准；唯一下一项及阶段进展见 `.work/planning/PROGRESS.md`。
- 推进中遇到必要设计选择，助手应提出问题和推荐；给用户合理回复时间后，如未回复，按推荐继续。
- 现有严格执行隔离要求继续有效。用户已确认 Windows 10 22H2 + 当前 ESU 安全更新为一期唯一 Windows 命令隔离基线；不要求 Windows 11，也不按不同 Windows release 维护实现分支。目标机为 Windows 10 专业版 22H2/build 19045、UBR 6093。源码把 19045.7807 设为 Noema command runner 的安全放行线；这不是 Windows API 最低版本，也不限制 Noema 桌面程序启动、日常交互或安装验收。微软文档标明 AppContainer 与 WFP package-ID 过滤条件自 Windows 8 起支持；目前没有证据表明 UBR 6093 缺少这些 API，也没有记录将 7807 对应到特定隔离漏洞。command runner 低于这条经用户确认的 ESU 安全基线时继续 fail closed。D1 原 Codex restricted-token 方案因 hard-link 边界冲突而调整为 Noema 自有普通 AppContainer runner；Sandy 仅作启动原语参考，Codex 继续作 handle ACL/path、Job 与诊断参考，不直接依赖其 crate。普通 WFP setup 失败必须 fail closed；依赖闭包、SBOM/许可、打包与目标机 enforcement 仍须核验。不回退 SRT/宿主 shell，也不默认要求 VM。
- 用户已明确确认：每个读或写授权根内如发现普通文件 NTFS hard link 数量大于 1，本次受限命令必须拒绝，并向用户说明需要处理该链接；不能因可能影响项目可用性而绕过。
- 用户已确认 hard link 扫描的并发威胁边界：一期把同一 Windows 用户下的宿主进程视为可信，重点防止 Noema agent 越界；所有 capability roots 均扫描，并与 ACL 授权连续执行，任何扫描或 ACL 错误都 fail closed。不为全树扫描持有排他文件锁，以免被 IDE、杀毒或索引器常态阻断。该边界不声称防御同一用户下的恶意宿主进程。
- D3 源码审查发现原 restricted-token + 独立 sandbox account 路径无法同时满足已确认的 all-root hard-link 拒绝和 System32 `cmd.exe` bootstrap；另有独立账号访问 workspace 的首轮 ACL 检查缺少证据。当前实现采用普通 AppContainer：命令子进程保持当前 Windows 用户身份，并经固定 package SID 和逐请求 filesystem capability SID 限权；不增加 Noema 登录账号或独立 sandbox Windows account。读取与写入授权根都做 hard-link/reparse/bounds/query fail-closed 扫描；write roots 是 read roots 子集。AppContainer profile setup、capability ACL mapping、直接 `CreateProcessW` child path，以及 WFP network-deny 的事务安装、逐项读回、缺项修复和一次性固定 elevated worker 已接通；setup evidence 升为 v3，旧 profile-only ready 状态会重置。普通 `probe` 可报告实际 profile/WFP 状态，但 command readiness 仍被实现未完成与 capability gate 关闭。验证：native 81/81、release check、setup/helper/state Node 34/34。开发验证没有弹 UAC、创建 profile、修改 ACL/WFP 或运行真实命令；Windows 网络阻断效果、UAC 体验、ACL enforcement 和完整 Job/process-tree 生命周期仍需目标机验收。详细证据见 `.work/planning/research/noema/D3_RESTRICTED_TOKEN_BOOTSTRAP_REVIEW.md` 和 OpenSpec change。

## 规划默认项（2026-11-02）

以下默认项曾以具体选项和推荐向用户询问，并依用户授权的无回复规则收敛；用户后续回复已修订开发闭环范围和 Windows 支持门槛，按上文最新要求执行：

- 一期以用户能用 Noema 完整开发选定工作区的闭环为主：理解代码、计划与修订方案、编辑、受控命令、核验结果、审阅变更、可见任务状态、后台持续运行、失败恢复和诊断。一般对话可作为交互入口；复杂房间/协作、多成员、specialist delegation 等与开发闭环无直接关系的现有路径不自动作为一期交付条件，可按成熟度隐藏或延后。这是一期范围建议，不定义 Noema 的终极产品定位。
- 一期 workspace work 默认以当前 SocialChatApp → SocialChatService → SocialWorkService/NoemaProjectExecutor 路径作为执行 owner；RootAgent + DSH 的 legacy 路径不自动属于核心交付，也不为此合并或重构两套 harness。若规划证明某项当前必要能力只在 legacy 路径可用，再单独评估。
- 2026-11-03 12:00 不作为硬性正式可用日期。该目标与当前已知缺口和尚未完成的规划不相符；Gate E 完成、实现和用户验收范围明确后重新评估可行时间。此处不预设新的交付日期。
- 最终 Windows 选择为单一 Windows 10 22H2 + 当前 ESU 安全更新基线，不为不同 Windows release 维护 runner 分支，也不默认要求 Win11/VM。ESU UBR floor 只控制严格命令 backend 的安全放行；不会限制 Noema 桌面程序启动、交互或 F1 安装生命周期。当前 19045.6093 仍不能开放命令，直至该安全基线被满足或经新的证据审查修订；不以 UI 可运行替代 command isolation 验收。

## 使用现有资产

保留的源码、测试和现有行为规格用于辨认当前事实、回归和可复用资产，不自动成为一期范围或目标结构。旧产品文案和历史任务顺序均不再作为当前要求。

已有聊天存储文件含未提交的分页草稿，本轮未修改该源码。其未完成规划材料已移除；不能把草稿当成交付功能。

## 2026-11-03 开发续接

- 用户接受首次 Windows WFP 配置进行一次 UAC 确认；普通命令之后不提权，取消或设置失败必须不可用。应用启动不得自动触发 `reconcile()` / UAC。
- 用户再次确认每个读取/写入授权根都要扫描 NTFS hard link；命中或检查失败即拒绝。已确认扫描边界：同一 Windows 用户的宿主进程视为可信，扫描与 ACL 连续执行，错误 fail closed。
- D3 4.1 已将 Windows native helper、durable setup state、ACL journal/transaction、capability-name store 和 execution admission service 接入 Electron main。helper 只从固定开发/打包路径解析，启动只做 backend probe 与 setup verify；渲染进程不能指定 helper 或报告能力。任何资源/探测错误均拒绝命令，不回退 SRT/宿主 shell。
- native probe 对真实 Windows 隔离仍报告未完成，因此 Windows `commandSupport` 保持关闭。D4 已完成 helper 的固定资源解析、Windows 包 manifest、主进程能力状态、运行诊断卡片和用户主动 setup/重试入口；启动只做只读 probe/verify，不自动弹 UAC 或执行 `reconcile()`。Windows 包缺失或身份不符会 fail closed，不回退 SRT 或宿主 shell。
- D3 4.2/4.3 已完成：native helper protocol v6 严格回报 child 是否 resume、typed exit/timeout、输出采集和 cleanup-confirmed/unknown；diagnostics 按 request/execution/task/tool-call identity 记录安全阶段与有限数值，不写命令、路径、环境或输出正文。timeout/cleanup unknown 会立即停止 NoemaProjectExecutor 模型轮次，并形成不可自动恢复的 `command_outcome_unknown`，避免继续执行或重放。
- 最新 D4 验证：runner/IPC/diagnostics/fail-closed 定向测试 45/45，renderer diagnostics 3/3；TypeScript、改动文件 oxlint/oxfmt、`source:check`、OpenSpec strict、`git diff --check`通过。Windows x64 Forge package 与 `smoke:package` 通过，确认打包 renderer、runner identity、诊断能力卡和托盘隐藏/恢复/退出。Squirrel 安装包首次构建因本机依赖的 7-Zip postinstall 未执行而失败；重建 `electron-winstaller` 后 make 成功，生成 `apps/desktop/out/make/squirrel.windows/x64/Noema-0.1.0 Setup.exe` 与 full `.nupkg`。目标机为 Windows 10 Pro 22H2/build 19045/UBR 6093，command runner 的 ESU 安全放行线为 UBR 7807；该差异仅关闭受限命令，桌面安装/升级与数据保全验证可独立进行。D4 源码/打包门通过；F1 用户安装与数据保全仍未验收，D3 OS 隔离验收仍未完成。此前项目评审集成测试与另外四项失败已在 2026-11-03 查明并修复，见本页末尾记录。
- E1 工作区身份绑定已完成源码实现：项目绑定与任务快照分别由 SocialProjectStore/SocialChatStore 持有；选择目录时捕获规范路径与设备/文件身份；项目目录变化需主进程二次确认并通过 CAS 更新，取消、活动任务或过期确认都不改变状态；恢复任务前重捕获并比对身份，旧任务或目录缺失/替换时在任何 checkpoint 写入前拒绝；诊断仅存版本与有限原因码，不泄漏文件身份或路径。新增迁移为 nullable，不回填旧记录。E1 的 Windows native handle identity 仍需在达到 ESU 基线后的目标机确认，Windows command 继续关闭。当前按计划进入 E2 文件工具及变更结果核验。
- E1 验证：SocialWorkService 30/30、SocialProjectStore 14/14、目录身份与任务呈现 8/8、diagnostics 7/7、SocialChatStore 35/35、migration-backup 6/6、TypeScript、source:check、改动文件 oxlint/oxfmt、OpenSpec strict 与 `git diff --check`通过。修正了一个过期存储测试：它删除迁移记录 27，却保留版本 32；升级器按 MAX(version) 判断，因此原 fixture 从未实际回到 v26。测试现改为验证当前 schema 对旧 gateway runtime 记录的保留和新 provider turn 行为，不再错误声称迁移测试。该阶段发现的全量桌面测试失败于后续 2026-11-03 逐项定位并修复，见本页末尾记录。
- E2 文件变更审阅已完成源码实现：v33 增量数据库 journal 为每项 task/path 保留首次原内容与 hash、持久化写前意图、最新 postimage、有限 diff 和恢复状态；写入前 journal 不可用、基线变化、配额/路径/扫描门失败即不写。重启只按精确 preimage/postimage hash 对 pending state 分类，第三种状态保留冲突，不自动覆盖。终态任务可经可信 main-process opaque ID API 审阅、保留或 compare-before-restore；renderer 不提交目标路径。恢复前再次验证 workspace identity 与边界；已存在文件用同目录临时文件原子替换，新建文件仅在 hash 仍相等时删除。当前 Git status/diff 独立只读呈现，不 staging/commit/reset/clean；关闭 external diff/textconv/config hooks，限制进程、时间、条数和输出，且明确可能含任务前已有改动。
- 用户明确确认 E2 写入模式：工作区任务获授权后，成功的 edit/write 立即落盘；任务结束后逐文件审阅，用户可选择保留或撤回。撤回前验证 workspace identity 与文件最新摘要，若之后被用户或其他程序修改则拒绝覆盖。此决定确认了 E2 的交互预期，不替代最终本机验收。
- E2 验证：文件变更 store/diff/Git review/executor/service/IPC/presentation 定向 89/89。全量桌面测试 654 项 649 通过、5 失败；修正新 schema 引入后不足的 v11/v14/v28/v29 历史迁移夹具后，余下 5 项集中于既有 project collaboration/plan/review 行为（`project-collaboration.test.mjs:1681`、`project-plan-chat.test.mjs:9,154,387`、`project-review.test.mjs:374`），不属于 E2 功能路径。TypeScript、source:check、OpenSpec strict 与 `git diff --check`通过；全仓 lint 仍有既有格式漂移，E2 改动文件单独检查通过。后续整体验收前仍需恢复全套测试和 lint 基线。
- E2 边界：Noema journal 仅追踪 executor 归因的 file tools 写入，不声称能归因任意子进程副作用；Git workspace view 是当前快照、不是 Noema task diff；哈希/身份检查按用户确认的 same-user trusted host-process 威胁边界运行，不防恶意本机进程。Windows NTFS hard-link/reparse 拒绝、ACL/restore 操作与 WFP 仍须在 ESU UBR 7807 目标机确认；当前设备仍为 UBR 6093，command capability 关闭，未触发用户已允许的一次 UAC。
- E2 OpenSpec change 已归档为 `2026-11-03-workspace-change-review`，`project-execution` 规格已更新；下一项为 E3 工具计划、模型交互与任务 UI 对齐。
- E3 执行阶段投影源码已完成：任务卡使用持久 `phase` 与当前 running step 区分等待模型、接收模型可见回复、模型请求工具、执行具体工具、等待用户授权、限流等待、核验和终态；旧 `working` 映射为通用 running，未知阶段中性显示。Executor 不向任务卡暴露模型隐藏推理或临时流内容。workspace/network 授权阶段事件只带有限枚举，SocialChatStore 成功持久化后才写入 diagnostics；不记录授权目标、command、路径、host、reason 或凭据。`setSocialWorkTaskSession` 不会把已更新阶段覆盖回 `running`；既有 renderer room-load sequence gate 保证只提交最新查询快照，task event payload 只触发 reload。
- E3 验证：executor/Service/store/presentation 定向 108/108；全桌面 659 项 654 通过、5 失败，仍为已记录的 project collaboration 1、project plan chat 3、project review 1，不在 E3 改动路径。TypeScript、source:check、E3 改动文件 oxlint/oxfmt、OpenSpec strict 与 `git diff --check`通过。全仓 `npm run lint` 仍因 13 个既有文件格式差异失败；另有既存 lint warnings，无 error。OpenSpec 已归档。没有新增 schema migration、provider 请求或真实命令。
- E3 明确限制：界面仅显示 Noema 已观测的请求与生命周期阶段，不展示模型隐藏推理；模型可见响应内容仍在任务完成后作为结果呈现，不宣称 token 级内容已显示。Windows 真实受限命令与 WFP/ACL 仍受 ESU UBR 7807 本机门槛阻断；command capability 关闭，未触发 UAC。下一项按计划进入 E4 失败恢复、停止/续接和部分结果交付。
- 用户接受首次 WFP setup 由一次 Windows UAC 确认；该授权只用于固定参数的 WFP 安装 worker，普通命令不提权。因当前 runner 安全基线仍未满足，且目标机 enforcement 未审验，尚未运行 setup worker、触发 UAC 或改变 ACL/WFP；取消、worker 超时、transaction/readback 失败仍须保持 command capability 关闭。该限制不阻止单独验证桌面安装与数据连续性。
- E4 已完成的源码恢复门包括：仅完整模型边界 checkpoint 可显式续接；resume 前校验原 task、model、session、grant 与 workspace identity；legacy/missing identity、schema/消息不完整、未知命令或文件副作用均阻止续接；未知副作用不会自动重放；安全续接保留原 task 与已确认的 checkpoint/tool ledger，重新执行仍创建新 task，历史结果保留。停止只记录停止/副作用状态，不声称 rollback；进程重启会把活动副作用标为 unknown，并要求用户检查。E4 定向回归包含 process restart 与损坏 checkpoint JSON 模拟，证明损坏状态不能启动执行器且 task 保留失败态。
- E4 结果呈现保护：只有 completed task 的已保存文本标题为“执行结果”；interrupted、failed、active task 的文本分别标为停止前部分内容、未完成任务内容、阶段内容，并提示不代表最终交付。verification/recovery status 仍独立显示，未改 checkpoint/schema，也不因停止发起模型请求。执行链诊断使用稳定 task ID 聚合、独立 resume execution ID 区分每一安全恢复段，记录有限 checkpoint phase 与 recovery code；command/tool/phase/stop/finish 均传递段 ID，诊断不含 checkpoint 或用户内容。malformed checkpoint JSON 在 task 状态变更和 executor admission 前失败。OpenSpec `partial-result-clarity` 和 `resume-attempt-tracing` 均已严格校验并归档，更新 `project-execution` 规格。
- F1 本地 diagnostics 新增 allowlisted runtime manifest：Noema/Electron/Node、系统版本、platform/architecture、packaged 状态，以及 SQLite 中实际 SocialChat/diagnostics migration 最大版本。它在 diagnostics header/timeline/export 中显示，export 仍由用户预览再保存；不含 host 路径或会话内容，不向外自动发送。系统版本字段不等同于 Windows UBR，runner startup readiness 仍为隔离能力的事实来源。另新增 `application.startup_failed` 固定错误类别与 `social.schema.ready` 迁移生命周期事件；不写 raw message/stack/path/SQL/content，诊断写入失败不覆盖原始启动错误。若 root DB 未能打开，仍只有现有启动错误对话框可用。后续补齐 F1 要求的数据库状态和恢复位置：诊断页按用户打开/刷新执行 SQLite quick_check，仅回传 healthy/problem/unavailable；固定主进程 action 打开应用数据目录；启动失败对话框也提供用户主动选择的目录入口。不会自动恢复或修改数据，也不把路径/SQLite 原始错误放进 diagnostics/export。
- F1 已基于最近源码重建 Forge Windows x64 package、跑启动/托盘 smoke 并生成 Squirrel installer；最新 package smoke 确认 renderer、诊断页数据库健康/恢复入口、托盘隐藏/恢复/退出。最新 setup `apps/desktop/out/make/squirrel.windows/x64/Noema-0.1.0 Setup.exe` 为 170,049,024 bytes、`NotSigned`，SHA256 `4D9A3D07B3EA59389C0DEE7E43E54A31C76CE9706CAE9D50A9D3B6EEFA9F9127`；`RELEASES` SHA1 `A115EE0211D71094F21AEF8D603D98D39A6C60DE` 与 full `.nupkg` 一致。未运行该安装器；真实安装/升级/卸载与数据保留尚未验收，可在当前 Windows build 上单独开展。command runner 的 ESU UBR 7807 放行门独立保持 fail closed，当前 UBR 6093。OpenSpec `diagnostics-runtime-manifest`、`startup-failure-diagnostics` 和数据库恢复入口均已归档并更新 `desktop-host-lifecycle`。
- F1 用户数据只读审计：打包正式运行时，数据库、DPAPI/safeStorage 加密的模型与网页搜索凭据、runner setup/ACL state/journal 及日志均以 Electron `userData` 为基准；E2E 的重定向只允许未打包运行。Noema 的 Squirrel lifecycle handler 在初始化数据库前处理 install/update/uninstall/obsolete，只创建或移除快捷方式并退出；源码未发现卸载时删除用户目录的逻辑。SocialChat schema 更新前会先为整个 SQLite 文件创建带完整性/schema 校验的快照，保留已发布备份，失败时拒绝迁移并留存损坏旧快照。定向 runtime path/credential/migration backup 回归 11/11。此为源码与隔离测试结论，不代表真实安装、升级、卸载或 Windows DPAPI 数据连续性已验收；仍需达标系统上的用户数据前后核对。
- F1 检查点曾记录桌面测试 664 项中 659 通过、5 失败，并错误地按“重复出现、与 F1 无关”将其视为可遗留问题。2026-11-03 复核后发现：4 项来自项目工具准入、绑定提示和证据规则缺口，1 项只匹配了已更新的稳定提示词；已通过 `project-tool-admission` 修复/校正。最新 `npm test` 为 671/671 全通过。
- `project-tool-admission` 已归档为 `2026-11-03-project-tool-admission`：主聊的核验、核对、评审意图会提供项目工具；项目绑定 plan schema 隐去 project_id，处理仍固定使用当前项目；两类计划工具说明都要求读取截断工作项并将链接证据视作不可信资料。定向用例 44/44，完整桌面测试 671/671；typecheck、source:check、受影响文件 lint/format、OpenSpec strict（归档前 9/9、归档后 8/8）、workspace:check 与 `git diff --check`通过。
- 2026-11-03 F1 本机安装状态更新：一次尝试在临时 `LOCALAPPDATA` 运行仓库安装生命周期 smoke，但 Squirrel 按 Windows LocalAppData known-folder 安装，忽略该环境变量；脚本误判没有已安装 Noema，并把同版本 0.1.0 候选重装进真实 `%LOCALAPPDATA%\noema_desktop`。发现后已中止，未继续安装 0.1.1、未卸载。当前安装仍显示 0.1.0，installed `packages\noema_desktop-0.1.0-full.nupkg` SHA1 为 `DCC36126B54643011F92351009973F369B0B8078`；实际用户数据库 `%APPDATA%\Noema\noema.sqlite3` 存在且 last-write 仍为 2026-11-01 11:26:24。测试标记与测试数据库在临时目录；当前未发现真实数据库被测试修改。测试期间当前用户 Noema 进程已经退出，未自动重启。隔离测试脚本已修正为读取真实 Windows LocalAppData known-folder，且在环境变量与 known-folder 不一致时先行拒绝；语法、两种拒绝路径检查通过。中断后临时测试目录保留，未做递归清理。当前工作区源码与 package manifest 仍为 0.1.0；重新生成的本地安装候选 Setup SHA256 为 `BAD0C32AEAE406F5311C0B844D846D2BB58D2C379722D80036C7D371890F0AAF`、NotSigned，full `.nupkg` 与 `RELEASES` SHA1 一致；此新候选未再次运行安装器。
