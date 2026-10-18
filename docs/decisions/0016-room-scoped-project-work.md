# ADR 0016：在好友聊天中承接受限项目工作

- 状态：接受为下一条可撤回的工程切片（助手在用户委托范围内决定）
- 日期：2026-10-18
- 关联：Issue #2、#78；ADR 0015

## 问题

聊天好友目前能交流，但还不能在同一房间里承接实际工作。若用户要做项目中的一件事，只能离开 Noema、切换到外部 harness 并重新带入目标；这可能暴露 Noema 的好友/房间结构是否能带来超出聊天换壳的日常价值。

## 决定

1. **聊天和委托是两个明确动作。** Noema 不根据普通聊天文本偷偷启动文件操作。用户在工程搭档所在的房间显式切到项目工作并提交任务，所选工程搭档才获得本轮执行权。对话消息与工作任务是两种独立的时间线项目。
2. **Noema 拥有好友和工作状态。** `agentId`、`roomId`、任务归属、状态、原始范围、结果与核验记录保存在 Noema 的社交域；DSH `sessionId` 仅是单项工作可续接的执行上下文，不代表好友身份。每项新工作默认创建干净 DSH session；同一项工作被用户续接时才使用原 session。不同 room 和不同任务不共享 DSH transcript。
3. **只使用明确选定的当前房间上下文。** 工作请求可以带上当前 room 中有限的已完成消息和工程好友 profile；不会自动检索或注入其他房间的消息。请求被发送到第三方模型前，UI 明示所选目录和模型数据边界。
4. **复用 DSH Headless Adapter。** 它是一项可替换的一次性执行能力：每个进程处理一项任务，JSON 事件报告状态，`--session-id` 可续接。Noema 不把一轮任务的开始/结束伪装成连续聊天，不依赖 DSH GUI/服务端。
5. **任务应异步返回原房间。** 同一房间可以继续聊天；任务运行、停止、完成或失败作为带状态的工作活动回到发起 room。应用关闭时停止受管进程并将任务记为中断；重启不自动重新执行写操作。
6. **完成状态独立于自然语言自报。** DSH 进程退出、worker final 与独立核验分别保存。若请求包含 Noema 支持的文件验收条件，就调用现有 `workspace-verifier` 验证；没有明确、可用的核验条件时，标示“执行结束，未独立核验”。worker 失败、部分完成、验证失败都不能伪装为成功。首轮不自动修复或无限续做。
7. **保留本机范围与中止能力。** 项目工作开始前用户须明确选择目录；初期每个本地 workspace 同时最多运行一个写任务，避免竞态覆盖。中止只停止进程，不承诺回滚已发生的修改。任务创建、运行、完成/失败、停止和重试都可追溯。
8. **限制 runtime 能力并如实披露。** DSH 继续使用本机 FreeLLMAPI 免费路由；允许前台 PowerShell 通过 DSH 自带 sandbox executor 执行项目检查，禁用 web、subagent 和 background jobs，并保留现有工具调用上限及凭据脱敏。`workspace-write` 对文件写入应用 OS 沙箱，不能约束网络和进程可见性；Windows 上读取范围也没有得到完整隔离。因此界面不得声称所选目录是绝对安全边界，必须说清楚代码/测试进程在当前 Windows 账户下运行、模型读取到的项目内容可能发送到第三方路由；首条 live E2E 用 scratch 目录与合成内容。若真实使用要求严格的读取/网络隔离，后续必须换用真正隔离的运行环境，而不是靠提示词或 Noema 路径检查宣称安全。

## 关键实现边界

- 新增社交域工作任务持久表，不复用旧根对话 `background_tasks` 表，避免把新聊天重新架在 legacy root session 上。
- 任务事件是 room timeline 的活动对象，不把 DSH reasoning、shell 参数或完整工具输出复制进聊天；只保留必要的阶段、工具计数类别、终态、摘要和验收结果。
- UI 的任务起点要让用户一眼看出“这条会在项目目录中操作文件”，并始终显示执行好友、所选目录、取消及结果状态；界面不变成全局任务看板。
- 文件选择是用户明确授权；任务文本、被工具读取的项目文件以及模型回复可能离开本机发送到 FreeLLMAPI 当前路由。停止前文件改动不会自动撤销。
- 首条 live 任务族局限在可用独立文件条件核验的项目更改，以验证完整事件闭环；不以这个受限任务宣称完成通用 coding-agent 能力。

## 外部依据

- DSH Headless 官方文档定义为每次一次性任务进程、可输出 JSON 事件，支持按同一 session ID 续接；明确没有交互式 follow-up：[官方 Headless README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/README.md)。
- DSH base 官方 profile 将 `pwsh-sandbox`、`sandbox-policy`、`workspace-write` 和 `tool-pwsh` 分开组合；PowerShell 子进程和文件工具不是同一个权限边界：[官方 base profile](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/base/cordis.patch.yml) 与 [pwsh sandbox 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/shell/pwsh-sandbox/README.md)。
- DSH 的 Windows sandbox 文档说明读权限、网络和进程观察的限制；Noema 不应把 `workspace-write` 宣传为完整隔离：[官方 sandbox 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sandbox.md)。
- 官方 headless 子代理异步结算仍存在公开缺陷报告；首轮禁用 subagents 和后台 jobs，避免依赖未结算结果：[Discussion #1190](https://github.com/deepseek-ai/deepseek-harness/discussions/1190)。这是维护者仓库中的用户报告，并非我们独立复现。

## 后果与重审条件

- Noema 会获得一次真实“聊天 → 同一好友执行 → 原房间收回结果”的产品闭环；这只验证关系/房间运行结构，不证明长期专业实践已经成长，也不证明独立产品价值成立。
- 当前实现增加一个社交任务生命周期与持久状态；不得借此扩成通用计划器、自动路由所有聊天或全局任务板。
- 选择 DSH 是可逆运行时选择；Noema 核心不依赖 DSH。若它的 Windows 读隔离、headless 结算或模型可用性导致任务不能安全/可信运行，应替换 adapter 或暂停文件执行，而不是放宽权限后继续。
- 完成同一 scratch 任务后，比较 Noema 与直接 DSH 的目标重述成本、结果可见性和错误可恢复性；若 Noema 没有降低摩擦，停止该功能线并重新评估 Noema 的独立产品理由。
