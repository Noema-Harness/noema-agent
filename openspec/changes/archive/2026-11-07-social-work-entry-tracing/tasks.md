# Tasks

## 1. Implementation

- [x] 1.1 给 `SocialWorkService.getReadiness()` 添加稳定 reason code，并同步 shared contract 与 IPC/readiness tests。
- [x] 1.2 工作区选择被取消时记录脱敏终态事件；补无 task / 无执行器调用 / 无路径与提示文本泄漏测试。
- [x] 1.3 将 route、readiness、cancel、task-created 通过 application execution ID 串联，并补 diagnostics query/export 断言；隔离 Electron probe 将从 renderer/IPC 查询同一 trace 与 task。
- [x] 1.4 通过 `openspec validate social-work-entry-tracing --strict --no-interactive`。
- [x] 1.5 将 composer workspace task mode 作为 turn-scoped 状态传过 preload/IPC，由主进程阻止关闭模式时的 Noema 主聊 start_project_work 工具；队列项保留提交时模式，并补开启/关闭同文服务用例。
- [x] 1.6 Stage 4 统一 gate（S4-01 至 S4-04 全部实现后）：SocialWork、SocialChat、IPC、diagnostics-query 定向测试；renderer workspace mode on/off 与 picker cancel 的隔离 Electron 集成验证；核对 Root/DSH 无回退执行入口，并与任务分段、runner 身份、后台/重启恢复证据一并验收。
