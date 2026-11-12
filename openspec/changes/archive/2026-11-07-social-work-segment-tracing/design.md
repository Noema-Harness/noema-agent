# Design: SocialWork execution segment tracing

## Context

SocialWork already owns a durable task ID and creates a new execution ID for each run or resume. The provider client already accepts separate usage interaction, execution, and turn IDs. The gap is propagation: the executor previously received only the task interaction ID, causing request and usage data to collapse multiple segments into one identity.

## Decision

Pass the durable task ID, current segment execution ID, and source Social turn ID through SocialWorkService into NoemaProjectExecutor and the provider request. Keep the IDs distinct when converting provider request events into diagnostics: task ID is the interaction/grouping key; segment ID is the execution key.

The original source turn is loaded from the durable source message on resume. Missing source-turn identity remains null rather than being inferred from a later resume interaction.

## Safety and persistence

No new durable owner or schema is needed. Task/checkpoint persistence remains in SocialChatStore. Diagnostics continue to store only bounded metadata and IDs. Tests use a temporary file-backed SQLite database and close/reopen it between resume attempts to verify continuity without claiming a separate OS-process restart test.

## Validation

At the Stage 4 gate, run the complete stage suite and verify provider request/usage identity, task-level diagnostic retrieval, multi-resume continuity, and content redaction. The package-level test is not a substitute for the full Stage 4 acceptance gate.
