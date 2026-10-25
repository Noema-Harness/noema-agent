# ADR 0033：项目命令的工作区沙箱与按次越界授权

- 状态：功能闭环已实现；成熟度验收未完成，Windows 网络边界仍有已知缺口
- 日期：2026-10-24；成熟度复核：2026-10-25
- 用户确认：所选工作区默认可写；工作区外文件和网络默认受限；越界权限按具体命令临时申请。

## 决定

项目命令通过操作系统级沙箱执行。工作区是默认读写范围，执行工具目录只读；批准的外部路径和网络目的地仅加入当前命令的权限。拒绝审批、取消、后端缺失、初始化失败或权限回收失败时，不能退回当前桌面用户身份运行。

Electron 主进程复用 `@anthropic-ai/sandbox-runtime@0.0.81` 的运行器，Windows x64 使用基于上游 `v0.0.81`、回移 PR #661 祖先目录属性读取修复的 helper。helper 来源、补丁范围、构建方式和哈希见 `apps/desktop/vendor/srt-win/README.md`。此适配层隔离 Noema 的审批和执行生命周期，不自行重写 NTFS ACL 或 WFP 执行机制。未打包的架构失败关闭。

## 验收证据

- Noema 实际 runner 在独立临时工作区内成功执行命令。
- 同一 runner 对工作区外未授权写入返回拒绝，目标文件未创建；获批外部读取成功；获批外部写入成功且内容复核一致。
- `npm run e2e:sandbox --workspace noema-desktop` 新增并实跑 9 项 Windows x64 实机检查：工作区写入、外部默认拒绝、junction 越界拒绝、获批外部读写、网络拒绝回调、超时后无迟到子进程写入、后续命令恢复、授权无残留。SRT 状态确认没有持久写授权根。
- 沙箱适配器单测 15/15、lint、`git diff --check` 通过；执行器提交 `46cb93c` 另记录桌面全量 275 项、typecheck 与 x64 打包通过。自动化 mock 不代替 Windows OS 边界实测。

## 成熟度对照

- SRT 固定版本的 [Windows 集成测试 `winsrt.test.ts`](https://github.com/anthropics/sandbox-runtime/blob/v0.0.81/test/sandbox/winsrt.test.ts) 覆盖真实 sandbox 账户、WFP、子进程身份、输出传输、网络和持久 ACL 生命周期；Noema 复用该底层，但仍需验证自己的授权编排和命令生命周期。
- Codex 的 [Windows sandbox smoke harness](https://github.com/openai/codex/blob/main/codex-rs/windows-sandbox-rs/sandbox_smoketests.py) 有 58 个场景标签，包含 workspace/TEMP、junction 与 symlink、ADS、设备/管道、受保护目录、网络、超时清理等；其中包含宿主可选/跳过场景及一个明确标为 known fail 的用例，不能把标签数当作全通过数。Noema 的 9 项是针对自身应用契约的窄子集，并不等同于这套防逃逸回归覆盖。
- 当前仍有已知安全缺口：SRT Windows WFP 诊断曾发现匿名令牌可能绕过仅按用户 SID 匹配的出站限制。AppContainer package SID 探针未接入实际命令启动器。因此目前只能确认常规 runner 的工作区和按次授权路径，不足以宣称抵御主动令牌模拟或达到成熟对抗性沙箱标准。
- 尚未覆盖的高价值回归包括：UNC/跨盘与深层 reparse/junction 变体、硬链接/ADS/设备接口、竞态替换、匿名/低完整性令牌下的直接网络、实际 UI 审批全链路、应用启动/ACL 初始化卡死时的有界恢复。成熟度结论应在这些边界被明确划分为“不支持并失败关闭”或被可靠覆盖后再更新。

## 已知限制与重审条件

- SRT 的 Windows WFP 验证曾报告 `anonymous-loopback`、`deny-only-user-sid` residual；测试发现匿名模拟身份可能绕过仅按用户 SID 匹配的出站规则。AppContainer package SID + 动态 WFP 的本机探针能阻断该路径，但尚未接入生产启动器。因此当前验证支持正常项目命令的工作区/按次授权行为，不足以宣称可抵御恶意代码主动模拟令牌或构成完整网络隔离。
- 当前只在 Windows 10 Pro 22H2 x64 实机验证；Windows ARM64 明确失败关闭。Windows 11 MXC 和本机 Docker 均不是此环境下已验证的替代后端。若产品要求强对抗恶意代码，须在重新评估执行后端并验证子进程、网络与取消回收后，才扩大安全承诺。
- SRT 上游将 Windows 实现标为 alpha。若后续 SRT 更新改变 ACL/WFP/helper 协议，必须重新验证授权生命周期；不能仅以包升级或 helper 安装成功视为验收。

本 ADR 记录产品权限边界和实现取舍，不把已知后端限制包装为安全保证。当前实现可用于常规项目命令授权流程，但不能标为成熟、强隔离完成。后续优先复用经过验证的系统执行后端；若保留 SRT，先处理真实 runner 的 WFP residual 和上述逃逸面，而不是继续增加底层实验。最新进展以 Issue #112 为准。
