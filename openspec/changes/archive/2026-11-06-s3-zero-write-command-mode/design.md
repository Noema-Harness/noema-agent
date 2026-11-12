# Design

## Context

See `proposal.md` - Why. The policy is compiled in the Electron main process, validated again by the Rust runner, and projected to per-root AppContainer capability ACLs. The runner already binds every read root to an object identity and read/write capability name; path scanning covers all roots before ACL reconciliation. The current protocol has a separate policy version (`2`) from its outer helper transport version (`8`).

## Goals / Non-Goals

**Goals:**
- Make command filesystem access mode explicit from trusted caller through Rust admission.
- Run the current Social shell path in read-only mode while preserving the distinct read-write policy contract for the later mirrored-write phase.
- Keep denial before ACL mutation and child creation; retain existing path identity, hard-link/reparse scan, network deny, environment allowlist, Job, and bounded I/O controls.

**Non-Goals:**
- Implement command mirror/writeback, Git or recovery-subtree protection, or change file-tool write/journal behavior.
- Rebuild or broaden the AppContainer backend, WFP/network permissions, or user-facing command UI.
- Enable read-write mode from renderer/user-controlled request data in this phase.

## Decisions

1. **Carry a filesystem mode in the policy payload.** Add a strict `read-only` / `read-write` enum to the filesystem policy rather than interpreting an empty list implicitly. The main execution service supplies `read-only` for all current Social commands. Read-only mode requires non-empty read roots, empty write roots, and the verified workspace in read roots. Read-write mode keeps the existing invariant that the workspace and every writable external root are represented in both lists.
2. **Reject incompatible grants; do not silently weaken or widen them.** A write external grant requested for a read-only command returns a typed policy denial before ACL recovery/reconciliation. Runtime roots and external read grants remain read-only. Unknown or omitted mode is invalid.
3. **Version the policy shape independently from helper transport.** Raise policy version to `3` in JS and Rust and validate the probe-reported version before command preparation. Bind it into package manifest schema `2` and startup diagnostics; report a stale helper as `policy_version_unsupported`. Keep transport protocol version `8` unchanged because the request/response envelope and framing do not change. An old helper or malformed policy remains fail-closed.
4. **Reuse identity and ACL enforcement.** The capability planner emits one read capability per read root in read-only mode and accepts an empty write-root list only for that mode. Native policy validation enforces the same mode/list invariants; capability-name validation continues to require an exact match for every read root. The existing pre-ACL scan examines all read roots, so the zero-write mode retains hard-link, reparse, identity, traversal-limit, and ACL failure rejection.
5. **Keep the writable contract explicit for the later mirror.** Read-write mode remains represented for the future S5 command-on-mirror path and existing runner fixtures, but no current Social caller can select it. Stage 5 must bind that mode to the isolated mirror and durable batch/writeback design before enabling it.

## Risks / Trade-offs

- [Read-only roots still require ACL reconciliation to add AppContainer read capabilities] → Preserve the existing journal-before-mutation/recovery path and fail closed on any identity, scan, ACL, or evidence error.
- [A writable external grant may have been collected before mode compilation] → Return a specific typed denial; do not ignore the requested grant or start a command with surprising reduced permissions.
- [JS and native policy versions may drift] → Share the JS constant, keep the Rust version constant explicit, add contract assertions/fixtures, and reject mismatches before spawn.

## Migration Plan

Update policy mode and version in the main-process compiler, runner capability planner, Rust validator, and helper probe parser as one coordinated change. Update cross-language fixtures and specs. Run targeted Node/Rust suites, then the actual Windows zero-write child-process acceptance. Rollback is source-level: revert the coordinated policy version and mode changes together; do not modify persistent setup state or Windows security configuration as part of this change.
