# Design

## Context

See `proposal.md` for motivation and `specs/project-execution/spec.md` for the behavior contract. Current source review found:

- `SocialWorkService` is the durable task owner through `SocialChatStore`; it injects the existing `fileChangeJournal` into `NoemaProjectExecutor`.
- File tools already record one path at a time in `social_work_file_changes` and `social_work_file_change_operations`. The journal persists a preimage before mutation, verifies the postimage, and supports review/revert with a bounded diff and hash check. The current implementation stores preimages in SQLite and caps them at 1 MiB per file, 20 MiB per task, and 200 MiB globally.
- `NoemaProjectExecutor.run_command` still passes the original workspace path directly to the Windows runner. It does not create a snapshot or use the file-change journal.
- The current operation schema has `UNIQUE(step_id)`, which cannot represent one command changing many paths. The command runner capability policy currently treats its workspace as a write root and allows up to four separately authorized external roots, including write access.
- The current workspace scanner already rejects hard links, reparse points, special files, identity changes, traversal errors, and configured scan bounds. The runner supports distinct read and write roots. These are inputs to the new mechanism, not components to rebuild.

This design covers only the active SocialWork command path. Root/Legacy actions, DSH dispatch/resume, and Quick Capture remain retired; none are batch writers or recovery owners.

## Goals / Non-Goals

**Goals:**

- Make each `run_command` a bounded, attributable file-change transaction beneath its existing SocialWork task.
- Run ordinary project commands against a complete, private worktree snapshot, then synchronize safe path changes before the tool returns.
- Reuse the existing task/path review owner while recording enough durable state to survive partial sync, application exit, and restart.
- Make the native runner enforce that the original workspace and all Git metadata are read-only, while only the private worktree is writable.
- Preserve the user's explicit policy: conflict-free paths are automatically written back at command end; conflicts remain reviewable; no per-command confirmation is added.

**Non-Goals:**

- Re-enable Root/Legacy or DSH execution, merge DSH state into SocialWork, or create a second task store/file-review subsystem.
- Add Git mutation, untracked external write access, a driver, optional Windows feature, elevated setup, or ProjFS as a prerequisite.
- Promise a multi-file atomic transaction or claim that hashes provide an OS-level compare-and-swap.
- Capture arbitrary registry, network, process, or external-service effects as file changes.

## Decisions

### 1. One task owner, with a durable command-batch envelope

`SocialChatStore` remains the only durable SocialWork task and file-change owner. Add a command-batch record beneath `(task_id, execution_step_id/tool_call_id)` for lifecycle, mirror identity/location, manifest, and recovery status. Path changes continue to appear in the existing task file-change projection and reviewer. Each path operation references its command batch; a command may therefore produce any number of path records. The existing operation relation must be migrated from globally unique `step_id` to a constraint that allows multiple changed paths for one command step while still preventing duplicate application of a path operation.

File tools retain their immediate-write semantics and current journal API. They may share a task/path record with command changes, but their individual source operations remain distinguishable. Existing records and histories are preserved by additive migration. No Root/DSH adapter is created.

### 2. Ordinary full copy per command; no hard-link or overlay shortcut

Before spawn, revalidate the immutable workspace identity and run the existing boundary scan. Create a command-private directory under Noema-owned application data. Copy all ordinary workspace content required for a working project, including hidden, untracked, ignored files and build dependencies; Git metadata is handled separately below. Do not use hard links because they share file identity and writes across names. Do not use a sparse Git checkout because that omits user data and dependencies. A source manifest before and after copy, plus mirror hashes and object identities, must agree before spawn. A bounded retry may handle one transient copy race; continued churn, unsupported objects, size/count quota, insufficient disk, copy error, or identity change refuses spawn.

The command's current directory and writable capability point only at this mirror. The original selected workspace is read-only to the AppContainer. Commands that need writes to an approved additional root are refused in this phase; additional read-only roots continue through existing authorization. No real workspace write profile is available to `run_command` until batch review/recovery is integrated.

### 3. Manifest-based per-path merge with durable preimage and proposed blobs

After the runner confirms the entire process tree has ended, compare the initial mirror manifest with the final one. Record ordinary file creates, modifications, and deletions; represent renames as a delete plus a create because a final tree scan cannot prove rename intent. Track directories only as needed to create parents and remove a Noema-created directory on revert when it is empty. Do not synchronize ACL, timestamps, or other metadata as file content.

Before changing any real path, persist the batch manifest and all required before/proposed content blobs with SHA-256 validation. Small existing file-tool snapshots may remain in the current SQLite BLOB fields; command blobs use an immutable content-addressed store inside Noema-owned data, with temporary-write/flush/rename publication. SQLite references are committed only after each blob is durable. Unreferenced blobs are safe to collect; referenced blobs are never deleted until the path is kept/reverted and all batch/recovery references are resolved. Blob scanning and integrity checks occur on recovery.

For each changed path, revalidate workspace identity, ordinary-file identity, base hash, and current hash. If current still matches base, stage a same-volume replacement/backup and apply that path, then reopen and verify its resulting hash before marking it applied. If it no longer matches, preserve the proposed version as a conflict and do not overwrite that path. Deletes and creations use the same per-path state machine; directories are created only as required and deleted on revert only if still empty. A failure after some paths applied yields partial/unknown per-path states, never a claim of batch rollback. Noema coordinates its own writers with a durable workspace-level lock; external user/process edits are detected at copy, merge, and review checkpoints. Hash checking reduces races but is not advertised as an OS atomic compare-and-swap.

The command is considered ended for synchronization only after the runner confirms descendant cleanup. A normally completed or canceled/timed-out command with a known-empty process tree is diffed and conflict-safely synchronized, and its task result reports any partial command outcome. If process termination or post-run state is unknown, do not synchronize or replay; preserve mirror, blob, and ledger state for recovery. Subsequent writes to the same workspace wait until the batch is recovered or explicitly represented as unresolved.

The mirror copy and recovery blob store require hard count/byte quotas and a free-space reserve. S5-02 will measure the current Noema workspace and representative supported project trees before setting concrete defaults; values are implementation limits, not a reason to silently omit changed paths. Any exceeded limit fails before spawn when measurable, or leaves an unsynced path in durable conflict/recovery when the output size is only known after execution. A path is never synchronized without all recovery material fitting the quota.

### 4. Read-only Git metadata is enforced by ACL, not environment convention

The worktree copy excludes repository metadata. The host resolves supported Git metadata roots without executing repository hooks or treating environment variables as security controls. The runner receives a read-only capability for the original metadata and a write capability only for the mirror. The mirror may contain synthetic Git pointer metadata needed for read-only status/history queries; those paths are excluded from synchronization. `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_OPTIONAL_LOCKS=0` may improve common Git behavior but are conveniences only; Windows capability ACLs are authoritative.

Support ordinary repositories and linked-worktree/submodule/nested-repository layouts when every metadata root is safely resolved and fits bounded root limits. External Git metadata receives read access only through the existing user authorization path. If a metadata target escapes allowed roots, aliases another protected identity, cannot be parsed, or cannot be granted read-only, the command is rejected before spawn. Attempts to write real index, refs, config, or other repository administration data fail at the OS capability boundary. Any synthetic `.git` content created in the mirror is never merged to the real workspace.

### 5. Persisted per-path state drives restart recovery and review

The batch lifecycle is `preparing → running → collecting → syncing → completed | partial | conflict`; any state whose process, filesystem, or database outcome cannot be proven becomes `unknown`. State transitions and recovery references are committed before the next irreversible filesystem action. On startup, reconcile nonterminal batches using task/step identity, mirror manifest, durable blobs, same-volume staging/backup artifacts, workspace identity, and current path hashes. Classify only provable paths as not-applied or applied; everything else remains unknown. Recovery never starts a command again. Only after ledger and path snapshots are durable may expendable mirrors or staging artifacts be removed.

The existing task reviewer adds command origin and batch-level sync status while keeping each path's keep/revert controls. Revert uses the existing workspace identity/hash protections and reports each path independently. Conflicting, unknown, or missing recovery data cannot be silently kept as success or reverted; the UI offers inspection/recovery state and retains evidence. Read-only Git review continues to show current workspace status, not a task-exclusive diff.

### 6. Stage boundaries and references

- **S5-01 (this gate):** freeze this behavior contract, design and PE30–33 change; correct older research text that still names DSH as a writer.
- **S5-02:** additive storage migration, command-batch/path-operation APIs, durable blob service, quotas, recovery state transitions, unit tests. No command writeback is enabled.
- **S5-03:** mirror copier/manifest, Git metadata resolver, workspace writer lock, read/write capability mapping, command integration and per-path writeback/recovery; run the concentrated Windows process/ACL/copy/crash tests before the stage advances.
- **S5-04:** reuse and extend task review/query/export UI for batch origin, conflicts, partial/unknown, safe keep/revert, restart continuity and diagnostics; run the full Stage 5 gate.

The mechanism is Noema's own implementation, not a feature imported from Codex, OpenHands, Cline, DSH or a component library. The code references above identify current ownership boundaries only. Windows copy/replace primitives do not make the whole path set atomic; OpenSpec therefore promises verified per-path outcomes and recoverable partial state.

## Risks / Trade-offs

- **[Full copies consume time and disk, especially for ignored dependencies]** → Measure before setting hard limits; expose preparation progress/cancel; retain an optional same-volume block-clone optimization only after a capability probe, with ordinary copy as the verified path.
- **[A process may change the original workspace while the mirror runs]** → The sandbox receives read-only source access; recheck base identity/hash before each path replacement; conflict rather than overwrite; coordinate Noema's own writes with a workspace lock.
- **[Multi-file sync or process crash can leave mixed versions]** → Persist all recovery blobs/manifests first, apply per path, persist every state, retain backup/mirror on uncertainty, and show partial/unknown rather than claiming rollback.
- **[Git supports many metadata layouts and can write through aliases]** → Resolve metadata roots in the host, grant each only read access, use a bounded capability allowlist, and reject unresolved layouts before spawn.
- **[The existing SQLite BLOB limits are too small for arbitrary build outputs]** → Use content-addressed durable blobs for command versions and hard quotas; refuse to sync any path whose recovery bytes cannot be persisted.
- **[User/worktree lock is stale after a crash]** → Durable lock ownership references the command batch; startup reconciliation clears it only when process termination and path state are known, otherwise it remains an explicit recovery blocker for that workspace.

## Migration Plan

1. Add schema/blob-store changes without modifying existing task or file-change rows; migrate operation uniqueness so command steps can own multiple path operations.
2. Keep `run_command` write admission disabled until the complete mirror, ledger, runner ACL, recovery and review path is present and passed as a Stage 5 unit.
3. Enable only SocialWork command batches after the stage gate. Existing tasks, file-tool changes, Root/Legacy history and DSH history remain readable and are not converted into new command batches.
4. On rollback, close command write admission first. Preserve unresolved batch directories and referenced blobs; never delete recovery material just because the application version was rolled back.

## Open Questions

None that change the contract or implementation sequence. Exact quota defaults will be selected in S5-02 from measured workspace sizes and enforced as hard limits before enabling command writes.
