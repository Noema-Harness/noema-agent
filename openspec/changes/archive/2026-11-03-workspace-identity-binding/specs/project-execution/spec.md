## ADDED Requirements

### Requirement: Project tasks bind to a verified workspace object

The system MUST resolve a user-selected workspace in the trusted main process and capture a versioned filesystem identity for the directory before admitting project work. It MUST persist the identity with the task, and for project tasks it MUST bind the project to that workspace. Missing, invalid, or unavailable identity metadata MUST fail closed before task creation.

#### Scenario: First task binds a project

- **WHEN** a user starts work for an unbound project and explicitly selects an accessible directory
- **THEN** the system resolves the canonical directory and captures its filesystem identity
- **AND** the project binding and immutable task snapshot are stored before execution starts

#### Scenario: Existing binding still matches

- **WHEN** a user selects a directory whose canonical path and filesystem identity match the project's binding
- **THEN** the task is admitted with a new immutable identity snapshot

#### Scenario: Project workspace changed

- **WHEN** a selected path or its filesystem identity differs from the project's binding
- **THEN** the system pauses before task creation and asks the user to confirm rebinding or cancel
- **AND** cancellation creates no task and changes no project binding
- **AND** confirmation updates the project binding only when no project task is active

#### Scenario: Identity capture fails

- **WHEN** the selected path is missing, is not a directory, or the filesystem identity cannot be captured
- **THEN** the system rejects admission before creating a task or starting an executor

### Requirement: Resume validates the saved workspace identity

Before resuming a task, the system MUST recapture the directory identity and compare it with the immutable task snapshot. Missing legacy snapshots, path changes, replacement directories, or identity capture errors MUST deny resume without changing task status or replaying an action.

#### Scenario: Workspace still matches on resume

- **WHEN** the saved path resolves to the same canonical directory and filesystem identity
- **THEN** the system may continue existing resume admission checks

#### Scenario: Workspace moved or replaced

- **WHEN** the saved path is missing, resolves elsewhere, or has a different filesystem identity
- **THEN** the system rejects resume without mutating the task
- **AND** tells the user to select the intended workspace and start a new task

#### Scenario: Legacy task has no identity

- **WHEN** a task created before this requirement has no saved workspace identity
- **THEN** the system preserves its history but rejects automatic resume

### Requirement: Workspace identity diagnostics protect local data

Workspace identity diagnostics MUST use stable bounded reason codes and MUST NOT include absolute paths, filesystem device identifiers, file indexes, or directory contents.

#### Scenario: Identity decision is traced

- **WHEN** identity capture, bind, rebind, or resume comparison completes
- **THEN** a local diagnostic event records the decision and schema version
- **AND** sensitive filesystem identity fields are omitted
