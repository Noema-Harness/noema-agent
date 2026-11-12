# Tasks

## 1. Retire creator narrative from behavior

- [x] 1.1 Remove legacy first-meeting context from Social request construction and replace the service assertion with a legacy-record/no-prompt-content test; verify the test source asserts no old context enters captured provider messages.
- [x] 1.2 Preserve the existing first-meeting setting as read-only compatibility state and remove its write method from the store, trusted IPC, preload, bridge, and renderer; verify source callers are gone and add a legacy-state round-trip assertion.
- [x] 1.3 Delete the unmounted creator-letter screen, stylesheet, copy/context helper, and obsolete behavior tests; verify no runtime or test imports remain.

## 2. First-use integration evidence

- [ ] 2.1 Update isolated/live first-use fixtures and screenshots to reflect the provider-ready Social surface; verify no retired progress API is invoked by acceptance scripts.
- [ ] 2.3 Make the checking state concise, retain a direct settings recovery action, and place the start-state block against the composer; verify the native renderer probe waits until provider status settles and captures the ready/unavailable state without legacy first-meeting UI.
- [ ] 2.2 Run the complete Stage 2 gate only after S2-01–S2-07 implementation is complete; confirm model-ready and unavailable empty states, captured first request, persisted legacy state, and no creator text before validating/archiving this change.
