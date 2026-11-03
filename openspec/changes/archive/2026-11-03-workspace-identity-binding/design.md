# Design: workspace identity binding

## Ownership

- `SocialProjectStore` owns the durable project-to-workspace binding and its revision.
- `SocialChatStore` owns the immutable workspace identity snapshot attached to each task and checkpoint lineage.
- `SocialWorkService` resolves and captures identity, enforces project binding, and performs resume admission before changing task state.
- Main-process trusted UI owns the explicit rebind decision. Renderer values cannot provide or override filesystem identity.

## Identity format

Capture the canonical real path and a versioned tuple of filesystem device/volume and directory file index from the selected directory. Serialize large integer fields as decimal strings. Derive the task lock key from the physical tuple, while retaining the canonical path for display and later comparison. Unsupported metadata, zero/invalid identity, non-directory, missing path, or capture errors deny task admission.

## Bind and rebind

- First project task: the user has explicitly selected the directory; persist the binding before creating the task.
- Existing binding with matching canonical path and physical identity: continue normally.
- Any path or physical identity difference: stop before task creation and show the old and selected paths with a clear rebind/cancel choice. Rebind is allowed only when no project task is active and does not rewrite earlier task snapshots.
- Non-project tasks retain their current per-task workspace behavior and still receive an identity snapshot for safe resume.

## Resume

Re-capture the identity from the saved path and compare schema version, canonical path, device/volume, and file index before marking the task resumed. Missing legacy snapshot or any mismatch denies resume without mutation; the user must start a new task after selecting the intended workspace. Completed or interrupted task history remains readable.

## Diagnostics and privacy

Record whether identity capture/match/bind/rebind was accepted or denied, the schema version, and a stable reason code. Do not record absolute paths, device numbers, file indexes, or directory contents in diagnostic events.

## Compatibility

Add nullable migration columns so old databases open. Existing project/task records remain visible. Legacy resumable tasks without snapshots become non-resumable at admission; do not infer or backfill identity during startup.
