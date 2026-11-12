# Proposal

## Why

Noema currently asks the model to create persistent agents with a name and role description, but does not clearly require the name to express the role. This can produce invented personal names and make execution agents look like simulated people instead of durable, function-specific tools.

## What Changes

- Require model-created specialists and project-team agents to use concise names that describe their continuing function or expertise.
- Do not invent realistic personal names or personal identities unless the user explicitly requests one.
- Preserve user-entered names and allow a requested persona name when the user asks for it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `specialist-agents`: establish role-based naming for model-created persistent agents and explicit user-requested personal names as an exception.

## Impact

- `apps/desktop/src/main/chat/model-tools.mjs` agent-creation schemas and Noema action guidance.
- `apps/desktop/test/main/chat/model-tools.test.mjs` and related prompt/tool-contract tests.
- Existing manually created agent profiles and saved names remain unchanged.
