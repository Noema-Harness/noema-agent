## 1. Runtime manifest

- [x] 1.1 Collect a fixed runtime allowlist and read actual migration versions using static read-only queries; test valid, missing and unreadable ledgers.
- [x] 1.2 Return the manifest from recent/timeline diagnostics and include it in export preview/file; test that private path/content fields cannot enter the manifest.
- [x] 1.3 Display the manifest in the local diagnostics UI and update typed IPC contracts.

## 2. Validation and handoff

- [x] 2.1 Run diagnostics tests, TypeScript, changed-file lint/format, source:check, strict OpenSpec and diff checks; update progress and current context.
- [x] 2.2 Rebuild Windows package, run packaged startup/tray smoke, verify Squirrel manifest hashes and document unsigned status and target OS gate.

## Workflow follow-up

- Archive after all tracked work and strict validation pass.
