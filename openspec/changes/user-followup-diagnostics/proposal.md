# User follow-up lifecycle diagnostics

## Why

User follow-ups persist across restarts and have a notification/click-navigation lifecycle, but their settings, authorization, delivery retry, and navigation paths are not represented in the diagnostic timeline. A successful OS API call also must not be presented as proof that Windows displayed a banner or that the user read it.

## What changes

- Add content-free diagnostics for authorized scheduling, settings CRUD/toggle, due claim, notification API outcome, retry/delivery terminal, notification click, and renderer navigation dispatch.
- Reuse one durable follow-up ID as execution identity; link a model-authorized schedule event to its Social turn and provider/tool-call IDs.
- Keep title, body, due text, source message ID, and source message content out of diagnostics/export.
- Preserve follow-up behavior when diagnostics fail; describe notification status as API acceptance only.

## Capabilities

### Modified capabilities

- `user-followups`: add privacy-bounded lifecycle diagnostics and keep notification, retry, and source navigation independent of diagnostic availability.

## Impact

- SocialChatService, trusted root IPC, Electron notification click and pending navigation.
- Existing diagnostics event store/query; no schema migration.
- Isolated Electron and source test coverage will join the complete Stage 2 gate.
