# ADR 0005: Route Noema model calls through FreeLLMAPI free models

- Status: Accepted as the current provider boundary; selected after the user's explicit direction
- Date: 2026-10-13
- Replaces: ADR 0003 decision 7's local Ollama choice, and ADR 0004 decision 6's local Ollama worker route

## Problem

Noema's only root model route was Ollama. The user has now explicitly directed that model calls use FreeLLMAPI free models and not local models. This changes the data path: conversation content leaves the machine through the local FreeLLMAPI gateway to its upstream provider. The app must disclose that boundary and must not silently fall back to Ollama or a paid route.

## Evidence

- The installed FreeLLMAPI desktop gateway is running locally on the configured port in `%APPDATA%\\FreeLLMAPI\\config.json`; its local API implements OpenAI-compatible `/v1/models` and `/v1/chat/completions` endpoints.
- `GET /v1/models?available=true` returns canonical identifiers and availability flags, but does not expose a reliable price field. Therefore the app must not treat every gateway model as free merely because it is listed.
- A no-personal-data request to `nvidia/nemotron-3-super-120b-a12b:free` returned HTTP 200 through the FreeLLMAPI OpenAI-compatible endpoint. A second request with a required tool definition returned a structured `tool_calls` result, also HTTP 200.
- A no-personal-data request to FreeLLMAPI's `free-router` alias returned HTTP 200 and reported `openrouter/free` as the routed model; the real Electron root conversation also streamed `READY` through this route.
- An earlier isolated DSH attempt through FreeLLMAPI performed one file write, then failed before returning a final result because the selected free route was in cooldown. This is a historical failure; the later real desktop DSH path is verified below, with cooldowns still handled as recoverable failures.
- FreeLLMAPI's curated named chain `noema-free` now contains eight no-cost, tool-capable models: six BlockRun-hosted models plus keyless Kilo and OVH routes. `auto_include_new_models=0` keeps its membership explicit. The DSH adapter is restricted to the alias `auto:noema-free`.
- In a real isolated Noema desktop run, the selected named chain produced a structured `delegate_task` call; DSH headless edited only a scratch README, reported four file-tool calls, and returned a final event into the Noema chronology. Noema then summarized that event after one rate-limit failure and explicit retry. A separate fresh DSH process resumed the same persisted session and read back the exact file marker.
- An additional ordinary root turn initially exhausted the free pool, then succeeded on explicit retry. The worker return path is verified; free-tier availability remains intermittent and retries are part of the product's visible failure behavior.
- A request to Gemini returned HTTP 403 stating that the Google project was denied access. The gateway's broad auto route also exhausted its candidate providers. These routes are not considered verified for Noema merely because the gateway lists them.
- The FreeLLMAPI desktop API key is separate from its dashboard session token. Noema receives only an inference API key; it does not receive the dashboard token or permission to administer the FreeLLMAPI database.

## Decision

1. Use the local FreeLLMAPI OpenAI-compatible API as Noema's only model provider. The base URL must be a loopback address; reject non-local hosts before sending a credential.
2. Store the unified API key in Electron `safeStorage`-encrypted app data, never in renderer state after save, logs, SQLite, source files, or command-line arguments. Renderer IPC exposes only connection status and endpoint, never the stored key.
3. Expose only three reviewed no-cost routes: FreeLLMAPI `free-router`, Kilo's `nvidia/nemotron-3-super-120b-a12b:free` (surfaced through its catalog alias), and the curated `auto:noema-free` named chain. Do not pass arbitrary `/v1/models` entries to the picker; that endpoint has availability information but no trustworthy price metadata. The named chain is the only route offered to the DSH worker.
4. Use the OpenAI-compatible chat-completions API for Noema's root streaming and tool-call protocol. DSH's headless DeepSeek provider is pinned to the same loopback FreeLLMAPI `/v1` endpoint and `auto:noema-free` model alias. Noema persists tool dispatch, DSH task state, and result events separately from user messages; provider exhaustion keeps an event retryable rather than switching billing class.
5. Every user-visible connection state names FreeLLMAPI. Disclose that messages are saved locally but sent upstream through FreeLLMAPI. On provider error, preserve the user turn and show a recoverable error; never switch to Ollama, a paid model, or another external destination silently.
6. Treat free routing as a runtime capability, not a permanent catalog fact: a route is selectable only when it is both on Noema's allowlist and currently reported available by FreeLLMAPI. A route failure remains a failure; it does not authorize a different billing class.

## Consequences

- The user no longer needs Ollama for Noema. The existing SQLite conversation remains local, but model requests are external; the UI and docs make this explicit.
- Free provider quotas and health are upstream dependencies. The gateway may be reachable while every upstream free provider is exhausted or unavailable; a larger curated chain reduces single-provider cooldown risk but cannot guarantee availability.
- The app intentionally exposes a small verified free-model subset rather than all models in the gateway. Expanding the list requires evidence of both zero-cost routing and compatibility with the particular feature (text or tool use). A route may be usable for a single root reply but still be unsuitable for multi-turn agent work under its cooldown. The curated chain's membership is local FreeLLMAPI state; inspect it if the route is retargeted or expanded.
- The FreeLLMAPI URL and key are per-device settings. Endpoint discovery uses the installed desktop app's local port configuration where available, with the documented default as fallback.

## Reconsider when

- A currently configured route no longer has a free/no-cost guarantee, or its catalog ID/API behavior changes.
- FreeLLMAPI exposes a reliable authenticated cost-classification contract that can replace the app's small allowlist.
- A second provider class is explicitly authorized and its cost boundary can be enforced without silent fallback.
- A supported desktop credential storage mechanism is unavailable; in that case, do not downgrade to plaintext persistence.
