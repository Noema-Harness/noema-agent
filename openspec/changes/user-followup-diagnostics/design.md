# Design

## Context

The follow-up store already owns durable reminder state and lease recovery. SocialChatService owns explicit model-tool admission and the due drain. Trusted root IPC owns settings CRUD. Electron owns the notification API and pending renderer navigation. These owners should remain separate while sharing a trace identity.

## Decisions

- Use module `social.followup` and fixed operation/status/error-code values. Never record title, body, due date text, follow-up/source IDs in details, or source message content.
- Use the durable follow-up ID as execution identity from schedule through delivery/retry/click. Model-created schedule events keep the Social turn as parent and carry request/tool-call IDs; settings actions get a fresh execution ID.
- Report `notification.api` as accepted/rejected/failed based on Electron's synchronous handler result. Do not claim OS display or user read.
- Emit a navigation-dispatched event only after pending navigation has been sent to a ready renderer. The click and dispatch callbacks are best effort and cannot block focus/navigation.
- Catch diagnostic failures at Social, IPC, notification, and pending-navigation boundaries. Preserve original store errors and scheduler state transitions.
- Do not change lease duration, retry cadence, schedule eligibility, notification payload, or user-visible state transitions.

## Risks

- A successful Electron `.show()` call proves API acceptance only.
- A click with no source opens the main window and is recorded as `opened_main`; unavailable sources retain renderer fallback behavior.
- A failed diagnostic write can leave an incomplete lifecycle trace but must not cause duplicate notifications or alter pending/delivered state.
