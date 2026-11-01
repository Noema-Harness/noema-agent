# Noema 架构与代码入口

Noema 保持 Electron + React/Vite + SQLite 的模块化单体。源码先按运行环境定界，再按实际职责组织；这个入口说明如何定位代码，不复制变更任务或每日状态。

## 运行边界

| 入口 | 职责 |
| --- | --- |
| [main/main.ts](../apps/desktop/src/main/main.ts) | 应用生命周期、窗口、服务组装与 IPC 注册 |
| [preload/preload.ts](../apps/desktop/src/preload/preload.ts) | 通过 contextBridge 暴露桌面 API，不承载业务状态 |
| [renderer/renderer.tsx](../apps/desktop/src/renderer/renderer.tsx) | 连接浏览器端应用；旧界面仅在 #legacy 时加载 |
| [shared/contracts](../apps/desktop/src/shared/contracts) | 跨进程数据与 API 类型；shared 的运行代码保持平台无关 |

Renderer 通过 preload API 与主进程通信，不直接导入 Node、Electron 主进程或数据库。主进程可依赖业务模块与 shared，不能反向导入 UI。开发场景只通过主入口的两个按需加载端口进入 test-support，不进入正常启动的执行路径。

## 业务与呈现

| 范围 | 代码定位与所有权 |
| --- | --- |
| 主体、根对话与持久化 | [main/agents](../apps/desktop/src/main/agents)、[main/storage](../apps/desktop/src/main/storage)；RootAgent 与 RootStore 持有根对话及连续工作状态 |
| 聊天、上下文和成员资产 | [main/chat](../apps/desktop/src/main/chat)；服务编排与存储分开，`personal-memory-store` 独立持有用户个人记忆，model-tools 定义模型协议，migrations 独立维护升级 |
| 项目、协作与共享计划 | [main/projects](../apps/desktop/src/main/projects)；保留各自的状态与事务边界 |
| 执行与授权 | [main/execution](../apps/desktop/src/main/execution)；执行任务、沙箱、失败恢复及核验 |
| 模型、工具与兼容接入 | [main/providers](../apps/desktop/src/main/providers)、[main/tools](../apps/desktop/src/main/tools)、[main/integrations](../apps/desktop/src/main/integrations)；供应商与旧 harness 为可替换边界；[ModelUsageStore](../apps/desktop/src/main/storage/model-usage-store.mjs) 在本地记录直连 API 与 DSH worker 的不含正文用量元数据 |
| 桌面集成 | [main/platform](../apps/desktop/src/main/platform)、[main/ipc](../apps/desktop/src/main/ipc)；窗口、通知、凭据、代理及 IPC 契约 |
| 当前聊天界面 | [renderer/chat](../apps/desktop/src/renderer/chat)；controller 持有状态和动作，shell 负责组合，messages、workspaces 与 dialogs 按职责呈现 |
| 项目、设置及其他界面 | [renderer/projects](../apps/desktop/src/renderer/projects)、[renderer/settings](../apps/desktop/src/renderer/settings)，另有 search/onboarding/capture；样式与所属界面邻近 |
| 验证与开发场景 | [test](../apps/desktop/test) 对应运行环境/领域；[test-support/electron](../apps/desktop/test-support/electron) 保存窗口探针和场景；scripts 为执行入口 |

身份、会话、群消息、项目计划、行动、成员资产和用户个人记忆分别持有状态。个人记忆只供 Noema 主聊按需读取，不注入项目成员会话；设置可查看与维护。群窗口不等于成员共享一个上下文。Noema 主聊协调并和用户沟通，项目会话承接对应工作，用户继续保有关键取舍与验收。

## 结构怎样保持

`npm run source:check` 检查平铺入口回流、跨运行环境依赖、平台 API 泄漏、开发材料依赖、断开的相对导入与运行时代码循环。它还列出体积最大的模块以帮助选定下一处维护，不用行数阈值强迫拆分。源码边界由 [检查实现](../scripts/source-structure.mjs) 和对应回归场景保证。

主入口只组装。纯映射、模型协议、状态持久化、窗口呈现和测试场景各有位置；新增逻辑先找当前所有者，不建立万能 utils、空转发层或第二套状态。类型和明确函数接口帮助定位调用影响；测试检查对外行为，机械迁移复用现有验证。

仍存在较大的领域存储、调度类、共享计划编辑器及兼容旧界面。它们已定位到明确模块，后续随对应功能变更按状态与职责继续解耦，不能仅因目录已经调整就认为内部设计完成。

## 数据与当前依据

模型配置支持通用供应商；FreeLLMAPI 为旧用户兼容路径。网页、工具和成员反馈不获得用户指令权限，调用预算与授权由运行时控制。用户数据在 Electron user-data 中，测试使用独立数据库。Windows 10 严格隔离不满足时命令执行保持关闭，不默认要求 WSL。

当前文档及维护时机见 `.codex/workspace.json`；行为约定与变更在 OpenSpec，历史 ADR 仅按需追溯，过程材料进入 `.work`。产品逻辑继续见[核心流程图](design/noema-core-flows.md)，包括日常连续性的个人记忆子流程 J。

## 实现参照

运行边界参照 [Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)；对照本地已有 Goose 桌面源码的 IPC/桌面职责和 OpenCode core 的领域组织，保留适合 Noema 规模的直接组合，不迁入其完整服务框架。
