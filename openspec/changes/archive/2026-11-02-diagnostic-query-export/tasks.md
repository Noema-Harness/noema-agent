# Tasks

## 1. Usage identity and query owner

- [x] 1.1 Add nullable request/execution/turn ID columns to ModelUsageStore, retain old interaction semantics, and test old-schema migration plus exact ID persistence.
- [x] 1.2 Implement bounded DiagnosticsQueryService recent/timeline reads across event, usage and task owners; test request-ID joins, safe task projection, truncation and explicit unlinked/unsupported coverage.
- [x] 1.3 Implement versioned export preview/report projection and local save orchestration; test canceled save, write failure isolation, schema fields, and absence of sentinel prompt/message/result/path/command/credential/error text.

## 2. Trusted main-process interface

- [x] 2.1 Add narrow diagnostics query/preview/export root IPC handlers and preload contracts; test trusted-main acceptance plus child/foreign-frame rejection before owner access or save dialog.
- [x] 2.2 Wire diagnostics owners and native save dialog in main; run typecheck and focused IPC/query tests with no real provider request.

## 3. In-app diagnostics view

- [x] 3.1 Add a SocialChatApp entry and accessible diagnostics dialog for recent executions, timeline detail, usage/task/tool status, loading/empty/error states and visible coverage gaps; verify typecheck and renderer behavior tests.
- [x] 3.2 Add exact-scope export preview with save/cancel feedback; verify rendered preview matches serialized safe DTO and no automatic upload path exists.

## 4. Integrated validation

- [x] 4.1 Run focused event/usage/query/IPC/renderer suites, typecheck, source:check, strict OpenSpec validation and desktop startup smoke; verify no real model request and no sensitive output in a synthetic export.

## Workflow follow-up

- Archive the completed change and verify the updated project-execution spec.
