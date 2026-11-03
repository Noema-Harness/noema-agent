## Implementation

- [x] 1. Add a versioned migration and SocialChatStore API for the constrained shutdown intent; consume it transactionally during active-task recovery.
- [x] 2. Map recovery reason to safe interrupted task error codes and diagnostics; keep outcome-unknown side effects and terminal task rows intact.
- [x] 3. Carry host shutdown reason through SocialWorkService so a task that settles within the deadline records the right outcome; preserve manual stop behavior.
- [x] 4. Coordinate explicit exit and Windows `query-session-end` through one bounded host shutdown owner, including clean intent clearing, timeout persistence, and idempotent repeated events.
- [x] 5. Add focused store, service, and lifecycle tests for each reason, timeout, restart, safe-resume gate, and renderer-independent lifetime.
- [x] 6. Update `desktop-host-lifecycle` and `project-execution` specs; run affected checks and packaged startup smoke without making a real model request.
