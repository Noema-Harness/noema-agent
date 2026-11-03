# Design

## Context

Noema already has a local bounded diagnostic event store and a preview-before-save export flow. Windows runner identity is shown, and the preload exposes the product version, but the diagnostics report does not identify the Electron/Node runtime or the schema versions actually applied to the user database.

## Decisions

1. Collect a fixed runtime allowlist from the trusted main process: product version, Electron/Node versions, OS version, platform, architecture, packaged flag, and actual maximum versions in the SocialChat and diagnostics migration tables.
2. Use static table names and read-only queries. If a migration table cannot be read, represent its version as `null`; do not block task execution or alter migration state.
3. Add the same manifest to recent diagnostics and task timelines, and include it in the export file. The export preview already shows exact JSON before the user saves it.
4. Render the manifest in a compact diagnostics disclosure. No automatic uploads, external telemetry or identifying path/device data.

## Risks / Trade-offs

- OS version does not include the Windows UBR/security update revision; target-machine setup readiness remains the authoritative detailed runner gate.
- Older report consumers may ignore the additive `runtime` object; the export schema version remains unchanged because no existing fields change meaning.

## Migration

No schema migration. Existing events and exports remain readable; reports without runtime metadata can display “当前版本未记录运行信息”。
