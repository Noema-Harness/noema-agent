# Proposal: Bind Windows commands to the task workspace identity

## Why

SocialWork captures an immutable workspace identity for each task. File tools compare against it, but the `run_command` handoff previously sent only the path to WindowsRunnerExecutionService. That service recaptured the current path for OS policy without comparing it to the task's saved identity, so a replaced directory could be treated as the original workspace.

## What Changes

- Pass the task's immutable workspace identity with every SocialWork command request.
- Compare it with the canonical path and filesystem identity captured by the trusted Windows runner admission owner before ACL changes or child creation.
- Reject missing, malformed, or changed identity with a bounded diagnostic reason.

## Impact

- Affected capability: `project-execution`.
- No task owner, storage schema, sandbox backend, or command permission mode changes.
