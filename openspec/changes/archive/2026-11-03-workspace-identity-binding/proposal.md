# Bind project work to a verified workspace identity

## Why

Project work currently stores a normalized path string as its workspace key. Resume checks that the path still resolves to the same text, but the filesystem object at that path can be replaced. Durable project tasks therefore need an identity for the selected directory, not only its displayed path.

## What Changes

- Capture a versioned workspace identity in the trusted main process after resolving the user-selected directory.
- Bind each project to its first explicitly selected workspace. Require explicit confirmation before rebinding it to a different path or filesystem object.
- Persist the identity snapshot with each task and reject resume when the directory is missing, renamed, replaced, or no longer matches the saved identity.
- Keep path and identity values out of diagnostic event payloads; expose only bounded identity state and stable reason codes.
- Preserve non-project tasks as independent workspace tasks; project binding applies only when a durable project ID is present.

## Impact

- Affects `social-project-store`, `social-chat-store`, `SocialWorkService`, trusted workspace-selection IPC, and task diagnostics.
- Requires a database migration. Existing project tasks have no trustworthy identity snapshot and cannot be resumed until the user starts a new task in an explicitly selected workspace.
- No Windows-only filesystem identity requirement is introduced; identity is captured from the trusted process's filesystem metadata and fails closed when unavailable.
