# Personal memory lifecycle diagnostics

## Why

Personal memory already has bounded storage, main-chat admission, and settings CRUD, but those business actions are not independently traceable. A memory search failure or settings error can therefore be difficult to locate in Noema's diagnostic timeline.

## What changes

- Record fixed, content-free lifecycle events for memory tool authorization and retrieval/save/update/forget outcomes, linked to the Social turn, provider request, and tool-call IDs when available.
- Record settings list/toggle/add/update/delete outcomes with a local execution ID.
- Keep memory text, search queries, source message bodies, and memory IDs out of event fields and exports.
- Treat diagnostics write failure as independent from memory behavior.

## Capabilities

### Modified capabilities

- `personal-memory`: add privacy-bounded lifecycle diagnostics and preserve normal behavior when the diagnostics sink is unavailable.

## Impact

- Main-process Social chat and trusted root IPC.
- Existing diagnostics event store and timeline query; no schema migration.
- Additional source-level tests, held for the complete Stage 2 gate.
