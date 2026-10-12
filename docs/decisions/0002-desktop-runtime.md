# ADR 0002：使用 TypeScript 模块化单体构建桌面端

- 状态：已接受
- 日期：2026-10-12

## 背景

Noema 需要 Windows 桌面交互、长期运行的本地状态、模型/外部 agent 连接、浏览器或系统能力，并以适合个人长期维护和 AI 辅助开发的技术栈开始。

## 决定

- 桌面壳：Electron Forge + Vite。
- 应用代码：TypeScript；UI 使用 React。
- 当前验证的 Node 开发运行线：Node 22.15+；优先跟随受支持的 LTS。升级到 Node 24 后需在 CI 和本机重新验证 Electron Forge/Vite 工具链。
- 应用运行时采用模块化单体；npm workspace 只用于统一根目录的安装与开发命令，不将业务拆成多个 package，也不引入微服务。
- Electron main process 拥有 OS/文件/凭据/数据库访问；renderer 无 Node 集成。通过窄化、类型化的 preload API 暴露能力。
- 主进程中的 agent 核心、个人状态和连接器以领域模块隔离。外部 harness 按需独立进程运行，避免将任意执行权限交给 renderer。
- 持久状态先使用本地 SQLite；凭据使用 Windows/macOS/Linux 原生安全存储，不与普通记忆文本混存。具体 SQLite driver、迁移库和密钥库封装在运行时 scaffold 任务中验证后选定。
- 自动化测试从 Vitest 单元测试与 Electron 启动 smoke test 起步；需要真实浏览器交互时再增加 Playwright，不为了框架完整而提前搭完整 e2e 平台。

## 理由

Electron 的 Node 生态更适合本项目需要接入的本地 CLI、agent harness 和桌面能力，TypeScript 单栈降低长期维护成本。Electron 的安全模型以进程隔离为前提，而不是让 UI 直接获得 Node/系统权限。[Electron security guidance](https://github.com/electron/electron/blob/main/docs/tutorial/security.md) [Electron process model](https://github.com/electron/electron/blob/main/docs/tutorial/process-model.md)

Electron Forge 提供官方 Vite + TypeScript 模板；Codex 指令、skills 和项目设置使用项目级、按需加载的结构，避免把架构文档和所有流程永久塞入每次上下文。[Electron Forge template](https://github.com/electron/forge/blob/main/docs/templates/vite-%2B-typescript.md) [Codex instruction/skill guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)

## 代价与约束

- Electron 内存与安装体积高于 Tauri；此阶段优先减少跨语言开发摩擦和系统集成难度。
- Electron 安全配置必须默认开启 context isolation、renderer sandbox、禁用 nodeIntegration、限制导航和 IPC API。
- 仍保持模块化单体。只有实测的生命周期、权限或故障隔离需要，才将 connector/harness 单独进程化。
- 若产品在验证后不需要深度本地/系统接入，或 Electron 成本成为主要问题，再用 ADR 评估替换桌面壳，不在同一阶段并行维护两套壳。
