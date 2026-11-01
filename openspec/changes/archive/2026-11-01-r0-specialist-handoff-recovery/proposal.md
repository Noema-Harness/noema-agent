# Proposal

## Why

Noema can finish a specialist handoff and then fail while composing its own reply. Retrying the failed main-chat message currently forgets the completed handoff and can ask the specialist to do the same work again, wasting a model call and adding duplicate private-chat history.

## What Changes

- Persist the parent Noema reply ID on the specialist's private handoff message.
- On retry, reuse a completed specialist result; retry an incomplete specialist turn in place.
- Let Noema synthesize the parent reply from the saved result without re-exposing side-effect tools.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `specialist-agents`: a main-chat retry reuses the durable specialist handoff associated with that reply.

## Impact

- SQLite social-chat schema and migration.
- `SocialChatStore` handoff lookup and turn creation.
- `SocialChatService` delegation recovery and retry synthesis.
- Targeted social-chat service coverage.
