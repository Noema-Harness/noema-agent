# Tasks

## 1. Main-process status and recovery boundary

- [x] 1.1 Add a read-only database health query returning only `healthy`, `problem`, or `unavailable`; test success, SQLite-reported damage, unavailable/closed connection, and prove raw errors never cross IPC.
- [x] 1.2 Add trusted main-process IPC to open only `app.getPath('userData')`; test renderer path arguments are ignored/rejected and path/open errors return bounded results.
- [x] 1.3 Make startup database failure offer explicit “open data folder” and “exit” actions; test the folder opens only after the first action and no database mutation occurs.

## 2. User-facing diagnostics and integration

- [x] 2.1 Add on-open/refresh health state and loading/error messages to diagnostics plus a user-initiated recovery-folder button and close-before-manual-recovery guidance; add renderer behavior tests.
- [x] 2.2 Verify IPC/preload typing, accessibility labels, diagnostics exports remain path-free, package startup/tray smoke, TypeScript, source:check, changed-file lint/format, OpenSpec strict and `git diff --check`.

## Workflow follow-up

- Archive after tracked work and strict validation pass; update the `desktop-host-lifecycle` specification and F1 progress.
- Actual Windows userData/DPAPI preservation through Squirrel install, upgrade and uninstall remains a target-machine acceptance gate after D3 target-machine sandbox acceptance; no ESU/UBR threshold applies.
