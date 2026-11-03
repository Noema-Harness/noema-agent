# Design

## Context

The durable task row owns prompt, model, workspace identity, checkpoint, tool ledger, and visible result. A safe resume continues that same row. Diagnostics currently use the task ID for both `taskId` and `executionId`, so repeated execution segments cannot be distinguished in a task timeline.

## Decisions

1. Use a fresh UUID as the execution ID for each accepted resume segment; initial execution keeps its task ID as its execution ID. `taskId` remains unchanged and groups all segments.
2. Pass the execution ID through service events, executor command identity, stop, and finish diagnostics. This changes trace correlation only; it does not create a new task, alter model usage attribution, or change checkpoint safety.
3. The resume event records only a finite checkpoint phase and bounded recovery error code, alongside existing task/execution IDs. No prompt, workspace path, messages, command, tool arguments, or result text enters diagnostics.
4. Corrupt or malformed checkpoint JSON must throw before task transition; the persisted task remains failed/interrupted and no executor starts.
5. Do not add an attempts table or migration. The diagnostics ledger is the existing bounded source for execution segment identity; durable task and checkpoint remain in SocialChatStore.

## Risks / Trade-offs

- Diagnostics views queried only by execution ID will show one segment. The stable task ID query returns all segments and the event links each one to the task.
- Older events continue to use `executionId === taskId`; consumers must accept both the legacy and resumed forms.

## Migration

No schema migration. Existing `execution_id` and `task_id` columns already support distinct identifiers.
