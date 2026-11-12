# Design

## Context

`OpenAICompatibleClient` 已为每次调用建立 request ID，并把 provider 生命周期和 usage 持久化。Social 服务收到 tool calls 后在主进程完成业务校验、副作用和结果构造，但目前没有对应的工具事件；诊断事件存储已有 request、turn、tool-call 独立 ID 和允许字段的详情白名单。

## Goals / Non-Goals

**Goals:**
- 让每个 Social provider tool call 在本机时间线上可从请求 ID追至工具终态。
- 让 provider 请求的连接与响应体共享有界总时限，并在失败事件中区分超时、取消和其他安全错误类型。
- 只记录受限身份、工具名/类别、状态、耗时和安全错误码；诊断故障不得影响工具业务。
- 沿用现有事件表、查询接口和诊断详情隐私过滤。

**Non-Goals:**
- 不记录或导出工具参数、返回正文、prompt、credential 或完整错误文本。
- 不改变工具授权、工具结果语义、重试策略、缓存策略或 provider 请求次数。
- 不增加工具重放机制；各工具的业务副作用仍由对应 owner 管理自己的时限与取消语义。
- Live acceptance 使用独立数据库和 Electron profile；通过严格受限的开发测试开关，从当前用户 Noema credential directory 只读打开现存加密凭据。不复制 Local State/key 文件，不把 key 写入临时目录、日志或测试结果。

## Decisions

- Provider 的 `onToolCalls` 以第二个参数提供当前 request ID，保持现有第一个参数及其他调用者兼容。
- 每个 Provider request 使用 180 秒总 deadline 覆盖 fetch 与响应体读取；用户 signal 与 deadline signal 合并，但诊断将用户取消记为 interrupted、deadline 记为 failed/request_timeout。不同请求可独立完成或超时；不对 tool owner 的业务副作用增加隐式重试。
- Provider failed 终态仅写有限错误码，不写原始错误消息、响应正文或 transport 诊断文本。usage 行和请求终态保持同一 request ID 与终态分类。
- `SocialChatService` 在调用进入执行路径时写 `tool.execution.started`；在工具结果加入当前消息上下文前后的可控边界写 `tool.execution.terminal`。由工具结果的有限结构判定显式失败；没有结果时以外层取消/异常区分 interrupted 与 failed。
- 终态在继续发起模型说明请求前落账。工具副作用已完成但后续模型调用失败时，工具仍记录 completed，而 Provider 后续请求单独记录失败。结构化结果中的 `completed: false`、`updated: false`、`deleted: false` 也属于无效果终态，不能记为 completed。
- 复用主进程 `recordDiagnosticEvent` 回调，并在 Social service 边界吞掉诊断异常。诊断事件使用 event store 已有 `toolName`、`toolCategory`、`durationMs` 与 `effectStatus` 白名单字段；不增加 schema migration。
- request ID 来自本地 UUID；turn ID 来自持久 Social turn；tool call ID 与工具名来自 Provider response，只接受有限字符形式并限制长度，拒绝异常值参与诊断。

## Risks / Trade-offs

- 工具结果形状并不完全统一 → 仅识别明确的 `error`、`ok: false`、`created: false`、`accepted: false`、`completed: false`、`updated: false`、`deleted: false` 和失败状态字段；不解析或保存自然语言正文。
- 个别直接完成型工具没有对话 tool-result message → 由业务分支在持久副作用成功后显式完成其 call trace。
- 诊断 sink 写失败会留下不完整时间线 → 保持业务结果不变；现有诊断健康状态和追踪覆盖负责暴露记录缺口。
- 固定总时限可能终止极慢但仍在生成的模型回复 → 使用 180 秒上限；超时后保留已经收到的消息内容，由当前会话状态决定是否重试，不伪报 completed。
- Live acceptance 中断或进程超时可能遗留隔离子进程/数据 → 脚本负责结束自己启动的 Electron process tree，并在 finally 中关闭只读数据库、CDP 与删除 development-root 内唯一临时目录；实际脚本运行前须在阶段 gate 核对这些退出路径。

## Migration Plan

不需数据库迁移。旧事件保持原状；新调用在升级后开始产生 Social 工具事件。
