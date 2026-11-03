# Tasks

## 1. File-tool workspace boundary

- [x] 1.1 Add a bounded workspace scanner for file-tool admission; reject hard links, reparse/symbolic links, unsupported objects, identity mismatch, scan limit, and metadata errors before list/search/read/write, with fixtures for each refusal.
- [x] 1.2 Route every `NoemaProjectExecutor` file tool through the trusted task workspace identity and scanner; verify allowed relative reads/writes stay in-root and failure performs no file read/write.
- [x] 1.3 Add diagnostic-safe outcome coverage for file-tool admission: finite reason/count only; verify path, content, hash, and arguments never enter diagnostics.

## 2. Durable file-change journal

- [x] 2.1 Add additive schema and SocialChatStore owner for per-task/per-path first preimage, intended/latest hashes, pending/applied/unknown/review state, bounded diff metadata, and restore bytes; verify older tasks remain readable without synthesized artifacts.
- [x] 2.2 Persist mutation intent before filesystem writes, verify actual postimage before success, aggregate repeated writes per path, and reject concurrent baseline mismatch or task quota overflow before mutation.
- [x] 2.3 Reconcile pending records after interrupted writes using exact pre/post hashes only; test preimage, postimage, third-state conflict, write failure, and restart behavior without automatic destructive action.

## 3. Review and safe restoration

- [x] 3.1 Add trusted main-process APIs keyed by task and opaque file-change ID for listing, keeping, and reverting; recheck saved workspace identity and expose no arbitrary path input from renderer.
- [x] 3.2 Implement compare-before-restore for modified and created files; test successful restore/delete, externally modified conflict, symlink/reparse swap, identity mismatch, repeated writes, and multi-file partial result.
- [x] 3.3 Add fixed-argument read-only Git status/diff provider for tracked/staged/untracked workspace files; disable external diff/textconv and configuration hooks, enforce bounds/timeouts, and test non-repo/error/timeout/large output without modifying Git state.
- [x] 3.4 Add task-card file review with bounded native diff display and clear separation of Noema-attributed changes from current Git state; enable keep/revert only after task terminal state and verify renderer reload reflects persisted outcomes.

## 4. Integration and handoff

- [x] 4.1 Test end-to-end file mutation, task persistence, review, keep/revert, concurrent change refusal, and diagnostic privacy through the existing SocialWork task owner.
- [x] 4.2 Run affected tests, typecheck, lint/format, source boundary, strict OpenSpec validation, and diff check; update `docs/CURRENT_CONTEXT.md` and `.work/planning/PROGRESS.md` with limits and command-output review boundaries.

## Workflow follow-up

- Archive after all tracked work and strict validation pass; retain Windows target-machine hard-link/ACL/restore behavior for the OS gate and final user acceptance.
