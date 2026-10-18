# ADR 0021: Buffer replies from FreeLLMAPI automatic routers

- Status: Accepted
- Date: 2026-10-19
- Decision owner: Assistant, under the user's delegated Noema product and engineering authority

## Context

Noema sends model requests through a local FreeLLMAPI gateway. Automatic model aliases can route to different upstream providers. FreeLLMAPI's streaming pipeline can retry before the response is committed, but once streamed output has been sent it surfaces a later provider failure instead of switching providers mid-reply. A partial stream can therefore become a failed Noema message even when another route could have completed the request.

In local synthetic tests, the selected anonymous OVH route intermittently ended an SSE response after emitting text. Similar non-streaming requests and two post-change Noema live E2E runs completed. The failure is upstream-dependent and FreeLLMAPI's own project documentation describes free tiers as experimental rather than a stable inference substrate; Noema cannot promise upstream uptime.

## Decision

- Request complete JSON responses for FreeLLMAPI automatic router aliases (`auto:noema-free` and `free-router`). This lets FreeLLMAPI finish its own route/fallback decision before Noema receives any answer text.
- Keep SSE streaming for pinned direct model IDs, where the user has explicitly selected the provider/model and there is no automatic cross-provider route to preserve.
- Default output budget to 1,024 tokens for routine free-route turns. Callers may raise it when a specific task needs a longer response.
- Treat an SSE stream without FreeLLMAPI's `[DONE]` marker as incomplete; never mark the partial text as a completed reply.
- Keep FreeLLMAPI's outbound proxy on the user's local port 7890. The saved desktop setting is HTTP CONNECT (`http://127.0.0.1:7890`), based on a same-endpoint synthetic comparison where the SOCKS5H stream ended early and HTTP CONNECT completed. This is machine configuration, not a repository-owned proxy service.
- Keep the FreeLLMAPI profile named `noema-free` restricted to confirmed free/no-card routes; remove paid Google entries and the Google model whose project is currently denied. Automatic catalog additions remain disabled for that profile.

## Consequences

- Automatic-router replies appear when the complete response is available rather than token-by-token. The gateway can use its provider fallback before delivery, and Noema does not show a partial answer as complete.
- Direct model selections retain streaming behavior.
- A non-streaming request can still fail if all eligible free providers are unavailable. Noema must preserve the user's message, show the failure state, and not claim that free upstreams have an SLA.
- Synthetic route checks verify transport and completion only; they do not establish model quality or permanent provider availability.

## Reconsider when

FreeLLMAPI documents and demonstrates reliable mid-stream failover for automatic routes, or repeated live evidence shows the buffered path is no longer needed. Reconsider the 1,024-token default if real Noema tasks routinely need longer outputs and an eligible free route is verified to handle them reliably.

## Evidence

- FreeLLMAPI [streaming pipeline](https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/architecture/03-streaming-pipeline.md) documents that errors after a stream is committed are surfaced rather than transparently retried.
- FreeLLMAPI [supported platforms](https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/providers/01-supported-platforms.md) documents the anonymous OVH limit and the upstream-managed nature of its free route.
- Local evidence and ongoing verification are recorded in [Issue #89](https://github.com/c3115644151/noema-agent/issues/89).
