## MODIFIED Requirements

### Requirement: Windows command grants are mapped to exact filesystem policy
When a Windows command backend is eligible to run a project command, the system SHALL translate the trusted command mode and user-approved workspace and external path grants into an OS-enforced filesystem policy before process creation. The policy MUST NOT grant ambient write access or read access outside the workspace and explicitly approved runtime roots. A missing or unknown filesystem mode MUST be rejected.

#### Scenario: explicit read-only workspace command
- **WHEN** the trusted main-process caller requests read-only mode with a verified workspace, external read grants, and runtime roots
- **THEN** the workspace is present in read roots, write roots are empty, every capability ACL is read-only, and no other filesystem access is granted
- **AND** any child-process write to the workspace is rejected by Windows ACL enforcement
- **AND** startup diagnostics expose validated backend, policy, and transport versions without executable paths

#### Scenario: read-only mode rejects write grants
- **WHEN** a read-only command includes an external write grant or a write root
- **THEN** the system returns a typed denial before ACL mutation or process creation

#### Scenario: workspace and external path grants are mapped
- **WHEN** a trusted caller explicitly requests read-write mode with a workspace grant, external path grants, and trusted runtime roots
- **THEN** the backend policy grants workspace read/write, grants each external path only its approved access, grants runtime roots read-only, and grants no other filesystem access
- **AND** the policy is not inferred from an omitted mode

#### Scenario: path identity cannot be verified
- **WHEN** a granted path has an unresolved alias, reparse, or object identity that the backend cannot safely enforce
- **THEN** the system rejects the command before process creation and reports a bounded policy reason
