# Proposal

## Why

Noema already persists safe per-request shape measurements, but the in-app execution timeline hides them. When input-token usage changes, the user cannot compare message size, tool-schema size, and request composition without opening lower-level storage.

## What Changes

- Add existing request character/count measurements to the read-only local diagnostic timeline and usage display.
- Keep measurements metadata-only; do not expose or persist prompt or message contents.
- Preserve null for measurements unavailable on older or non-provider request rows.

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-execution`: local execution timeline includes safe request-shape measurements alongside provider usage.

## Impact

- Affects ModelUsageStore diagnostic projection, DiagnosticsQueryService DTO, the shared diagnostics contract, and the in-app timeline.
- No database migration or new provider request fields are required; the measurements are already persisted.
