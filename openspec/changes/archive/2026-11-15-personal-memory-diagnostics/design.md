# Design

## Context

Personal memory has two write/read entry points: Noema's Social tool and the settings dialog over trusted main-frame IPC. The existing generic tool trace links request and tool-call identity, but it does not distinguish memory retrieval from a memory mutation. Settings CRUD currently has no business-level diagnostic event.

## Decisions

- Use module `social.memory` and fixed operation/status/error-code values. Never include memory IDs, query text, memory text, source message IDs, or store error text.
- Tool events reuse the current Social turn ID and the active `manage_personal_memory` provider request/tool-call IDs. Record authorization and operation result separately; search emits only hit/miss.
- Settings IPC assigns a fresh execution ID to each list/toggle/add/update/delete action, making each action independently queryable.
- Catch diagnostic callback exceptions at the memory boundary. A diagnostics failure cannot change a successful result or hide the original store error.
- Keep the existing diagnostics schema and allowlist; no migration is required.

## Risks

- Business events are intentionally low detail: they identify the operation and outcome but cannot reveal which memory item changed.
- A diagnostics sink failure can leave a gap; the existing diagnostics health indicator remains responsible for surfacing persistence failure.
