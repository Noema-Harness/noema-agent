## ADDED Requirements

### Requirement: Provider requests retain distinct task and segment identities
Every SocialWork provider request MUST use the durable task ID as its interaction identity and the current execution segment ID as its execution identity. Resuming a task MUST use a new execution identity while keeping the same task identity.

#### Scenario: Resumed task request is attributed to its new segment
- **WHEN** a user explicitly resumes a permitted task from a checkpoint
- **THEN** the request and usage records retain the same durable task ID and use the new segment execution ID

### Requirement: Provider request preserves source-turn identity
When a SocialWork task has an originating Social turn, every provider request MUST retain that turn ID in request and usage records. A missing source turn MUST remain absent rather than being inferred from a later resume action.

#### Scenario: Initial or resumed request retains its source turn
- **WHEN** a task has an originating Social turn and makes an initial or resumed provider request
- **THEN** the request and usage records use that original turn ID

#### Scenario: Request diagnostic identity is safe
- **WHEN** the provider request emits a diagnostic event
- **THEN** it retains the task and segment IDs and contains no prompt, checkpoint, path, tool argument, command, or result content
