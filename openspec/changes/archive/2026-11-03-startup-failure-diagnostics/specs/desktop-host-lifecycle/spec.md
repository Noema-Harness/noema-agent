## ADDED Requirements

### Requirement: Startup and data-schema outcomes are diagnosed safely
When the diagnostics event store is available, Noema MUST record successful SocialChat schema initialization and startup initialization failures with finite lifecycle codes. These events MUST NOT store raw error text or user data.

#### Scenario: SocialChat schema initializes
- **WHEN** the SocialChat store is successfully constructed
- **THEN** diagnostics records the applied schema version as a bounded migration lifecycle event

#### Scenario: Later startup step fails
- **WHEN** host initialization fails after diagnostics become available
- **THEN** diagnostics records a fixed startup failure category and phase without message, stack, path or content, while the existing error dialog still appears

#### Scenario: Root database cannot open
- **WHEN** initialization fails before a diagnostics store is available
- **THEN** Noema shows its startup error dialog and does not attempt to fabricate a persistent diagnostics event
