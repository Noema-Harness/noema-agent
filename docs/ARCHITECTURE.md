# 现有源码导航

本页描述当前代码位置，供核查与维护使用；不规定重新规划后的架构。

| 位置 | 当前内容 |
| --- | --- |
| [main/main.ts](../apps/desktop/src/main/main.ts) | Electron 应用生命周期、窗口、服务实例与 IPC 组装 |
| [preload/preload.ts](../apps/desktop/src/preload/preload.ts) | 桌面 API 的 contextBridge |
| [renderer/renderer.tsx](../apps/desktop/src/renderer/renderer.tsx) | React 界面入口；兼容界面在 renderer/legacy |
| [shared/contracts](../apps/desktop/src/shared/contracts) | 跨进程类型和接口 |
| [main/agents](../apps/desktop/src/main/agents)、[main/storage](../apps/desktop/src/main/storage) | RootAgent、RootStore、用量等存储 |
| [main/chat](../apps/desktop/src/main/chat) | 聊天服务、记录、迁移、成员资产、个人记忆与回访 |
| [main/projects](../apps/desktop/src/main/projects) | 项目、共享计划和协作记录 |
| [main/execution](../apps/desktop/src/main/execution) | 项目执行服务、工具、检查点和命令沙箱 |
| [main/providers](../apps/desktop/src/main/providers)、[main/integrations](../apps/desktop/src/main/integrations) | 模型协议客户端、DSH 与 Codex 适配器 |
| [main/platform](../apps/desktop/src/main/platform)、[main/ipc](../apps/desktop/src/main/ipc) | 桌面通知、凭据、代理与 IPC |
| [renderer](../apps/desktop/src/renderer) | 聊天、项目、设置、搜索等界面 |
| [test](../apps/desktop/test)、[test-support](../apps/desktop/test-support) | 回归测试、隔离场景与窗口探针 |

产品源码按 main/preload/renderer/shared 分目录。`npm run source:check` 检查可识别导入的运行环境边界、断链和循环；通过不等于内部职责或使用体验已经成熟。

## 已核对的工程事实

- SocialChatService 和聊天存储仍有较集中的职责，且保留兼容运行路径。相关对象的未来保留范围尚未决定。
- [命令沙箱](../apps/desktop/src/main/execution/project-command-sandbox.mjs) 当前在 Windows 启动前返回不支持；[回归](../apps/desktop/test/main/execution/project-command-sandbox.test.mjs) 覆盖该拒绝路径。现有 helper 不能完整满足严格的工作区外写入和网络边界，不可仅移除 guard 来声称恢复。
- [Windows runner setup state](../apps/desktop/src/main/execution/windows-runner-setup-state.mjs) 保存严格版本化的本机 setup 状态；[setup service](../apps/desktop/src/main/execution/windows-runner-setup-service.mjs) 在主进程先持久化 repair-required，再协调 helper 幂等修复并 fresh-probe 后提交 ready。当前 helper 尚未实现 setup operations，service 也未接入应用启动/命令 readiness，因此 command sandbox 仍保持拒绝。
- [项目存储测试](../apps/desktop/test/main/projects/social-project-store.test.mjs) 中模拟旧数据库升级的夹具未移除新增回访表，最新核查遇到重名失败；真实旧库升级安全性不能由该夹具保证。
- 格式检查此前未全通过；当前整体客户端、真实模型与长期使用未完成统一验收。
- 参考源码位于 [.work/references](../.work/references/README.md)，其版本和检出范围由该入口登记。

当前确认条件见 [CURRENT_CONTEXT](CURRENT_CONTEXT.md)，实际命令与材料管理见 [PROJECT_OPERATIONS](PROJECT_OPERATIONS.md)。
