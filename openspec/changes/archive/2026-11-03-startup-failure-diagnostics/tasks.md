## 1. Startup lifecycle events

- [x] 1.1 Add a finite error categorizer and privacy tests for known/unknown errors.
- [x] 1.2 Record schema-ready and startup-failed events at their authoritative lifecycle boundaries; prove diagnostic failure does not mask startup failure.

## 2. Validation and handoff

- [x] 2.1 Run startup/diagnostics tests, TypeScript, changed-file lint/format, source:check, strict OpenSpec and diff checks; update current context and progress.
- [x] 2.2 Rebuild package and rerun startup/tray/runtime-manifest smoke; confirm no automatic setup/UAC or model request is introduced.

## Workflow follow-up

- Archive after all tracked work and strict validation pass.
