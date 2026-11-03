# Proposal

## Why

B1 now persists a bounded local event timeline, but users cannot inspect it in Noema. The existing diagnostics CLI can export prompts, messages, task results and workspace paths, so it is too broad to reuse as the default in-app report.

## What Changes

- Add a read-only DiagnosticsQuery API that joins event metadata with provider usage and task/step status through their existing owners.
- Add an in-app view for recent executions and filtered timelines, including explicit indicators for known coverage gaps.
- Add a user-triggered export preview and versioned local report containing only allowlisted diagnostic events and usage metadata; exclude prompts, messages, task result text, workspace paths, command text and credentials.
- Persist provider request, execution and turn IDs with ModelUsageStore rows so token/cache metrics join the B1 request events without copying usage ownership.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-execution`: expose local execution timelines and a scoped, user-triggered diagnostics report while preserving trusted IPC and sensitive-data boundaries.

## Impact

- `DiagnosticsEventStore`, `ModelUsageStore`, SocialChatStore read APIs and a new main-process diagnostics query/export service.
- Root IPC and preload diagnostics methods; SocialChatApp diagnostics view and export preview.
- `project-execution` spec scenarios and focused tests. No telemetry exporter, real model request or new dependency.
