# Tasks

## 1. Contracts and persistence

- [x] 1.1 Define typed official plugin manifest, status, capability, lifecycle, and diagnostic contracts; verify the contract is imported only from the intended shared/main boundaries.
- [x] 1.2 Add host-owned plugin state, enabled-state, and schema-version tables through a forward-only RootStore migration; verify existing database initialization remains additive and migration rollback is possible.
- [x] 1.3 Implement bounded namespace state facade and plugin-scoped transactional migrations; verify malformed/oversized values and foreign namespace access are rejected.

## 2. Host lifecycle

- [x] 2.1 Implement compile-time registry validation for unique IDs, API compatibility, dependency graph, and allowlisted capabilities; verify missing/cyclic dependencies and unknown capabilities return typed unavailable states.
- [x] 2.2 Implement ordered start/reverse stop, persistent enable/disable, resource disposal, and plugin-local error recovery; verify a plugin error does not escape to core startup.
- [x] 2.3 Connect bounded lifecycle events to the existing diagnostics owner and stable identity; verify diagnostic sink failure cannot change host/core outcomes.

## 3. Composition and acceptance

- [x] 3.1 Integrate the host at the main composition boundary without migrating existing core owners; verify no root/social/team/executor service is silently wrapped as a plugin.
- [x] 3.2 Add isolated official sample consumer and lifecycle/migration/failure tests for the S1 gate; verify sample state uses only its namespace and only declared capabilities.
- [x] 3.3 Update architecture facts and validate the OpenSpec change; run the package tests only with the complete Stage 1 gate after S1-08.
