# ADR 0003：Noema 拥有主对话，Harness 拥有执行会话

- 状态：已接受为首个可运行纵向切片的架构边界；Noema 是否因此值得作为独立产品仍待实际使用验证
- 日期：2026-10-13
- 决策依据：用户明确要求主对话不被后台任务占用、任务结果作为系统事件在主对话空闲时返回；其余责任划分由助手在用户委托的 Noema 生命周期范围内决定

> 当前有效性：本记录的对话/任务所有权边界仍有效；决策 7（本机 Ollama）及决策 10 中的 Ollama 专属参数已由 [ADR 0005](0005-free-model-routing-through-freellmapi.md) 取代。后续实现不得将本文历史模型选择当作当前要求。

## 背景

多模型聊天、跨对话记忆和可编辑记忆来源已有成熟产品；DSH + Relay 插件还可以把 Codex、Claude Code 作为 DSH conversation backend，并回传事件。因此 Noema 不能把“统一 provider picker”“memory UI”或“集成 coding agents”本身当成独立产品理由。

用户已确认的交互约束是：Noema 的主对话始终供用户继续交流；专业 agent 在后台执行独立任务；结果通过系统事件返回，当 Noema 主对话当前轮次结束后再接住；用户可随时停止或追加说明。产品独立性的候选价值，是这条根对话和 agent 身份由 Noema 本身持有，而不是某个执行 harness。

## 决定

1. **Noema 拥有一条持续的根对话。** Noema 保存用户与根 agent 的对话、根 agent 的 turn 状态及消息模型元数据。切换根对话模型只改变 Noema 下一轮的 respondent，不改变后台 worker 的 harness/session。
2. **外部 harness 拥有 native execution session。** Codex、DSH、Claude Code 等各自拥有工具轨迹、审批、工作区、上下文压缩和原生 session；Noema 不宣称重写或镜像这些内部状态。
3. **Noema 拥有后台任务记录及其事件队列。** 记录用户目标、限制、被发送的最小 context snapshot、目标 harness 与 native session 引用、状态、来源以及返回结果。worker 的工具日志不作为 Noema 原生思维内容写入根对话。
4. **worker 结果必须在根 turn 边界交付。** 任务事件先持久进入 `pending` 队列。根 agent 正在生成时，不开并行的根 turn、不抢占当前回答；当前 turn 正常结束或被用户中断后，再按顺序把待处理事件交给 Noema。事件 ID 幂等去重，应用崩溃或重启后可恢复。Noema 接到结果后才生成对用户的回应。
5. **用户仍可跨越任务执行进行对话。** 后台执行不是另一个主界面；用户可以继续与 Noema 聊天、给运行中的任务追加一条 task-scoped 指令或停止它。每项控制显示是模拟还是实际生效，未验证的功能不得宣称可用。
6. **根历史采用本地 SQLite 持久化。** Electron main process 是数据 owner；renderer 只能通过窄化 typed preload API 读写。根消息与后台任务/待投递 worker event 属于不同领域记录，不能把 worker session 直接扁平化为根 transcript。数据库放在 Electron `userData`，迁移有版本记录，数据可在任务/会话范围内导出和删除。
7. **首个根模型通过本机 Ollama 接入。** 本机已实际确认 Ollama 服务可用且 `qwen3.5:4b-q4_K_M` 能成功返回；以本地 provider 作为首个真实运行路径，不要求创建云端 key。远端 provider 后续逐个接入，并明确当前轮的 context 将发往何处。
8. **首个 SQLite driver 采用 `better-sqlite3`。** Node 24 内置 `node:sqlite` 在 Electron 使用的 Node 24.18.1 仍为 Release Candidate；`better-sqlite3` 提供稳定的 SQLite API 并要求 Electron ABI 重建。项目已使用 Electron Forge native rebuild、auto-unpack 和 Windows package/make CI；将通过该真实 CI 验证 driver，而不是引入第二种存储。若 Windows/Electron 构建不能稳定通过，再比较替代 driver。
9. **核心不依赖 DSH。** DSH、Codex、Claude 等以可选 adapter/subprocess 接入。PR #18 已把首个 DSH headless worker 从原型变成真实、文件权限受限的可选 adapter；它验证了一个执行闭环，不代表 DSH 成为 Noema 运行时或以后只有 DSH 可接。
10. **历史记录与模型上下文分开。** Noema 将完整根对话保存在本机，但每轮只带入最近最多 8 个已完成 turn、且历史内容最多 12,000 字符，并附上当前用户消息；不把完整会话无限堆入 prompt。Ollama 请求首版固定 `num_ctx: 16384`。当更早内容未带入时，界面说明完整记录仍在本机、但本轮模型看不到它；不静默摘要，也不伪称模型记得未发送的历史。当前用户消息不因历史预算被截断；若它本身超过模型可用上下文，请求失败并保留该消息供用户调整/重试。该预算是助手为首个本机纵向切片选择的可逆起点，后续依实际使用和 Ollama 的 `prompt_eval_count` 重审，不作为最终记忆架构。

## 为什么值得做首个纵向切片

DSH + Relay 是最强近邻，能够在 DSH workbench 内处理 Codex/Claude 原生 session 和返回事件；它证明后台执行和事件派发不是 Noema 独有。用户已明确要求 Noema 自己作为主对话 agent，而不是 DSH 插件或 coding workbench，因此本 ADR 只确认其**个人使用要求与系统所有权边界**，不声称具有市场级独特性。

首个纵向切片现已由 FreeLLMAPI 免费路由 + 实际 DSH headless worker 构成：它验证了根对话可以派发隔离任务、保持可用并接回有来源的结果。它没有验证现有 Codex thread 的连续导入，也没有证明“持续存在的 Noema root”足以超出 DSH + Relay / Open WebUI + agent adapters 的增量；独立产品理由仍开放。

## 代价与风险

- 单一根对话会随时间增长；首个切片保留完整本地事件历史，但只发送受预算限制的相关 prompt context。成熟压缩/记忆规则先不在此定义。
- 最近 8 轮 / 12,000 字符的上下文预算只是初期工程边界，可能过于保守或不足；完整记录留本机，系统暂不自动总结或宣称理解被省略的旧内容。
- 同步 SQLite 只执行短事务；网络请求、模型流和 harness 子进程不得占住主进程的长事务。
- `better-sqlite3` 增加 native dependency / Electron rebuild 成本，Windows CI 是硬验收门。
- 历史本机 Ollama 选择不再是当前 provider 契约；当前 FreeLLMAPI 免费路由耗尽时，根对话保留用户消息与失败状态，worker 事件可按原 session 显式续接，不得回退到本地或付费模型。
- worker context 可能含项目路径或私密内容；每次派发需可检查目标与 payload；没有获得对应能力/审批不能执行工作区写入。

## 重审触发条件

- 实际日用发现主/worker 分离只是多出一个 panel，没降低用户切应用、重讲背景或保持思考连续性的负担。
- DSH + Relay 或其他现成 stack 能同样提供用户拥有的根 agent 跨 coding 与非 coding 的持续主对话，且用户可接受其作为根 runtime。
- 根对话单线程造成话题混杂、context 失控，或用户实际更需要多个根 conversation。
- SQLite driver 无法在 Windows Electron 开发与安装包中可维护地运行。

## 参考实现与接口

- [Ollama `/api/chat`](https://docs.ollama.com/api/chat)：本机 `http://localhost:11434/api/chat` 接收带角色的消息数组并支持流式输出；[本地调用不需要 API key](https://docs.ollama.com/api/introduction)。
- [DeepSeek Harness Headless](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/README.md)：单次运行可用 `--session-id` 恢复持久 DSH session，并以 `--json` 输出事件流；它是 one-shot 进程且没有交互式审批通道。
- [DSH SDK JSON-RPC server](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/server/README.md) 与 [wire protocol](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/protocol/README.md)：支持进程外创建/恢复 session、投递 prompt、接收事件并等待 agent idle；协议目前没有 per-session close/cancel，需要用进程生命周期做隔离与取消。
- [Codex App Server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)：支持保存 native thread ID 后通过 `thread/resume` 恢复，execution state 归属 Codex 而不是 Noema。
- [Node.js v24.18.1 SQLite API](https://nodejs.org/download/release/v24.18.1/docs/api/sqlite.html)：`node:sqlite` 在当前 Node 24 仍为 Release Candidate；[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) 支持 Node 22+，Electron 使用者需通过 [`electron-rebuild`](https://github.com/electron/rebuild) 为 Electron ABI 重建；Electron Forge 会自动重建 native modules。
