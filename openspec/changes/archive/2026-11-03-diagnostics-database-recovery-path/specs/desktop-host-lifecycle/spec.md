## ADDED Requirements

### Requirement: Local diagnostics report database health on demand
Noema MUST offer an on-demand, read-only integrity check for the open application database and show only a finite health status. The check MUST NOT run automatically during startup, and diagnostics MUST NOT expose raw SQLite errors, paths, or user data.

#### Scenario: Database integrity check succeeds
- **WHEN** the user opens or refreshes local diagnostics and the SQLite quick check succeeds
- **THEN** diagnostics shows that the database check passed

#### Scenario: Database integrity check reports a problem
- **WHEN** the SQLite quick check reports a problem or cannot run
- **THEN** diagnostics shows a bounded problem or unavailable status without the SQLite error text and continues to show other available diagnostics

### Requirement: User can open the fixed data directory for recovery
Noema MUST provide a user-initiated action to open its application data directory from diagnostics and from the startup error dialog when database initialization fails. The directory MUST be selected by the main process; the renderer MUST NOT provide or alter the path. Noema MUST NOT automatically restore, replace, or delete database or snapshot files.

#### Scenario: User opens the recovery location
- **WHEN** the user chooses the data-directory action
- **THEN** the operating system opens Noema's fixed application data directory and Noema explains that manual file recovery requires closing the application first

#### Scenario: Startup database initialization fails
- **WHEN** the application cannot initialize its database
- **THEN** the startup dialog offers the data-directory action and exiting, without opening the directory automatically
