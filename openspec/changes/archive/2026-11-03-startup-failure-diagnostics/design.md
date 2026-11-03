# Design

## Context

`startNoema` initializes RootStore, a bounded DiagnosticsEventStore, migration backup, SocialChatStore and the rest of the host inside one startup try/catch. If failure occurs after diagnostics are ready, the catch can safely persist a minimal event. If opening the database itself fails, the database event sink is unavailable.

## Decisions

1. On successful SocialChatStore migration, write one `social.schema.ready` event with the existing schema version. This is a lifecycle fact; actual current version remains available in the runtime manifest.
2. On startup error, record `application.startup_failed` only if the diagnostics store is available. Error codes are mapped through a fixed allowlist; all other errors become `application_startup_failed`.
3. Details contain only a fixed initialization phase enum. Never include error message, stack, path, SQL, user content or credential.
4. A diagnostic write failure cannot replace the original startup error or prevent the existing error dialog.

## Risks / Trade-offs

- A failure opening the root database cannot be persisted to that database; the existing error dialog is the available signal.
- Generic categorized errors provide less detail than stack traces, by design. User can reproduce with the visible app version/schema manifest.

## Migration

No schema migration. Events are additive and use the existing bounded event ledger.
