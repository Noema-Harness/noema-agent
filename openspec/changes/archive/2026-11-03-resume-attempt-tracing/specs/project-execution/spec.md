## ADDED Requirements

### Requirement: Resumed execution segments have distinct diagnostic identity
Noema MUST keep the durable task ID stable when resuming and assign each resumed execution segment a distinct diagnostic execution ID. Segment diagnostics MUST retain both IDs.

#### Scenario: Safe checkpoint resume begins a new execution segment
- **WHEN** a user explicitly resumes a task from a permitted model-boundary checkpoint
- **THEN** the task ID remains the historical grouping key, a new execution ID identifies this segment, and a task-scoped diagnostic query can retrieve both the resume event and the segment events

### Requirement: Resume diagnostics identify the checkpoint without exposing content
The resume event MUST record the checkpoint phase and bounded recovery reason. Segment lifecycle diagnostics MUST use the segment execution ID and durable task ID. Diagnostics MUST NOT include checkpoint messages, prompts, workspace paths, tool arguments, command text, or result content.

#### Scenario: Safe checkpoint resume records bounded context
- **WHEN** a safe checkpoint is explicitly resumed
- **THEN** the diagnostic event records only its phase and recovery reason in addition to IDs, with no checkpoint or user content

#### Scenario: Checkpoint data is corrupt
- **WHEN** persisted checkpoint JSON is malformed before the user resumes
- **THEN** resume fails before the durable task status changes or an executor starts, and the task remains available as failed/interrupted history for inspection
