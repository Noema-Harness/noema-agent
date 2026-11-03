# Design

## Context

`NoemaProjectExecutor` currently resolves file tool paths under the workspace and rejects symbolic links, then writes directly to disk. `SocialChatStore` persists tool-step status/result, while the renderer shows only category and status. The Windows native command runner independently scans all capability roots for hard links/reparse points, but direct in-process file tools do not share that check. Existing diagnostics intentionally exclude workspace paths, tool arguments/results, and content.

## Goals / Non-Goals

**Goals:**

- Make direct file tools obey the same workspace object boundary as the admitted task and fail closed on hard links, reparse points, scan bounds, and metadata errors.
- Preserve a bounded per-path recovery baseline and render accurate changes from Noema file tools.
- Allow the user to explicitly keep or revert those changes after the task ends, with compare-before-restore protection.
- Offer a read-only current Git workspace review for command-created and other workspace changes, including untracked files.
- Keep paths, source content, diffs, hashes, and command output out of diagnostics.

**Non-Goals:**

- Staging, committing, resetting, cleaning, or automatically reverting Git workspace changes.
- Claiming the Git working-tree view is an exact task-only diff; it may include edits that predate the task.
- Reverting command side effects or changes made by external programs through Noema's per-file tool recovery records.
- Supporting binary or over-limit files in the text file tools.

## Decisions

### Direct file tools use a fail-closed workspace scan

Before list/search/read/edit/write, scan the task-bound workspace root, using the same finite entry/depth bounds as the native runner and rejecting links, reparse points, unsupported objects, and metadata failures. Recheck the E1 workspace identity before the operation. This is stricter and more expensive than checking only the requested target, but a search tool can read many files and a hard link can expose an outside file through an apparently in-root name. Keep the confirmed host-process trust boundary: this scan does not lock the tree against another same-user process.

### Writes remain immediate and produce a durable recovery journal

The work request authorizes work in the selected workspace; each text file mutation therefore applies immediately. Before changing a file, persist a bounded per-task/per-path recovery record with the original bytes or an explicit “did not exist” marker, current baseline hash, relative path, and pending operation identity. After the synchronous write, reread and verify the intended bytes, then update the latest hash and bounded diff. Repeated writes to the same path retain the first original bytes and update the latest expected hash. Before each subsequent write, require the current bytes to match Noema's last recorded hash; otherwise refuse to overwrite a concurrent change.

Use SQLite BLOB storage for the original bytes because it shares the existing local data lifecycle and avoids hidden workspace files. Cap one original file snapshot at 1 MiB, per-task restore bytes at 20 MiB, application-wide unresolved restore bytes at 200 MiB, and tracked file paths per task at 200. If a cap is reached, refuse the next mutation before touching the workspace. “Keep” releases the original bytes but retains bounded review metadata; “revert” restores only after the latest hash check. A pending journal found after restart is reconciled by comparing the current hash with the recorded pre-write and intended post-write hashes; any third state is unknown and is never overwritten automatically. Each task diff is limited to 64 KiB and compares no more than 2,000 lines per side.

### Review exact tool changes separately from current Git state

The task review shows exact `edit_file`/`write_file` paths and diffs from the durable mutation journal. A separate workspace review obtains tracked/staged and untracked state through fixed, read-only Git arguments. Disable external diff and textconv, pager, system/global configuration, fsmonitor, and optional locks; impose a 200-file, 1 MiB status/combined-diff, 10-second total time, and bounded subprocess output limit. Render a native bounded text diff for untracked files rather than executing repository-configured helpers. Clearly label the view as current workspace state, including possible pre-task edits. Git review failures are visible as unavailable; they are never rendered as an empty clean workspace.

### A file path has one task-level decision

Aggregate a path's tool writes to one review item from the first preimage to the latest verified postimage. “Keep” drops its restoration bytes. “Revert” applies the original state only if the path still has the last recorded postimage hash; for a created file, remove it only if it still matches that hash. Multiple paths are independent: successful restores remain successful if another path conflicts, and the result is reported per file. Empty directories created by `write_file` may remain after reverting a newly created file.

### Diagnostics only describe counts and state

The user-visible task review may contain relative paths, source diffs, and hashes. The diagnostic ledger remains governed by `project-execution`: it receives only bounded counters and finite status/reason codes linked to existing task/step IDs. File operation journal data is not added to diagnostic export.

## Risks / Trade-offs

- [Scanning each file-tool workspace can add latency and reject repositories containing hard links or reparse points] → Match the native runner's finite bounds, show the concrete refusal reason, and never silently skip unsafe entries.
- [SQLite snapshot data duplicates user source and can grow] → Apply per-task limits, expose an explicit keep action, release restore bytes on keep, and never include snapshots in diagnostics or export.
- [A crash can occur between filesystem write and journal update] → Persist pending intent first; reconcile only exact pre/post hashes and otherwise mark unknown.
- [Concurrent external edits can prevent automatic restoration] → Hash-compare immediately before restore and leave conflicting contents untouched.
- [Git state includes pre-task changes and may fail on large/nonstandard repositories] → Label its scope and return a bounded, explicit unavailable state on timeout/error/limit.
- [Per-file direct-tool recovery cannot undo shell command effects or arbitrary external changes] → Keep command effects as separate task steps and use read-only Git review for current workspace state; do not label the file tool journal a complete system rollback.

## Migration Plan

Add nullable migration tables/columns; older tasks remain readable without file-change artifacts. Do not infer snapshots for past writes. Preserve pending journals across restart and reconcile before exposing keep/revert actions. No Git index/worktree mutation occurs during migration or startup.

