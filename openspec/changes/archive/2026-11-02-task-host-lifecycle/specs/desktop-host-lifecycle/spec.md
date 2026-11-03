## ADDED Requirements

### Requirement: Windows session end uses bounded task shutdown
Windows shutdown, restart, or user logout MUST be identified as `system_shutdown` and routed through the main-process shutdown owner. The host MUST persist the shutdown intent before stopping services, wait no longer than 12 seconds, clear the intent after clean completion, and preserve it if shutdown times out or fails. The reason MUST remain distinct from an explicit application exit.

#### Scenario: tasks stop during system shutdown
- **WHEN** Windows requests session end and active work settles within 12 seconds
- **THEN** the host records `system_shutdown`, drains services, clears the durable intent, and exits

#### Scenario: shutdown deadline is exceeded
- **WHEN** active work does not settle within 12 seconds
- **THEN** the host records a timeout and leaves the durable intent so startup can classify active tasks as `system_shutdown_incomplete`

#### Scenario: process is lost without a shutdown intent
- **WHEN** startup finds active tasks and no durable shutdown intent
- **THEN** it classifies recovery as `process_crash`, leaves possible side effects unknown, and does not replay them
