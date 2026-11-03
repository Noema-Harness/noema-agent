# Tasks

## 1. Result-state presentation

- [x] 1.1 Add a shared task-result presentation mapping for completed, failed, interrupted, and active continuation states; test each title/caveat and ensure verification/recovery status remains separately authoritative.
- [x] 1.2 Render the mapped title/caveat beside saved task text; add renderer projection tests that incomplete resultText is never labeled successful output.

## 2. Recovery regression and handoff

- [x] 2.1 Run stop, restart, safe-resume, unknown-side-effect, and retry-as-new-task regression tests; verify previous task/result remains queryable and unknown actions have no automatic rerun path.
- [x] 2.2 Run affected tests, TypeScript, changed-file oxlint/oxfmt, source:check, strict OpenSpec and diff check; update `docs/CURRENT_CONTEXT.md` and `.work/planning/PROGRESS.md` with recovery boundaries and user-visible partial-result semantics.

## Workflow follow-up

- Archive the change after all tracked work and strict validation pass.
