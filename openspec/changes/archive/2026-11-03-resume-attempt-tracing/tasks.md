## 1. Recovery trace identity

- [x] 1.1 Carry a per-segment execution ID from SocialWorkService through executor command identity and all lifecycle diagnostics; preserve stable task ID and model usage attribution.
- [x] 1.2 Record checkpoint phase and bounded recovery reason on resume; test diagnostics retain both IDs and omit private checkpoint content.

## 2. Fail-closed corrupted checkpoint

- [x] 2.1 Simulate malformed persisted checkpoint JSON; prove explicit resume throws before status transition and no execution is admitted.
- [x] 2.2 Run recovery, diagnostics, TypeScript, changed-file lint/format, source:check, strict OpenSpec and diff checks; update progress and context.

## Workflow follow-up

- Archive after all tracked work and strict validation pass.
