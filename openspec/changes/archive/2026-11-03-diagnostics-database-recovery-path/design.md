# Design

## Context

The main process owns the open `RootStore` database and knows Electron's `userData` directory. Diagnostics currently expose schema versions, while migration snapshots are saved alongside the database. Database health should be checked only when the user opens or refreshes diagnostics; database initialization failures occur before this UI is available.

## Goals / Non-Goals

**Goals:** show a fresh bounded integrity result without persisting it; make the fixed local data directory reachable both during normal operation and from the startup failure dialog.

**Non-Goals:** automatic restore, database replacement/deletion, exporting user-data paths, or changing migration behavior.

## Decisions

1. Add a trusted main-process IPC query that runs SQLite `PRAGMA quick_check` against the already-open `RootStore` connection only on request. Map exact success to `healthy`, any returned issue to `problem`, and a closed database/query exception to `unavailable`; never return SQLite text. Do not add this transient result to persistent diagnostics or export.
2. Add a no-argument main-process data-folder action using `app.getPath('userData')`. The renderer cannot supply a path. The action reports only opened/failed/canceled status.
3. In the diagnostics view, check health when the dialog opens and on refresh, show a neutral failure state, and provide a button to open the data directory with a short instruction to close Noema before manual file operations.
4. Replace the non-interactive startup error box with a two-choice error dialog. It opens the same fixed directory only after the user selects it; otherwise it exits. Preserve the current startup error message and do not attempt a database write or recovery in this path.

## Risks / Trade-offs

- [Quick check can take time on a large database] → Run only on explicit diagnostics open/refresh; show a loading state.
- [Opening the folder does not repair a damaged database] → Label the action as a recovery location and explicitly state that Noema will not alter files and must be closed before manual recovery.
- [Database is unavailable before startup diagnostics load] → Keep the existing startup error information and offer only the fixed folder action; never fabricate a health result.

## Migration Plan

No schema migration or persistent state. Older versions remain unaffected. On rollback, remove the IPC/UI affordance; no database files are changed by this feature.
