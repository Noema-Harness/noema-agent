# Design

## Context

`main.ts` 已建立 Windows runner readiness 与 fail-closed command gate，但当前状态只在主进程内部；renderer 没有可查询的 runner 报告或设置入口。workspace picker 仍会调用旧 SRT 账户状态与安装流程，Forge 的 `extraResource` 仍打包 `vendor/srt-win`。现有主窗口 IPC 已校验可信主框架；运行诊断已有安全事件存储和可见入口。

## Goals / Non-Goals

**Goals:**

- 让主进程成为 Windows runner 状态、版本、设置动作与命令准入的唯一 owner。
- 将用户主动设置、运行时状态刷新和诊断身份关联接入现有 IPC/诊断体系。
- 让 Windows 安装包明确包含单一 Noema runner，缺失或不符时禁用命令。
- 移除已退休的 SRT Windows 设置提示和替代路径。

**Non-Goals:**

- 不更改 Windows runner 的 OS 隔离策略、ACL/WFP 机制或首次 UAC 权限范围。
- 不在应用启动时自动执行需要提权的设置。
- 不改变 macOS/Linux 命令后端，不以本轮测试代替目标机最终隔离验收。

## Decisions

1. **能力状态由主进程统一维护并经 root IPC 提供。**
   - 由 `WindowsRunnerExecutionService`、setup verification 与固定资源 resolver 汇总成有限的 renderer DTO；包含支持/原因、backend ID、协议/资源版本和设置状态，不含路径、凭据或 ACL 细节。
   - preload 只暴露读取/订阅和明确的 setup action；handler 继续使用 `registerRootIpc` 的可信主框架校验。macOS/Linux 返回 `not_applicable`，不伪装成 Windows runner。
   - renderer 在现有“运行诊断”入口呈现状态；命令执行入口继续由主进程 gate 拦截，禁止 renderer 做文件探测。

2. **首次设置只能由用户操作启动。**
   - 启动阶段继续只读 probe。诊断视图提供“启用/重试 Windows 命令隔离”操作，点击后由主进程调用既有 setup service，并显示 UAC 取消/失败的有限结果。
   - 设置结束后主进程重新 probe，更新共享 command gate 和状态报告，再通知 renderer。没有 ready 报告时命令继续拒绝。

3. **已验证的资源身份贯穿打包、界面和执行。**
   - Forge Windows `extraResource` 只放置 resolver 期望位置的原生 runner。打包步骤检查目标架构、文件数量、协议/版本与资源摘要，并输出可审计 manifest；不把 `vendor/srt-win` 当作 Windows backend 资源。
   - 开发态与打包态共用固定身份契约，但资源位置按既有 resolver 分别确定。主进程只在 manifest 与二进制探测一致时报告 ready。
   - Forge package smoke 检查最终 `resources` 内容，确认只有一个 Noema Windows runner；setup helper/调试构建产物不进入安装包。

4. **能力变化关闭未来准入，运行中的副作用遵循原生命周期。**
   - probe/资源变化时更新唯一共享 gate、发出状态事件并记录安全诊断；新 command 立即拒绝。已经启动的 command 不因 renderer 状态刷新而失去 owner，继续由 helper 的 timeout/cancel/cleanup 契约结束。
   - 所有状态和诊断沿用 application/task/execution identity；诊断仅存 backend/version、变化类别、阶段和有限错误码。

5. **移除旧 SRT Windows setup 流程，不影响其他平台依赖。**
   - workspace picker 删除 `getWindowsSandboxUserStatusAsync`、SRT 安装对话框及 `installWindowsSandboxAsync` 调用，改为读取主进程 runner 状态并导航到受支持的设置入口。
   - 先用引用检查确认 `@anthropic-ai/sandbox-runtime` 仍被非 Windows 后端或其他模块使用；只移除 Windows `srt-win` extraResource 和过时提示，不删除仍被其他平台使用的包。

## Risks / Trade-offs

- [设置对话框期间窗口关闭或 renderer detach] → 设置由主进程持有，结果写入共享状态；重新连接后 renderer 重新读取，不创建第二个设置 owner。
- [构建机缺少 runner 或 runner/manifest 不一致] → Forge Windows packaging 在产物生成前失败；运行期仍由主进程 fail closed。
- [探测并发发生在 command admission 边界] → 在主进程 admission owner 中串行检查版本/ready gate 与新命令登记；已启动 command 由现有 execution service 跟踪。
- [当前安装包仍携带 SRT 资源] → Forge 资源清单与 package smoke 把它列为 Windows runner 包装违规；清理只针对生成目录，不碰用户数据或依赖缓存。

## Migration Plan

1. 增加 IPC/preload/DTO 与主进程状态 owner，保持启动只读。
2. 在诊断 UI 接入状态与用户主动设置动作，并移除 workspace picker 的 SRT 安装代码。
3. 更新 Forge Windows resource 配置、manifest 验证和 package smoke。
4. 执行单元、IPC、类型、lint、source-boundary、OpenSpec 与打包检查；不得在开发验证中运行真实 UAC、ACL/WFP 变更或受限项目命令。
5. 最终目标机验收设置 UAC、安装资源、状态展示与真实隔离；验收失败时保持命令关闭。回滚时恢复上一 Noema 安装包，不删除 Noema 用户数据；旧 SRT UI 代码不应恢复为执行后端。

## Open Questions

无。UI 落点使用现有“运行诊断”入口，并在 workspace task 流程提供状态提示；无需新增产品决策。
