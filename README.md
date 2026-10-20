# Noema

**每个人都能拥有属于自己的 agent。**

Noema 是独立的个人 agent 桌面应用，以持续聊天为主要交互。它拥有联系人身份、独立聊天空间和用户侧连续性；模型、harness 与工具是可替换的能力来源。当前代码包含私聊/群聊、显式转发、互动约定和可选项目工作等原型路径；可运行不等于已适合长期日用。

完整界面正在按通信应用习惯重审。产品方向与原型事实分开记录，当前交付范围及进度只看 [GitHub Issues](https://github.com/c3115644151/noema-agent/issues) 和 [Project](https://github.com/users/c3115644151/projects/6)。

## 开发

Windows 优先；使用 `package.json` 约束的 Node.js 24.21.x（小于 25）与 npm，在仓库根目录执行：

```powershell
npm ci
npm run dev
```

应用采用 Electron、React/Vite、TypeScript 与本机 SQLite。FreeLLMAPI 用于当前模型接入；未连接模型时仍应能打开本地界面。要真实聊天，先启动并在设置中连接本机 FreeLLMAPI；端口优先从 `%APPDATA%\FreeLLMAPI\config.json` 读取，凭据由 Electron safeStorage 加密保存。普通聊天会把所需上下文发送给选定上游；模型目录可读不证明真实生成可用。

DSH 是可选项目工作适配器，缺少它不应妨碍普通聊天。运行时与权限边界见[架构](docs/ARCHITECTURE.md)，网关验证见 [FreeLLMAPI 操作 Skill](.codex/skills/freellmapi-operations/SKILL.md)。不要把本机代理、密钥或个人数据库提交到仓库。

```powershell
npm run lint
npm run typecheck
npm test
npm run smoke
npm run package:desktop
npm run smoke:package
```

Windows CI 定义完整检查，参见 [Desktop checks](.github/workflows/desktop-checks.yml)。真实上游调用和 DSH 端到端验证按改动需要单独执行，不能用合成执行器替代真实能力证据。

### 已配置的本机与新机器

`.noema/` 是忽略的本机工具/证据目录；若已存在 `dev.cmd` 与 `README.md`，可按其中说明启用本机已校验的运行时。这些文件不属于可移植源码，新接手者不应假定其存在。若依赖安装失败，先核对 Node/npm 版本、原生模块和 Electron 下载错误，再采用有依据的本机处理；不能因使用 `--ignore-scripts` 安装成功就宣称运行环境完整。

数据库位于 Electron user-data 目录，迁移与备份由应用管理；开发验证使用隔离目录。保留真实用户数据，清理构建缓存与一次性诊断产物时不要混删数据库、凭据或唯一验证证据。

## 理解与接手

- [项目约定](AGENTS.md)：恢复现场、产品边界与质量门。
- [产品章程](docs/PRODUCT_CHARTER.md)与[界面设计基线](docs/design/chat-redesign-brief.md)：已确认方向、工作假设和反馈门。
- [架构](docs/ARCHITECTURE.md)与[决策历史](docs/decisions/README.md)：状态所有权、边界与长期取舍。
- [协作方式](docs/PROJECT_OPERATIONS.md)：Issue/Project、并行分支和陌生 agent 交接。

开始实质工作先核对当前代码、Issue 最新续接点、Project 和相关决策。旧文档、历史测试与聊天摘要不能单独代表当前状态。
