# Proposal: SocialWork execution segment tracing

## Why

Resuming a durable SocialWork task creates a new execution segment, but provider request records currently reuse the task ID as their execution identity. This makes a long task's provider usage and diagnostics impossible to attribute to the specific resume segment.

## What Changes

- Keep the durable task ID as the interaction/grouping identity.
- Give every execution segment its own execution ID and propagate the original source turn ID to provider request and usage records.
- Preserve these identities through request diagnostics without exposing prompts, checkpoint contents, paths, tool arguments, or results.
- Verify identity continuity across SQLite close/reopen/resume cycles.

## Impact

- Affected capability: `project-execution`.
- No new task owner, execution engine, or persistence table is introduced.
- Existing task and checkpoint behavior remains owned by SocialChatStore and SocialWorkService.
