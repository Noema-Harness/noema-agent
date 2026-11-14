# Design

## Context

See `proposal.md` and the `social-conversations` spec delta. The persisted `first_meeting` setting is legacy onboarding metadata; it is included in Social state, but no current renderer mounts the creator letter. `SocialChatService` still reads it to build prompt text, and the renderer/preload/main IPC still expose an obsolete write operation.

## Goals / Non-Goals

**Goals:**

- Make first-use interaction depend on provider readiness and actual user conversation only.
- Preserve existing `first_meeting` records as readable compatibility metadata without a write path or prompt use.
- Remove dead creator-letter implementation and its obsolete behavior assertions.

**Non-Goals:**

- Do not delete or rewrite users' existing `first_meeting` database value.
- Do not redesign provider setup or Social empty-state layout in this change.
- Do not alter Quick Capture archive data; its write-path retirement remains tracked by the Root/Legacy retirement change.

## Decisions

- Remove the `firstMeetingContext` request-context branch rather than keeping a no-op prompt hook. A request test will seed a legacy record and assert that the record and old creator wording are absent from captured model messages.
- Keep `getFirstMeetingState()` as a read-only compatibility projection in Social state, but remove `advanceFirstMeeting` from the store, IPC, preload, bridge, and renderer. No migration is needed because the stored JSON remains intact.
- Delete the unreferenced creator-letter component, stylesheet, and copy/context module. Keeping those files would leave obsolete product language and an accidental route back into prompts.
- Keep provider-ready/connection error decisions in `ChatStartState`; it remains the one default Social first-use surface.
- Render the checking state once in the heading, keep the model-settings recovery action available during checking, and wait for provider readiness to settle before recording first-use renderer screenshots.

## Risks / Trade-offs

- [Older first-use progress will stop changing] → Preserve and expose the existing state read-only; it no longer gates chat or changes requests.
- [A downstream script may depend on the removed write API] → Search all preload, renderer, test, and E2E callers; update the isolated live fixture before the Stage 2 gate.

## Migration Plan

No database migration. Existing `first_meeting` JSON remains untouched and readable. Rollback can restore the removed code without data conversion; normal operation after rollback would resume the old behavior.
