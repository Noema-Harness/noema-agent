# Tasks

## 1. S5-01 contract and source design gate

- [x] 1.1 Audit `NoemaProjectExecutor`, `SocialWorkService`/`SocialChatStore`, file-change schema/review, workspace boundary scanner and Windows runner policy; capture current owner gaps in `design.md` and verify each statement against source.
- [x] 1.2 Rebase PE30–33 to command mirror, durable batch/path history, safe auto-writeback, Git read-only, conflict and restart recovery semantics; validate all scenarios with `openspec validate social-work-command-mirror-ledger --strict --no-interactive`.
- [x] 1.3 Freeze task owner, storage/blob, runner ACL, Git metadata, quota and recovery decisions; correct DSH-as-writer wording in source research and confirm Root/DSH stay retired.

## 2. S5-02 durable task/path change ledger

- [x] 2.1 Add additive schema migration for command-batch lifecycle and per-path command operations under the existing SocialWork task/file-change owner; prove old file-tool rows and history survive migration.
- [x] 2.2 Implement content-addressed recovery blobs with durable publication, hash verification, reference-safe cleanup, startup integrity scan and bounded per-file/task/application quotas; cover crash between blob and SQLite publication.
- [x] 2.3 Extend `SocialChatStore` APIs for command-batch state, multi-path operations per command step, per-path base/proposed/current identity and recovery states; keep existing file-tool journal/review behavior intact.
- [x] 2.4 Add focused storage/state-machine tests for additions, modifications, deletions, repeated path operations, duplicate calls, quota rejection, partial/unknown state and restart reconciliation; run existing file-tool journal/review suites as regression.
- [x] 2.5 Choose and document measured hard mirror/blob quota defaults, verify the current Noema workspace and representative project fixtures fit the accepted profile, and prove over-limit preflight refuses before command spawn.

S5-02 2.5 provides the measured profile and `assertCommandMirrorCapacity` refusal helper; S5-03 3.1/3.3 must call it before any process spawn and prove the refused command never starts. Startup reconciliation closes `preparing` batches as `not_applied` and quarantines `running|collecting|syncing` as `unknown` without replaying commands.

## 3. S5-03 isolated command copy and safe synchronization

- [x] 3.1 Implement complete ordinary-file mirror snapshot with boundary scan, source/mirror manifests, identity/hash rechecks, hidden/ignored/untracked coverage, progress/cancel and cleanup; test race, alias, unsupported object, count/byte limit and disk-failure cases.
- [x] 3.2 Resolve supported root/linked/nested Git metadata without invoking hooks; ensure runner grants source/Git roots read-only and mirror write-only, rejects unsupported/external-unapproved roots, and never synchronizes synthetic or real `.git` paths.
- [x] 3.3 Serialize Noema writes per workspace identity and connect only SocialWork `run_command` to mirror lifecycle and durable batch ledger; prove Root/Legacy, DSH and alternate IPC/recovery paths cannot spawn or write through this adapter.
- [x] 3.4 Implement post-run manifest diff, durable per-path preimage/proposed data, base/current/proposed conflict checks, same-volume staging/replacement, verification, partial status and startup recovery; cover file and directory create/delete plus rename-as-delete/create.
- [x] 3.5 Concentrated Windows runner acceptance: command writes visible only in mirror while running; original workspace and Git index/refs/config remain protected; ordinary/Git/dirty/untracked/ignored workspaces work; external user edits conflict; stop/timeout/crash/partial sync preserve recoverability and prevent replay.

S5-03 evidence: `social-work-command-runner.test.mjs` 9/9 covers mirror-only execution, root/linked Git metadata, ignored/untracked/dirty mirroring, hardlink/reparse refusal, preflight refusal, conflict/partial, source edit, timeout/unknown retention and rename/directory create-delete; `windows-runner-execution-service.test.mjs` 8/8 covers read-write admission; live Windows scripts `windows-runner-live-readonly-e2e.mjs`, `windows-runner-live-write-e2e.mjs` and `windows-runner-live-mirror-e2e.mjs` passed against the native runner, including a denied write to source `.git/config` and unchanged `.git/index`. Cancellation is propagated through the runner signal; timeout is retained as `unknown`.


## 4. S5-04 user review, diagnostics and stage gate

- [x] 4.1 Extend existing task file review projection and renderer/IPC with command batch origin, syncing/completed/partial/conflict/unknown status and safe per-path keep/revert; verify no parallel reviewer or task surface is introduced.
- [x] 4.2 Link batch lifecycle, mirror preparation, runner admission, path outcomes and recovery to existing execution/task/tool diagnostics and safe export; assert no path, hash, command text, file content or credentials leak into diagnostics.
- [x] 4.3 Add renderer/Electron checks for same-task multi-command changes, conflict, partial sync, user review/revert, concurrent rewrite refusal, reload and restart recovery; preserve read-only Git review and existing file-tool interactions.
- [x] 4.4 Run the full Stage 5 gate in `docs/NOEMA_V1_ACCEPTANCE.md`, including all affected file-tool regressions, Windows native/runner/Electron checks, migration/data continuity, strict OpenSpec, source/workspace/format/type/test gates and diff review; resolve failures and rerun the complete stage gate before S6-01.

S5-04 evidence: `social-work-service.test.mjs` 37/37 includes command-origin revert and concurrent-edit refusal; real Electron `social-work-e2e.mjs --synthetic --entry` verified two seeded batches (`batchCount:2`, `changeCount:2`) including `partial`/`writeback_partial`, `origin=command`, batch list rendering, details panel and reload (`commandOriginProjected:true`, `reloaded:true`). Diagnostics `social.work/command.batch` records status/batch ID/error code only. Full Stage 5 gate: `npm run check` 755/755 tests, workspace/source/skills/format/typecheck clean, 11 pre-existing lint warnings/0 errors; live Windows readonly, write and mirror scripts passed; Electron projection verified; `openspec validate` strict and `git diff --check` rerun for the gate.

