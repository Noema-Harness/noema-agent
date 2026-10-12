# Noema

**每个人都能拥有一个真正属于自己的 agent。**

Noema 是独立的个人 agent 应用。它的核心不是替用户完成某一类任务，也不是把多个执行 agent 排成队列，而是成为一个随用户经历与选择持续变化的 agent：用户可以直接与它交流；它可以吸收用户带来的信息、记住有用的理解，并逐步获得连接外部应用与专业 agent 的能力。

它必须独立于某一家模型、某一个 coding harness 或 DSH。Noema 自己拥有用户侧的连续性；外部模型、应用和 agent 是可替换的能力来源。

## 当前状态

当前仓库已建立桌面运行壳与项目协作基础；agent、记忆、模型连接等产品运行能力尚未实现。当前已确定的产品边界与架构取舍记录在：

- [产品章程](docs/PRODUCT_CHARTER.md)
- [架构边界](docs/ARCHITECTURE.md)
- [决策记录](docs/decisions/README.md)
- [项目协作方式](docs/PROJECT_OPERATIONS.md)

GitHub Project 看板是工作状态的唯一来源；本地文档不重复维护任务清单。当前看板：[Noema 开发](https://github.com/users/c3115644151/projects/6)。

当前阶段门：工程底座 M0 已完成；M1 的目标是定义 Noema 第一条真实可重复的使用闭环。M1 完成前暂不实现聊天、记忆或外部集成等产品功能，见 [项目工作流](docs/PROJECT_OPERATIONS.md)。

## 核心原则

- Noema 是用户拥有的 agent，不是 DSH 插件或某个 agent 应用的外壳。
- 它的连续性与成长是核心；任务派发、聊天记录、技能市场均不是产品定义本身。
- 经历、当前理解、用户明确指令和可执行能力是不同类型的数据，不混成一个持续膨胀的 prompt。
- 外部内容保留来源和信任边界；任何 agent 都不能仅凭外部内容改写用户偏好或扩大权限。
- 先形成可维护的模块化单体；只有实际出现独立生命周期或扩展需求时，才拆服务或开放插件接口。

## 开发与协作

从 GitHub Project 中状态为 Todo 的 issue 开始；复杂工作有对应验收条件和必要的决策记录。完成后更新 issue / Project 状态，并提交实际运行过的验证结果。

### 本地桌面开发

- Windows 开发环境使用 Node.js 24.21+（当前本机验证版本为 24.21.0，Active LTS）和 npm。
- 首次克隆后运行 `npm ci`，然后 `npm run dev` 启动桌面壳。
- 检查命令：`npm run lint`、`npm run typecheck`、`npm test`、`npm run smoke`；Windows 构建目录：`npm run package:desktop`；Windows 安装器：`npm run make:desktop`。
- 代理环境下下载依赖可临时设置 `HTTPS_PROXY=http://127.0.0.1:7890`；不要把代理配置或凭据写入仓库。

仓库级 Codex 约定见 [AGENTS.md](AGENTS.md)。
