# Proposal

## Why

Noema resumes a durable task under the same task ID, but diagnostics currently also reuse that ID as the execution ID. Repeated safe resumes therefore appear as one undifferentiated execution. This makes it harder to trace which checkpoint and recovery reason began each run segment.

## What Changes

- Give every execution segment a stable execution ID distinct from the durable task ID when resuming.
- Keep task ID as the durable grouping key; associate tool, command, phase, stop and finish diagnostics with the segment execution ID.
- Record the safe checkpoint phase and bounded recovery reason on the resume event.
- Prove corrupt checkpoint payloads fail closed without changing a recoverable task into a running task.

## Capabilities

### Modified Capabilities

- `project-execution`: require diagnostics to distinguish resumed execution segments while preserving their source task, and require corrupt checkpoint recovery to fail closed.

## Impact

SocialWorkService, NoemaProjectExecutor, diagnostics event fields, and recovery tests. No database schema migration; existing execution/task ID fields support this relationship.
