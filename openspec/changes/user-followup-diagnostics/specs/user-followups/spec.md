## ADDED Requirements

### Requirement: Follow-up lifecycle has queryable diagnostic identity

The system SHALL record bounded diagnostic events for authorization and scheduling, settings operations, due claims, notification API outcomes, retry or delivery terminal state, notification clicks, and source-navigation dispatch. A model-created schedule SHALL link to its Social turn and provider/tool-call identities. Each follow-up lifecycle SHALL be queryable by a stable execution identity.

#### Scenario: User schedules an authorized follow-up

- **WHEN** the Noema main chat creates an explicitly authorized reminder
- **THEN** the timeline links authorization and creation to the Social turn, provider request, and tool call without recording reminder content

#### Scenario: Notification API accepts a due reminder

- **WHEN** the Electron notification handler accepts a due reminder
- **THEN** the timeline records API acceptance and delivery state without claiming that Windows displayed a banner or the user read it

#### Scenario: Notification click is waiting for renderer readiness

- **WHEN** the user clicks a reminder notification before the Social renderer is ready
- **THEN** the click is recorded, the source target remains pending, and navigation dispatch is recorded when it is sent to the ready renderer

#### Scenario: Diagnostics storage fails

- **WHEN** diagnostic writes fail during a follow-up lifecycle action
- **THEN** the existing schedule, notification, retry, or navigation result is preserved

### Requirement: Follow-up diagnostics protect content and business outcomes

Diagnostic events and default exports SHALL NOT contain reminder titles/bodies, source message IDs, or source message content. Diagnostic failures SHALL NOT change scheduling, delivery, retry, click, or navigation behavior.

#### Scenario: Diagnostic content is exported

- **WHEN** follow-up events are included in a default diagnostic export
- **THEN** the export omits reminder content and source message IDs or content

### Requirement: Follow-up management distinguishes recovery and source states

The follow-up panel SHALL distinguish an unavailable list from an empty list and offer an in-place retry. It SHALL render due dates in the device's local time zone and identify that zone. A pending reminder past its due time SHALL be labeled overdue; a failed notification attempt SHALL be labeled as waiting for retry. If the source message was deleted while its chat remains, the panel SHALL show that the source message is unavailable and SHALL NOT offer a dead source link.

#### Scenario: The initial follow-up list cannot be read

- **WHEN** the user opens the follow-up panel and its first local list request fails
- **THEN** the panel shows a recoverable error instead of an empty-list claim, keeps the count unknown, and offers an in-place retry

#### Scenario: The reminder source message was deleted

- **WHEN** a saved reminder retains its source chat but the referenced source message no longer exists
- **THEN** the panel identifies the message as deleted and does not show a source-navigation action
