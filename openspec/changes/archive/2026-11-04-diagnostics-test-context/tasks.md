# Tasks

## 1. Local context export

- [x] 1.1 Add bounded read-only RootStore and SocialChatStore context accessors; verify only selected turn/task context is returned.
- [x] 1.2 Add per-export opt-in, credential redaction, limits and versioned report fields; verify default exports remain content-free and opted-in reports include only selected context.
- [x] 1.3 Add UI checkbox, sensitivity warning and visible preview; verify IPC carries only the explicit option and save remains local/user-selected.

## 2. Lifecycle tracing

- [x] 2.1 Record RootAgent turn start/terminal events; verify event IDs and failure isolation with root-agent tests.
- [x] 2.2 Record DSH task/process lifecycle events with bounded metadata; verify success, failure, stop and timeout paths in adapter/service tests.
- [x] 2.3 Reconcile truthful coverage gaps and update diagnostics UI/spec; verify exported coverage accurately states unavailable detail.

## 3. Integration

- [x] 3.1 Run focused diagnostics, root-agent and DSH tests, then `npm run check` and strict OpenSpec validation.
- [x] 3.2 Review data boundaries and complete diff; verify no automatic upload, source-file export or database migration was added.

## Workflow follow-up

- Archive the change after implementation and validation are complete.
