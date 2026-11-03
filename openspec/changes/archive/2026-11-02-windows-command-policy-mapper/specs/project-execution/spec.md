# Spec Delta

## ADDED Requirements

### Requirement: Windows command grants are mapped to exact filesystem policy
When a Windows command backend is eligible to run a project command, the system SHALL translate the user-approved workspace and external path grants into an OS-enforced filesystem policy before process creation. The policy MUST NOT grant ambient write access or read access outside the workspace and explicitly approved runtime roots.

#### Scenario: workspace and external path grants are mapped
- **WHEN** a command has a workspace grant, external path grants, and trusted runtime roots
- **THEN** the backend policy grants workspace read/write, grants each external path only its approved access, grants runtime roots read-only, and grants no other filesystem access

#### Scenario: path identity cannot be verified
- **WHEN** a granted path has an unresolved alias, reparse, or object identity that the backend cannot safely enforce
- **THEN** the system rejects the command before process creation and reports a bounded policy reason

### Requirement: Windows network grants are bound to one command identity
When a Windows command requests network access, the system SHALL enforce approved destinations through a network control bound to that command's sandbox identity. A UI approval or proxy configuration alone MUST NOT be treated as enforcement.

#### Scenario: command has approved network destinations
- **WHEN** the user approves one or more destinations for a command and the backend can enforce them for that command identity
- **THEN** only those destinations are reachable through the command's network path, and the approval does not grant access to other commands

#### Scenario: command identity or network enforcement is unavailable
- **WHEN** the backend cannot bind network policy to the command identity or cannot establish default-deny enforcement
- **THEN** the system rejects the command before process creation

### Requirement: Windows commands fail closed when backend capabilities are incomplete
The system SHALL compare every requested Windows command policy with the backend's declared and verified capabilities before process creation. Unsupported, unknown, or incompletely represented policy MUST produce a typed denial and MUST NOT fall back to host execution.

#### Scenario: requested policy is fully supported
- **WHEN** all requested filesystem, network, working-directory, and environment constraints are verified as enforceable by the selected backend
- **THEN** the system may proceed to the separate process-launch stage with the compiled policy

#### Scenario: backend capability is missing or unknown
- **WHEN** any requested constraint cannot be represented or backend readiness is unknown
- **THEN** the system returns a typed denial before process creation and does not invoke an unsandboxed runner
