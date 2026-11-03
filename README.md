# Noema

Noema 桌面应用的源码工作区。项目正在重新确认一期交付要求；本轮已确认条件见 [当前上下文](docs/CURRENT_CONTEXT.md)。

## 开发入口

使用 package.json 指定的 Node.js 24.21.x（小于 25）与 npm：

```powershell
npm ci
npm run dev
```

应用可配置 OpenAI-compatible 模型服务；FreeLLMAPI 保留兼容接入。凭据与个人数据库由应用保存在用户数据目录，不放进源码。

- [AGENTS.md](AGENTS.md)：工作区协作约定。
- [源码导航](docs/ARCHITECTURE.md)：现有入口和职责。
- [工作方式](docs/PROJECT_OPERATIONS.md)：材料、规格与验证入口。
- [现有行为规格](openspec/specs/)：回归参照，不代表新的一期范围。

检查命令以 package.json 为准：`npm run check` 检查结构、格式、类型和测试；`npm run workspace:check` 检查文档路由与链接；`npm run smoke` 用于客户端窗口检查。真实模型调用遵守当前上下文中的前置条件。
