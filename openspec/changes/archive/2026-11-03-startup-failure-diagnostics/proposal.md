# Proposal

## Why

After the application database opens, a later startup or migration failure currently reaches the user error dialog but is not recorded in the persistent diagnostics timeline. The user then has no event to correlate with the package/runtime manifest.

## What Changes

- Record a startup-failed event when initialization fails and the diagnostics event store is available.
- Record successful SocialChat schema initialization and the schema version as a migration lifecycle event.
- Use fixed error categories and finite phase details; never persist raw errors, stacks, paths, prompts, credentials or database contents.

## Capabilities

### Modified Capabilities

- `desktop-host-lifecycle`: startup and schema migration outcomes are visible in local diagnostics when the diagnostic store is available.

## Impact

Electron startup catch path, schema startup event, a bounded error categorizer, and diagnostics tests. No schema migration. A failure before the diagnostics database is opened remains reportable only through the existing startup error dialog.
