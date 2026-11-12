# official-plugin-host

## ADDED Requirements

### Requirement: Official plugins declare a bounded host contract

Noema MUST recognize only official plugin descriptors registered by application code. Each descriptor MUST have a stable plugin ID, plugin version, host API version, required plugin dependencies, and declared capabilities. The host MUST validate descriptor shape, ID uniqueness, dependency availability, API compatibility, and the capability allowlist before starting a plugin. Unsupported descriptors MUST remain unavailable with a typed reason and MUST NOT prevent core startup.

#### Scenario: Incompatible plugin is isolated

- **GIVEN** an official plugin declares an unsupported host API version or missing dependency
- **WHEN** the host resolves the startup graph
- **THEN** the plugin is reported unavailable with a stable reason code
- **AND** the host does not call its migration or start hook
- **AND** unrelated plugins and Noema core remain available

#### Scenario: Unknown capability is rejected

- **GIVEN** an official plugin declares a capability not in the host allowlist
- **WHEN** the host validates the descriptor
- **THEN** the plugin is not started
- **AND** no undeclared host service is exposed to it

### Requirement: Plugin lifecycle is independently controllable

The host MUST keep enabled state per plugin and expose typed runtime status for registered, disabled, starting, active, stopping, and failed plugins. Disabling a plugin MUST stop its owned resources and unregister its contributions; it MUST preserve plugin data unless an explicit later product operation decides otherwise. A stop failure MUST remain visible as failed or stop-unknown and MUST NOT stop Noema core.

#### Scenario: Disabled plugin does not start

- **GIVEN** an installed official plugin is disabled
- **WHEN** Noema starts or the plugin is disabled during runtime
- **THEN** the plugin start hook is not active
- **AND** its owned resources and contributions are disposed
- **AND** its namespaced data remains available for later re-enable

#### Scenario: Plugin start failure does not abort startup

- **GIVEN** an enabled compatible plugin throws during migration or start
- **WHEN** the host starts plugins
- **THEN** that plugin is marked failed with a bounded error classification
- **AND** Noema core and unrelated plugins continue startup

### Requirement: Plugin state is namespaced and versioned

The host MUST provide plugin state only through a namespaced storage facade; plugin code MUST NOT receive the shared SQLite connection. Plugin state keys and serialized values MUST be size-bounded and validated. Each plugin MUST declare a monotonically increasing state schema version. Migration steps MUST execute transactionally for that plugin namespace; a failed migration MUST roll back its writes and stored schema version without blocking core startup.

#### Scenario: Successful migration advances only its namespace

- **GIVEN** a plugin namespace at schema version N and a valid migration to N+1
- **WHEN** the plugin is enabled
- **THEN** migration data and the new version commit atomically for that plugin
- **AND** other plugin namespaces and core records remain unchanged

#### Scenario: Failed migration rolls back plugin state

- **GIVEN** a migration throws after writing plugin data
- **WHEN** the host attempts migration
- **THEN** the plugin namespace and stored version remain at their prior committed state
- **AND** the plugin is unavailable with a migration failure reason
- **AND** Noema core remains available

### Requirement: Plugins receive only declared capabilities

The host MUST construct each plugin context from only the host services corresponding to its validated capability declarations. The initial contract MUST limit capabilities to namespaced state and structured diagnostics. Manifest validation and capability declaration MUST NOT be described as an operating-system sandbox for trusted in-process code.

#### Scenario: Undeclared service is absent from plugin context

- **GIVEN** a plugin declares only the state capability
- **WHEN** the host starts it
- **THEN** its context contains namespaced state but no diagnostics, model, tool, IPC, or database service

### Requirement: Plugin lifecycle outcomes use global diagnostics

Plugin lifecycle and runtime failures MUST be recorded through the global diagnostics owner with plugin ID, operation, status, and stable error code. Diagnostic failure MUST NOT change plugin or core business outcomes.

#### Scenario: Lifecycle events are queryable

- **GIVEN** a plugin starts, stops, migrates, or fails
- **WHEN** the host completes that operation
- **THEN** a bounded diagnostic event is emitted with plugin identity and outcome
- **AND** the event is available through the existing global diagnostic query/export path

#### Scenario: Diagnostic sink failure is isolated

- **GIVEN** the diagnostic sink fails while a plugin lifecycle operation is running
- **WHEN** the operation completes
- **THEN** the plugin lifecycle result remains authoritative
- **AND** Noema core remains available

### Requirement: Plugin installation is limited to trusted application code

Noema MUST NOT execute arbitrary package, project, or downloaded plugin code through this capability. Official plugin descriptors and implementations MUST be registered by the application build. The host MUST NOT imply that manifest validation or capability declaration provides process, filesystem, or network sandboxing.

#### Scenario: External descriptor cannot load code

- **GIVEN** a descriptor is supplied from user data, workspace content, or a downloaded package
- **WHEN** the host resolves its registry
- **THEN** it is not accepted as executable plugin code
- **AND** ordinary user data remains unchanged
