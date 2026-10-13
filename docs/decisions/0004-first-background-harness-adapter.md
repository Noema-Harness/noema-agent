# ADR 0004: Use DSH Headless for Noema's first background-worker slice

- Status: Accepted as a reversible first integration, within the user's delegated Noema lifecycle decisions
- Date: 2026-10-13
- Scope: one local DSH headless worker behind a replaceable adapter; not a commitment to DSH as Noema's runtime or product identity

> Provider supersession: the local-Ollama route described in this draft is no longer current. The user directed Noema to use FreeLLMAPI free models only; follow [ADR 0005](0005-free-model-routing-through-freellmapi.md) for model routing. Historical Ollama observations below record earlier isolated experiments only.

> Current FreeLLMAPI boundary: `auto:noema-free` is a curated eight-model chain: six BlockRun-listed no-cost models plus Kilo's anonymous Cohere North Mini Code and OVH's anonymous Mistral Small 3.2; catalog auto-include is disabled. The DSH adapter accepts only this alias. A real Noema desktop run modified an isolated README through DSH's file tools (4 tool calls), returned a completion event into the same Noema timeline, and Noema summarized it after an initial provider-cooldown failure. A separate fresh DSH process resumed the same persisted session and recovered the exact file content. This verifies one end-to-end path, not continuous upstream availability.

## Problem

Noema now owns a persistent root conversation, but it is still only a local chat surface. The user's concrete daily scenario is that a coding task should continue in another available harness when the primary model/app is unavailable, without moving or interrupting the Noema conversation. A mock handoff does not validate this.

## Evidence

- The installed local DSH CLI is `0.1.7-rc.2`; its built-in `headless` profile runs one task per process, supports JSON event output, and accepts `--session-id` to resume a persisted session.
- In an isolated DSH_HOME and scratch directory, DSH headless used the local Ollama Anthropic-compatible `/v1/messages` endpoint to create a file, exited successfully, then a fresh DSH process resumed the same session ID and recalled the file content. No project files or cloud model were used.
- Ollama documents local Anthropic Messages API compatibility at `http://localhost:11434`; its local API key is accepted but ignored. [Ollama Anthropic compatibility](https://github.com/ollama/ollama/blob/main/docs/api/anthropic-compatibility.mdx)
- The DSH SDK server profile also ran locally, but the installed `0.1.7-rc.2` protocol lacks the newer `session/wait` method and a session-cancel request; reopening an SDK session ID in a fresh SDK process failed with `session already exists`. The headless CLI is therefore the better first boundary.
- The DSH headless event stream is a bounded projection, not a lossless Session transcript. It has no interactive follow-up or approval response channel; the DSH profile fails closed when a required approval has no answerer.
- In a separate isolated headless profile, terminating a long task shortly after its `turn/start` and launching a new process with the same session ID succeeded; the new turn completed. This proves early-interruption continuation in one scratch test, not recovery after file side effects or large partial output.
- File creation and cross-process session resume in the scratch workspace succeeded under an overlay that disabled PowerShell, web, and DSH subagent/job tools. Shell-tool behavior without that restriction did not: the tested local Qwen 4B repeated calls without finishing, and Qwen 9B issued a PowerShell call missing its required `description` argument. The cause is not established. DSH documents that approval requests without an answerer fail closed; the headless profile has no interactive answer channel.
- The local Qwen 4B root model emitted a structured `delegate_task` tool call in Ollama streaming mode, and a second model turn correctly turned the tool receipt into a user-facing acknowledgement. This verifies the basic model→tool→model cycle locally, not its reliability across all tasks.
- The official DeepSeek route returned HTTP 402 `Insufficient Balance` for a tiny test prompt. Do not use that route for this integration without an explicit user-selected, available provider. The verified local Ollama route avoids cloud requests.
- FreeLLMAPI's named `noema-free` chain is curated and has `auto_include_new_models=0`; its eight entries are all listed as supporting tools. The app calls it as `auto:noema-free`; DSH uses the same route. The named-chain router falls over within the listed chain when an endpoint is rate-limited; it does not silently use the global catalog. [FreeLLMAPI named chains](https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/fallback/01-named-chains.md).
- BlockRun free routes use an external hosted inference service; its free tier may use prompts for service improvement. Kilo's anonymous free routes are limited to 200 requests/hour/IP and its docs state prompts/outputs are logged for training; OVH's anonymous free tier is limited to 2 requests/minute/model/IP. These are free routes, not a privacy guarantee or a promise of high availability. [BlockRun free models](https://www.blockrun.ai/free), [FreeLLMAPI supported platforms](https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/providers/01-supported-platforms.md).

## Decision

1. Keep DSH optional and outside Noema's core process model. Launch the installed `dsh --profile headless --json` CLI as a child process; do not add DSH npm libraries as Noema runtime dependencies. Resolve the installed CLI plus a compatible Node runtime, then run under a Noema-owned isolated `DSH_HOME`, not the user's active DSH web profile, so Noema tasks do not modify or silently mix with that profile.
2. A worker task is a separate Noema-owned task record linked to its originating root turn. Store its generated DSH Session ID, selected directory, exact delegated prompt/context package, lifecycle status, final projected response, and error. The full native DSH event log remains owned by DSH; Noema must not call the projection a full transcript mirror.
3. Use one active headless process per worker run. Pass task text on stdin, not in command-line arguments. On explicit stop, terminate only that task process and mark the Noema task interrupted. A later run may reuse the DSH session ID only after confirming it is accepted; if DSH rejects it, preserve the Noema task and offer a new native session with a concise handoff instead of claiming lossless continuation.
4. Reuse a DSH session only with the exact same working directory and DSH profile/preset; those are DSH's own adoption constraints. Any mismatch is a recoverable error, not a silent new session. One isolated test showed the same session can continue after the prior process is terminated shortly after `turn/start`; this is an initial recovery fact, not a guarantee after arbitrary partial workspace writes.
5. Keep the Noema root conversation live. DSH start/status/result are sourced events on the same chronological thread. If a result arrives while Noema is generating, queue it until the root turn boundary; then give the result to Noema as a distinct system event and persist Noema's response separately. Never impersonate the user to represent the event.
6. The worker uses only `auto:noema-free` through the local FreeLLMAPI gateway. The DSH adapter rejects any other model name, passes the FreeLLMAPI unified key only in the child process environment, and sets the loopback FreeLLMAPI `/v1` base URL. It never falls back to Ollama, another gateway route, or a paid model. This deliberately sends task context and files the worker reads to third-party model providers and must be disclosed before the user selects a workspace.
7. Expose one `delegate_task` tool to the Noema root model only when DSH and an execution directory are available. Use the model's structured tool call as the dispatch decision; store the exact task payload. The local Qwen 4B produced a valid dispatch call and a coherent follow-up in a real two-request Ollama round trip. A single active DSH worker is the initial concurrency limit.
8. The first worker profile is file-only: preserve the DSH workspace sandbox, disable PowerShell, web, subagent, and background-job tools, and do not widen approval policy. The local model's PowerShell calls were not reliable and headless has no approval channel. Noema must label that tests/commands are not run by the worker; verification remains a separate step.
9. Require a user-visible, inspectable execution-directory selection before exposing `delegate_task`; never let the model invent an arbitrary path. The selected folder is stored locally and passed as the DSH process cwd.
10. On Noema shutdown, abort an in-flight root/event response, stop each tracked DSH child, await its terminal record, and only then close SQLite. On next startup, any remaining persisted in-flight task is recovered as interrupted and its event remains available; do not leave child processes running after the UI closes.

## Consequences

- Historical local-Ollama tests do not count as evidence for the current provider boundary. The real desktop smoke proves one successful edit-and-return; cooldowns can still prevent a model turn, in which case Noema preserves the pending event and the user can retry. Reconsider the eight-model pool if ordinary repeated use still hits cooldowns before a useful session can continue.
- Noema needs a durable task/event table and an explicit distinction among root messages, system events, and DSH-owned native history. A fixed allowlist of Noema verification commands may be a later follow-up; it is not part of the DSH worker's permissions.
- The UI must show the worker's actual state and source inline with the root chronology, while keeping the composer available. A permanently open operations dashboard is not justified by one worker.
- The root/worker event queue needs a distinct system-event object; never create a fake user message to inject a worker result. A completed event is processed only at a root-turn boundary.
- Shell execution, approval forwarding, and mid-run steering remain unsupported. Early process-interruption recovery has one successful isolated probe but needs broader lifecycle tests before it can be promised to users.
- Closing Noema explicitly stops active DSH subprocesses before database close. If the process crashes before that shutdown completes, the next start records an interrupted task and preserves its DSH session ID for user-directed continuation.

## Reconsider when

- DSH's headless protocol adds interactive approval/cancel/resume support or a newer local version is installed and verified.
- A second independently useful adapter requires a stronger shared contract than the current narrow subprocess boundary.
- The actual handoff scenario does not reduce the user's context-switching burden enough to justify Noema beyond the existing agent applications.
