# Design

## Context

See `proposal.md` for motivation and `specs/user-followups/spec.md` for observable behavior. Reminder records already retain nullable `sourceRoomId` and `sourceMessageId`. The renderer has an existing message-scroll state used by history navigation.

## Goals / Non-Goals

**Goals:**

- Carry reminder source IDs through the due event and notification click.
- Deliver navigation only after the main chat renderer has subscribed to social events.
- Use the current chat list at click time, then apply the existing room selection and message-scroll behavior.

**Non-Goals:**

- Add a notification history screen or alter reminder creation, delivery, or persistence.
- Navigate to a deleted source or recreate a deleted chat.

## Decisions

1. **Use the stored source IDs as the navigation target.** The scheduler already has the claimed reminder row; include its nullable source IDs in the due event. No new database columns or model call are needed.
2. **Send a typed social navigation event from main to renderer.** The notification click callback records a pending target and opens/focuses the main window. A narrow `markSocialChatReady` IPC handshake lets the renderer drain that pending target only after its social event listener is installed. This also covers a hidden or recreated main window without timing delays.
3. **Resolve the target against fresh social state.** On receiving the navigation event, the renderer asks for current social state. It selects the source room if present, sets the existing pending scroll message when the source ID still exists, and otherwise falls back to the main chat. A manual reminder without source IDs simply opens the main chat.

Alternatives considered: sending immediately after `did-finish-load` can race React listener installation; adding a separate deep-link URL would duplicate the current navigation state model. The readiness handshake and existing social event path are smaller and preserve current room navigation semantics.

## Risks / Trade-offs

- [A notification can be clicked while the renderer is being recreated] → Keep one pending target in main and drain it after renderer readiness; the latest click wins.
- [Stored source IDs may have been nulled after deletion] → Resolve against current room/message state and fall back without error.

## Migration Plan

No data migration is required. If navigation fails, remove the new event/handshake and retain the existing behavior of opening the main window.
