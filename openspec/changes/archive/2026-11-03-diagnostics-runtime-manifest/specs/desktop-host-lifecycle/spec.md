## ADDED Requirements

### Requirement: Local diagnostics identify the application runtime and applied schemas
Diagnostics views and exports MUST include an allowlisted runtime manifest with product/runtime versions, platform and architecture, packaged status, and the applied SocialChat and diagnostics schema versions when readable. The manifest MUST omit personal paths and content.

#### Scenario: User reviews a diagnostic report
- **WHEN** local diagnostics are opened or an export preview is prepared
- **THEN** the report identifies the Noema/Electron/Node build context and applied data schemas without including user paths or conversation content

#### Scenario: Migration metadata cannot be read
- **WHEN** a migration ledger is absent or unreadable
- **THEN** its version is reported as unknown and normal diagnostics remain available without changing database state
