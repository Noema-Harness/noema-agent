# Proposal

## Why

F1 requires users to see whether Noema's local database is readable and have a clear recovery entry point. Current diagnostics show schema versions but not integrity status, and no UI action opens the app data folder containing the database and migration snapshots.

## What Changes

- Add an on-demand, read-only SQLite health check that returns only a finite status; do not expose SQLite error text or run checks automatically during startup.
- Add a main-process-owned action that opens Noema's fixed user data folder, with no renderer-supplied path.
- Show concise recovery guidance and the check result in local diagnostics. Add the same folder action to the startup error dialog when the database cannot open.
- Do not automatically restore, replace, or delete the database or snapshots.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `desktop-host-lifecycle`: expose read-only local database health and a user-initiated recovery location without disclosing personal paths in diagnostics exports.

## Impact

Electron main-process IPC, preload contract, diagnostics UI, startup error dialog, desktop lifecycle OpenSpec, and focused tests. No schema migration or new dependency.
