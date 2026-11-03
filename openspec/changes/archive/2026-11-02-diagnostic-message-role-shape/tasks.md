# Tasks

## 1. Capture and persist role shape

- [x] 1.1 Measure each serializable message object by fixed role in the OpenAI-compatible request usage metadata; verify provider tests cover every role, unknown role bucketing, exact JSON character lengths, and unmeasurable input.
- [x] 1.2 Add nullable allowlisted role-shape persistence with legacy database migration and validated reads; verify store tests cover new/old schemas, malformed data, and no user-supplied role keys.

## 2. Expose local diagnostics safely

- [x] 2.1 Add role-size fields to the diagnostics bridge/query and timeline UI, keeping old or malformed data unavailable and excluding role shape from export; verify query/privacy and renderer formatter tests.
- [x] 2.2 Update `project-execution` diagnostics requirement and run targeted provider/store/query/renderer tests, typecheck, source boundary, formatting/lint, and strict OpenSpec validation; inspect that no prompt content is persisted or exported.

## Workflow follow-up

- Archive the change after all tracked tasks and project validation are complete, then verify the archived spec and update the active C2 evidence/progress.
