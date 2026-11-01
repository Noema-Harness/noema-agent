# Design

## Context

See proposal.md for the failure being addressed. A specialist handoff already has durable user and assistant messages in the member's resident private chat. The missing piece is a durable link from that child turn to the Noema assistant reply that created it.

## Goals / Non-Goals

**Goals:**

- Keep one specialist task associated with one Noema assistant reply across retries.
- Reuse a completed child answer and retry a failed or interrupted child answer in its existing turn.
- Keep the specialist report in its own chat and give it back to Noema as untrusted task material.

**Non-Goals:**

- Build a generic tool execution journal.
- Add parallel specialist dispatch or multiple handoffs from one Noema reply.
- Change user-visible project or team task behavior.

## Decisions

1. Store `delegation_parent_message_id` on the child user message. The child message is the durable handoff request; its `turn_id` already identifies the paired assistant result. A unique partial index enforces at most one handoff per Noema reply. This uses existing conversation state rather than adding a second operation table.
2. When a main-chat retry finds a linked child turn, recover that turn before calling Noema's provider. Reuse a completed assistant message or retry a failed/interrupted assistant message in place. If the child is still streaming, do not create another turn.
3. Recovered synthesis receives the saved agent name, task, status, and report as application context and receives no action tools. This prevents replay of the original side effect and keeps the model responsible for its own user-facing answer.

Alternatives considered: a generic durable tool journal would cover more future actions, but it would duplicate state already stored in chat messages and is not needed for this single handoff boundary. Re-running the original tool call would preserve current behavior but can duplicate cost and history.

## Risks / Trade-offs

- [A future feature allows multiple specialist handoffs from one parent reply] → The unique relationship must become keyed by a durable operation ID before enabling parallel or multiple dispatch.
- [A process exits after creating a brand-new specialist but before writing its first handoff message] → This narrow creation window is not covered by the message link; agent-creation idempotency remains a separate lifecycle change if observed or required.

## Migration Plan

Add a nullable self-reference column and unique partial index in social schema migration 28. Existing messages remain unlinked. Rollback is not required for this additive nullable field; restoring a pre-migration database remains covered by the existing backup gate.
