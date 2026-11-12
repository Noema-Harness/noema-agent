# Design: Bind Windows commands to the task workspace identity

## Decision

`NoemaProjectExecutor` passes its already validated `activeWorkspaceIdentity` to the trusted command runner for every `run_command`. `WindowsRunnerExecutionService` requires a valid versioned identity, captures the current canonical workspace root and native filesystem identity, and compares canonical path, device/volume, and file index before external-access prompts, ACL transactions, or child creation. A mismatch fails closed with `workspace_identity_changed`; missing or invalid identity fails with `workspace_identity_unavailable`.

## Ownership and lifecycle

The persisted task snapshot remains the source of the expected identity. NoemaProjectExecutor transports it; WindowsRunnerExecutionService owns admission and makes the final comparison using the same captured root later compiled into the OS policy. The native runner continues its existing identity-bound admission checks. The comparison does not add another workspace scanner or change hard-link/reparse validation.

## Diagnostics and recovery

Only bounded reason codes and existing task/request identities are recorded. Paths and filesystem identifiers remain in the trusted main process and are never emitted. Denial occurs before ACL mutation and process creation, with `not_applied` effect status; the task remains inspectable and may be retried after the intended workspace is restored.

## Validation

Add unit coverage for missing identity, mismatched root identity, and executor propagation. Keep the existing Windows live runner acceptance supplied with the identity captured from its temporary workspace. Include these cases in the Stage 4 gate; do not run the gate until all Stage 4 implementation is complete.
