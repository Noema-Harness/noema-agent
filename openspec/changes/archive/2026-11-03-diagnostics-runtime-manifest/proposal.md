# Proposal

## Why

When a user reports a local runtime or migration issue, the diagnostics view currently shows the event timeline and runner identity but not the Noema/Electron build or persisted schema versions that produced it. That leaves a basic gap in the package handoff and makes local reports harder to reproduce.

## What Changes

- Show a small, privacy-safe runtime manifest in local diagnostics: app, Electron and Node versions; OS version, platform, architecture and packaged status; applied SocialChat and diagnostics schema versions.
- Include the same manifest in diagnostic timelines and the user-reviewed export preview/file.
- Keep values local unless the user explicitly previews and saves an export; do not include user paths, identifiers, secrets, prompts or source content.

## Capabilities

### Modified Capabilities

- `desktop-host-lifecycle`: local diagnostics identify the runtime and applied data schemas for troubleshooting package and migration behavior.

## Impact

Diagnostics runtime metadata collection, query DTOs, preload contracts, diagnostics UI/export, and targeted tests. No database migration or automatic external reporting.
