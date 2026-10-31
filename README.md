# Noema

Noema 是独立的个人 agent 桌面应用，面向持续交流与受托协作。项目仍在开发，产品方向见 [产品章程](docs/PRODUCT_CHARTER.md)。

## 开发

使用 package.json 指定的 Node.js 24.21.x（小于 25）与 npm：

```powershell
npm ci
npm run dev
```

客户端支持配置通用 OpenAI-compatible 模型服务；FreeLLMAPI 是旧用户的兼容路径。凭据与个人数据库由应用保存在用户数据目录，不应放进源码。

## 找到当前依据

- [AGENTS.md](AGENTS.md)：开发入口与工程约定。
- [阶段总览](docs/ROADMAP.md)：产品阶段与退出条件。
- [架构](docs/ARCHITECTURE.md)：代码入口与职责。
- [工作方式](docs/PROJECT_OPERATIONS.md)：OpenSpec、文档生命周期和源码同步。
- 当前行为规格：[`openspec/specs/`](openspec/specs/)；进行中的变更位于 `openspec/changes/`。

交付检查用 `npm run check`（结构、格式、类型与服务测试）；窗口验证用 `npm run smoke`。小改动可只跑相关检查。其他验证与清理入口见根 package.json：`npm run workspace:check` 检查工作区分类，`npm run workspace:clean` 预览可清理内容。README 只维护项目入口与安装说明，不承载每天的进度或功能清单。
