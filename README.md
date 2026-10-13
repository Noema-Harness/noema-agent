# Noema

**每个人都能拥有一个真正属于自己的 agent。**

Noema 是独立的个人 agent 应用。它的核心不是替用户完成某一类任务，也不是把多个执行 agent 排成队列，而是成为一个随用户经历与选择持续变化的 agent：用户可以直接与它交流；它可以吸收用户带来的信息、记住有用的理解，并逐步获得连接外部应用与专业 agent 的能力。

它必须独立于某一家模型、某一个 coding harness 或 DSH。Noema 自己拥有用户侧的连续性；外部模型、应用和 agent 是可替换的能力来源。

## 当前状态

当前可运行版本包含一条由 Noema 自己持有的根对话：经由本机 FreeLLMAPI 网关选择已确认的免费模型，流式回复，并将对话保存在本机 SQLite。后台专业 agent、长期记忆提取、外部应用连接和云同步尚未实现。当前产品边界与架构取舍记录在：

- [产品章程](docs/PRODUCT_CHARTER.md)
- [架构边界](docs/ARCHITECTURE.md)
- [决策记录](docs/decisions/README.md)
- [项目协作方式](docs/PROJECT_OPERATIONS.md)

GitHub Project 看板是工作状态的唯一来源；本地文档不重复维护任务清单。当前看板：[Noema 开发](https://github.com/users/c3115644151/projects/6)。

当前阶段、Issue 依赖和是否允许进入产品实现只以 [项目工作流与看板](docs/PROJECT_OPERATIONS.md) 中的实时记录为准。Issue 是可调整的当前交付，不代表未讨论的产品细节已被批准。

## 核心原则

- Noema 是用户拥有的 agent，不是 DSH 插件或某个 agent 应用的外壳。
- 它的连续性与成长是核心；任务派发、聊天记录、技能市场均不是产品定义本身。
- 经历、当前理解、用户明确指令和可执行能力是不同类型的数据，不混成一个持续膨胀的 prompt。
- 外部内容保留来源和信任边界；任何 agent 都不能仅凭外部内容改写用户偏好或扩大权限。
- 先形成可维护的模块化单体；只有实际出现独立生命周期或扩展需求时，才拆服务或开放插件接口。

## 开发与协作

从 GitHub Project 中状态为 Todo 的 issue 开始；复杂工作有对应验收条件和必要的决策记录。完成后更新 issue / Project 状态，并提交实际运行过的验证结果。

### 本地桌面开发

- Windows 开发环境使用 Node.js 24.21+ 和 npm。当前本机固定运行时在 `D:\NoemaTools\node-v24.21.0-win-x64`；PowerShell 会话中可这样启用，不影响其他项目的默认 Node：

  ```powershell
  $noemaNode = 'D:\NoemaTools\node-v24.21.0-win-x64'
  $env:Path = "$noemaNode;$env:Path"
  ```

- 启动已配置好的 FreeLLMAPI 桌面应用。在 Noema 的“连接模型”设置中填入 FreeLLMAPI 的本机地址与统一 API Key；Windows 上 Noema 会优先从 `%APPDATA%\FreeLLMAPI\config.json` 读取端口。API Key 通过 Electron `safeStorage` 加密保存在 Noema 用户数据目录，不写进仓库或 SQLite。
- 对话保存在本机；发送时 Noema 经 FreeLLMAPI 把当前上下文转发给所选的免费上游模型。Noema 仅展示明确核验过的免费路由，不自动改用本机模型或付费模型。上游额度或服务商不可用时，消息保留并可重试/切换路由。
- 首次克隆后运行 `npm ci`，再运行 `npm run dev` 启动桌面应用。应用 SQLite 数据位于 Electron 的本机 user-data 目录，不写进仓库。
- 每轮最多将最近 8 个已完成对话轮次、且不超过 12,000 个历史字符发送给所选上游模型；更早历史仍保存在本机，但不会自动注入。
- 检查命令：`npm run lint`、`npm run typecheck`、`npm test`、`npm run smoke`；Windows 构建目录：`npm run package:desktop`；Windows 安装器：`npm run make:desktop`。
- GitHub Actions 的 `Desktop checks` 已通过 Windows 安装器 maker 验证。手动运行该 workflow 时会生成私有、未签名的测试安装器 artifact，保留 7 天；常规 PR/push 只验证打包，不占用长期 artifact 配额。
- 当前本机 Squirrel maker 向 Windows 临时目录写 `.nupkg` 时返回 Access Denied；不要通过关闭安全防护来绕过。以 Windows CI maker 结果验证安装器。
- 本机 Noema 开发启动会优先选择 D 盘已校验 SHA-256 的 Electron 运行时，以绕过此主机从工作区路径启动 Electron 时的 `EXCEPTION_BREAKPOINT`；其他环境仍使用锁定依赖中的 Electron。
- 代理环境下下载依赖可临时设置 `HTTPS_PROXY=http://127.0.0.1:7890`；不要把代理配置或凭据写入仓库。

仓库级 Codex 约定见 [AGENTS.md](AGENTS.md)。

