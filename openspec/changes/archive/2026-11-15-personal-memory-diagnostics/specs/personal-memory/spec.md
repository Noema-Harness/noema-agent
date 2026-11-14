## ADDED Requirements

### Requirement: Personal memory operations have queryable diagnostic identity

The system SHALL record bounded diagnostic events for personal memory authorization, retrieval, and operation outcomes, and for settings list, toggle, add, update, and delete actions. Social tool events SHALL use the current turn identity and include provider request/tool-call identities when available. Settings events SHALL have an independently queryable execution identity.

#### Scenario: Personal memory retrieval returns no matches

- **WHEN** Noema searches personal memory and finds no matching entry
- **THEN** the timeline records a content-free retrieval miss linked to the active Social turn and tool call

#### Scenario: Memory settings action completes

- **WHEN** the user lists, toggles, adds, updates, or deletes a memory in settings
- **THEN** the timeline records the fixed action and outcome under a queryable execution identity

### Requirement: Personal memory diagnostics protect content and business outcomes

Diagnostic events and default exports SHALL NOT contain memory text, search queries, memory identifiers, source message identifiers, or source message content. Failure to write diagnostics SHALL NOT change a memory operation result or replace its original error.

#### Scenario: Diagnostic content is exported

- **WHEN** personal memory events are included in a default diagnostic export
- **THEN** the export omits memory text, queries, memory identifiers, and source identifiers or content

#### Scenario: Diagnostics storage is unavailable

- **WHEN** a memory operation succeeds or fails while diagnostic recording is unavailable
- **THEN** the original memory result or store error is preserved

#### Scenario: Initial memory list cannot be loaded

- **WHEN** the user opens the personal memory panel and the local list request fails before any list has loaded
- **THEN** the interface SHALL show a recoverable load error instead of claiming that the list is empty, SHALL offer an in-place retry, and SHALL keep the list count unknown until a successful response
