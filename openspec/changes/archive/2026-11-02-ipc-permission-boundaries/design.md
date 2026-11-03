# Design

## Context

`preload.ts` 通过 `contextBridge` 暴露明确方法；`root-ipc.mjs` 为 `CHANNELS` 注册 invoke handler，并以 `isTrustedSender(event.sender)` 限制为当前主窗口 `webContents`。Electron 的同一 `webContents` 可以承载子框架；IPC event 提供 `senderFrame`，但当前 wrapper 未校验它。`main.ts` 中的 `noema:window-control` 独立于 root wrapper，只核对 `BrowserWindow.fromWebContents(sender) === mainWindow`。

渲染器使用 sandbox、contextIsolation 和关闭的 Node integration；顶层导航受限，外部链接由系统浏览器打开。当前未发现 renderer 诊断导出 channel。`diagnostics:model-usage` 是用户手动运行的本机 CLI，结果包括聊天内容、任务 prompt/result、错误及 workspace path。主进程凭据由 Electron `safeStorage` 加密保存；设置 key 时 renderer 将输入一次性传给 main，应用状态只返回配置状态和 base URL。导入的 Codex 对话在首次向模型传输前有明确同意且可移除。workspace 文件访问经主进程目录选择与任务流程；legacy DSH 选择前有 disclosure dialog。

## Decisions

1. **IPC trust is frame-specific.** Root IPC 要求 trusted `webContents` 和 `event.senderFrame === event.sender.mainFrame`，并检查主框架无 parent。缺少 frame 的 event fail closed。window-control 使用同一 frame predicate。
2. **授权按能力来源说明。** renderer 可调用的普通本地应用操作由可信主框架与明确 UI 操作授权；模型 key、首次外发导入对话和 workspace 文件访问分别由主进程存储、发送同意和目录选择/任务授权约束。任务 stop/resume 仅作用于已有 task，resume 仍由状态与 checkpoint gate 决定。
3. **Secrets stay main-owned after submission.** API key 仅作为配置请求输入短暂通过 bridge；main 使用 safeStorage 保存，状态与配置响应不回传 key。renderer health JSONL 的 console error 文本先经过凭据 redaction、长度限制，source 仅保留文件名；日志不记录完整配置对象或对话正文。
4. **Diagnostics export is local and explicit.** 当前没有 renderer export channel。CLI 导出属于用户在本机明确执行的操作，包含可能敏感的对话、任务 prompt/result、错误和路径；它不是匿名统计，也未被本 change 改成 UI 功能或外发服务。
5. **No-window behavior remains fail-closed.** 需要窗口绑定的 workspace picker/consent 无可用 main window 时取消且不授予目录、不创建 task。后台任务控制针对 durable task；未来要求人类确认的动作必须唤起窗口或安全拒绝。
6. **Authorization decisions are locally traceable.** 工作区选择与导入对话外发 consent 记录 requested/granted/denied/revoked、能力名、有限原因和 application execution ID；不记录路径、prompt、对话正文或 key。renderer console error 日志对已知凭据模式脱敏、限长，并将 source 收敛到文件名。

## Capability Map

| Renderer action group | Main owner | Authorization basis | Sensitive data / return boundary |
|---|---|---|---|
| root/social state、room、search、memories、follow-ups、models | RootAgent / SocialChatService / stores | Trusted main frame + explicit UI action for writes | Local conversations and personal data; no credentials in state |
| send/retry/stop, workspace task stop/resume | RootAgent / SocialChatService / SocialWorkService | User action; task resume also requires store checkpoint gate | Prompt/transcript/task status; task cards intentionally receive and display task prompt, result, error and workspace path over local IPC; tool execution remains in main process |
| workspace picker and task creation | Main process dialog + SocialWorkService | Main-owned directory chooser and existing task dispatch flow | Directory selection and task creation do not accept a renderer-supplied path; selected path is later exposed in the task card for review |
| project/agent/plan changes | SocialProjectStore / SocialChatService | Trusted frame, explicit user action, expected revision where applicable | Project content/evidence; no implicit cross-project access |
| provider configuration | RootAgent + EncryptedSecretStore | Explicit settings submission from trusted frame | Key input crosses IPC once, encrypted at rest, never returned in state |
| imported Codex context | RootAgent + local store | Explicit pre-send consent; removable local snapshot | Snapshot and recent conversation sent to configured provider after consent |
| diagnostics | Main-process logs/stores; manual CLI export | Local operator invokes CLI | Export may contain prompts, results, messages, errors and paths; never credentials by design |
| window/quick-capture lifecycle | Main process | Trusted main frame or registered shortcut lifecycle | No filesystem grant from readiness acknowledgements |

## Non-Goals

- No per-operation permission framework or new OS sandbox grant model.
- No renderer diagnostics browser/export UX and no telemetry upload.
- No schema, data-retention, key-rotation, or diagnostics-redaction redesign.

## Risks

- A compromised trusted main-frame renderer can still invoke the capabilities intentionally exposed by preload. This change narrows frame provenance; it does not replace per-operation authorization or content security policy.
- CLI diagnostics currently contain sensitive local material. Users must treat the output as private until a separately designed redaction/export UX exists.
