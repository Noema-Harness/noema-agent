# Proposal

## Why

Noema has separate route IDs, turns, tasks, provider usage rows, tool steps and renderer health logs. Their IDs do not consistently identify one user operation, so a task failure or token spike cannot yet be followed across the main harness. A local, versioned event ledger should correlate facts without storing prompts, tool arguments or response bodies.

## What Changes

- Add a local diagnostics event owner with versioned schema, allowlisted metadata, bounded retention, query by execution/task, and non-fatal write failures.
- Keep one application execution ID for the main process lifetime; use stable turn/task execution IDs and separate provider request/tool call IDs.
- Connect route/authorization, provider outcome, workspace task lifecycle, tool step and recovery events on the default SocialChat → SocialWork path.
- Preserve provider usage and task stores as their domain owners; the event ledger stores references and safe status facts only.

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`：补充版本化本机事件、跨模块关联、容量上限与诊断写入失败隔离要求。

## Impact

- `apps/desktop/src/main/storage/diagnostics-event-store.mjs`
- `apps/desktop/src/main/providers/openai-compatible-client.mjs`
- `apps/desktop/src/main/execution/social-work-service.mjs`
- `apps/desktop/src/main/chat/social-chat-store.mjs`
- `apps/desktop/src/main/main.ts`
- corresponding tests and `openspec/specs/project-execution/spec.md`

不添加 telemetry exporter、诊断 UI 或模型请求，不改变 task/provider state owners。
