# Tasks

## 1. Retirement inventory and specification

- [x] 1.1 Complete a source-backed inventory of Root public APIs, IPC handlers, preload methods, renderer routes/actions, shortcuts/readiness listeners, startup recovery, event producers, writable data and historical read paths; identify every remaining Social caller of shared provider/model APIs and root event channels. Evidence: `.work/planning/research/noema/ROOT_AGENT_HARNESS_AUDIT.md`, source-checked against current root IPC/preload/renderer/startup callers on 2026-11-05.
- [x] 1.2 Add the `legacy-history-archive` query/export spec and update `project-execution` authorization/event requirements so retired consent and Root/DSH activity cannot authorize or generate new activity; `openspec validate retire-root-legacy-operations --strict --no-interactive` passes.

## 2. Read-only history access

- [x] 2.1 Implement a main-owned archive query service for Root turns/messages, DSH tasks/events, captures, Codex snapshots/consents, and interaction adjustments using bounded category-specific projections and pagination.
- [x] 2.2 Add preview/save export IPC that obtains its destination in main, supports category selection, preserves source IDs/provenance and partial/unavailable markers, and leaves source database rows unchanged.
- [x] 2.3 Add an independent archive view with source labels, query/empty/error/partial states and export preview/save/cancel; expose no old send/edit/delete/stop/retry/resume/consent controls.

## 3. Close active legacy paths

- [x] 3.1 Disable Root/Legacy turn sends, retries, stops, capture writes/discussion, workspace preference/grants, Codex thread discovery/import/consent admission, interaction-adjustment writes, DSH dispatch/retry/resume, and their bridge methods/handlers; remove the direct RootAgent/RootStore capture mutation and discussion APIs; preserve historical captures only through bounded archive reads; preserve only required shared Social provider/model operations and event subscriptions.
- [x] 3.2 Remove the Quick Capture global shortcut, listener, ready handshake, pending request and write IPC; ensure startup and shutdown never resume legacy tasks or create new Root/DSH lifecycle events.
- [x] 3.3 Retire the `#legacy` operational renderer route and keep its historical information reachable only through the independent read-only archive view.

## 4. Stage acceptance

- [x] 4.1 Add source-level boundary coverage for every route, IPC, preload method, shortcut, recovery trigger and event producer, including proof `#legacy` resolves to Social while only `#archive` opens read-only history, trusted sender/frame negative cases and proof that shared Social provider/model calls remain live.
- [x] 4.2 With a temporary migrated RootStore fixture, query/export every historical category, exercise pagination/corrupt-row behavior, verify archive reads cannot invoke writers/providers/DSH and confirm source row counts/content remain unchanged.
- [x] 4.3 Run renderer/CDP archive states, including capture query/export preview with no edit/delete controls, and the complete Stage 2 gate after S2-01–S2-07 are implemented; update the retirement matrix and progress evidence before archiving this change.
