# Design

## Context

See proposal.md - Why. `OpenAICompatibleClient` already owns request ID creation, provider outcome, usage parsing and buffered/streaming transport variants. Main process already owns the diagnostic event callback and provides failure-isolated `recordDiagnosticEvent`; `DiagnosticsEventStore` accepts an explicit details allowlist. No new durable owner is required.

## Goals / Non-Goals

**Goals:**
- Emit one start, at most one first-output, one terminal event, and an explicit usage-missing event when provider usage is absent.
- Keep all phases correlated to the same generated request ID and existing execution/turn/operation identity.
- Ensure lifecycle callback failures cannot change request delivery, tool calls, retry behavior, or usage recording.
- Preserve identities across buffered and streaming correction requests.

**Non-Goals:**
- No prompt/response snapshots, token streaming logs, provider error body, or credential fields.
- No change to retry policy, provider payload, or task state ownership.
- No lifecycle instrumentation of DSH/RootAgent requests in this change.

## Decisions

1. Add an optional `onRequestEvent` callback to the provider client. The provider emits stable phase names and request metadata; main process maps them to `module: provider` diagnostic rows. Provider owns phase timing because it observes transport and first output; main process remains the sole diagnostic persistence owner.
2. First output means the first non-empty text delta or tool-call delta. A buffered complete response records first-output after decoding the response and before forwarding its text/tool calls. A response with usage-only chunks does not count as output.
3. `recordUsage` remains the single terminal owner: it emits `request.usage_missing` when normalization says usage is absent, emits exactly one terminal event, and reports the usage row. Missing usage remains null/unknown. The existing main-process terminal event is removed to avoid a duplicate.
4. Lifecycle event details contain only elapsed milliseconds and bounded status/phase values. Extend the existing event details allowlist for `elapsedMs`; do not store model response, error message, endpoint URL or credential.
5. Buffered malformed-tool-call correction passes through executionId and turnId just like streamed correction, so both provider attempts stay attached to the same task.

### Alternatives considered

- Add events in SocialChatService around `streamChat()`: this misses buffered-vs-stream transport failures and first-output timing, which only the provider sees.
- Persist a second lifecycle table: duplicates the existing bounded identity-rich event ledger and creates another owner.
- Put provider error text into event details: risks leaking response/endpoint data; retain only request status and existing finite reason codes elsewhere.

## Risks / Trade-offs

- [An event store write may fail mid-stream] → callback and event store already isolate writes; usage persistence remains independent and the provider never retries due to a diagnostics failure.
- [Buffered responses cannot report actual token-arrival timing] → record first-output when the complete response is decoded and document elapsed time as buffered-response availability.
- [Usage appears missing even after successful output] → explicit usage-missing event plus `usageReceived=false` row prevents zero-valued interpretation.

## Migration Plan

No database migration is needed; lifecycle events use the existing versioned bounded diagnostics ledger. If rolled back, older builds ignore unknown operation names and continue reading rows using the existing event schema.
