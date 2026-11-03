# Tasks

## 1. Identity primitive and project binding

- [x] 1.1 Add a cross-platform directory identity capture helper with versioned, bounded serialization; reject invalid metadata and non-directories.
- [x] 1.2 Add a nullable migration and SocialProjectStore APIs for reading and updating one project workspace binding; reject rebind while its task is active.
- [x] 1.3 Add SocialChatStore task identity snapshots and schema validation without backfilling legacy rows.

## 2. Admission and user decision

- [x] 2.1 Capture identity after workspace selection; bind first use or compare existing project binding before task creation.
- [x] 2.2 Add trusted main-process rebind/cancel confirmation with bounded renderer contract; cancellation must leave project/task state untouched.
- [x] 2.3 Validate saved workspace identity before resume; legacy missing snapshot and any mismatch must fail without task mutation.
- [x] 2.4 Add safe diagnostic events for capture, binding, confirmation, and resume comparison without paths or file identity values.

## 3. Regression and handoff

- [x] 3.1 Test identity capture, first bind, same identity, changed path, replacement directory, failed capture, active-task rebind, and cancel.
- [x] 3.2 Test resume success, moved/missing/replaced directory, legacy task, and no mutation after rejection.
- [x] 3.3 Run affected tests, typecheck, lint/format, source boundary, and OpenSpec strict validation; update `docs/CURRENT_CONTEXT.md` and `.work/planning/PROGRESS.md`.

## Deferred target-machine acceptance

- Confirm Windows directory identity capture with the native runner's handle-based identity on the user's ESU-updated machine. Until then, Windows command execution remains closed.
