# Tasks

## 1. Emit safe provider lifecycle events

- [x] 1.1 Add the provider request-event callback and emit start, first-output, terminal, and usage-missing phases across buffered and streamed paths; verify provider tests cover ordering, correlation, missing usage, transport failure, cancellation, and callback failure isolation.
- [x] 1.2 Connect provider phases to the existing diagnostics event owner and allowlist elapsed milliseconds; verify event-store/query tests show ordered phases with fixed IDs and no prompt, output, tool argument, or credential fields.
- [x] 1.3 Preserve execution and turn identities in buffered malformed-tool-call correction; verify both buffered attempts retain the same request execution/turn association.

## 2. Verify and document the gate

- [x] 2.1 Update the `project-execution` requirement and run targeted provider/diagnostics tests, typecheck, source boundary, lint/format, and OpenSpec strict validation; confirm no real model request occurred.
- [x] 2.2 Record the C3 pre-call comparison, configuration uncertainty, and remaining user-visible gate in `.work/planning/PROGRESS.md` and the C2/C3 research card; verify `workspace:check` succeeds.

## Workflow follow-up

- Archive the change after implementation and verification, then inspect the archived spec and diagnostics timeline projection.
