# Noema 架构与代码入口

本文维护系统职责与代码导航；不记录每轮进度。当前是 Electron + React/Vite + SQLite 的模块化单体，src 仍有大文件和未完成的模块边界，后续应按真实交付逐步拆分。

## 代码入口

| 职责 | 当前入口 |
| --- | --- |
| 主进程、IPC、窗口与桌面集成 | apps/desktop/src/main.ts |
| 聊天界面与呈现 | apps/desktop/src/social-chat-app.tsx、social-chat-surface.css |
| 聊天状态与生成调度 | apps/desktop/src/social-chat-store.mjs、social-chat-service.mjs |
| Noema 主体与根持久化 | apps/desktop/src/root-agent.mjs、root-store.mjs |
| 项目与共享计划 | apps/desktop/src/social-project-store.mjs、project-plan-store.mjs、project-plan-panel.tsx |
| 委派与执行 | apps/desktop/src/social-work-service.mjs、noema-project-executor.mjs |
| 可执行验证 | apps/desktop/test、test-support、scripts |

该表是导航，不把文件位置等同于理想分层。架构改动应沿调用链核对状态所有权、权限、失败与恢复，并同步此表。

## 边界

身份、会话、群消息、项目计划、行动和成员资产分别持有自己的状态；群窗口不等于所有成员共享一个上下文。Noema 主聊协调和用户沟通，项目会话承接对应工作，工具与模型供应商作为可替换能力接入。

模型配置支持通用供应商，FreeLLMAPI 是可选兼容路径。网页、工具和成员反馈不获得用户指令权限。实际工具能力与调用预算由运行时和授权控制，不靠界面文案保证。

用户数据默认在 Electron user-data 中；开发测试应隔离。Windows 10 严格命令隔离边界未满足时，命令执行保持关闭，不默认要求用户安装 WSL。

## 开发资料边界

- 当前文档入口与更新触发记录在 `.codex/workspace.json`。
- OpenSpec 保存行为约定和变更设计，实际实现仍需源码与运行证据核对。
- `docs/decisions/` 是历史决策记录，当时的 accepted 不自动等于当前架构。
- `.work/` 保存研究、快照和实验；恢复项目时先读当前入口，不遍历历史来猜测现状。

产品逻辑见 [核心流程图](design/noema-core-flows.md)，工程变更只维护相关节点和代码边界。
