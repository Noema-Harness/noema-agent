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
- A real isolated DSH headless attempt through the FreeLLMAPI Anthropic-compatible path performed one file write, then failed before returning a final result. FreeLLMAPI reported the selected free route in cooldown and later specified an approximately 10-minute reset. Thus the DSH multi-turn tool cycle is not yet verified or deliverable.
- A request to Gemini returned HTTP 403 stating that the Google project was denied access. The gateway's broad auto route also exhausted its candidate providers. These routes are not considered verified for Noema merely because the gateway lists them.
- The FreeLLMAPI desktop API key is separate from its dashboard session token. Noema receives only an inference API key; it does not receive the dashboard token or permission to administer the FreeLLMAPI database.

## Decision

1. Use the local FreeLLMAPI OpenAI-compatible API as Noema's only model provider. The base URL must be a loopback address; reject non-local hosts before sending a credential.
2. Store the unified API key in Electron `safeStorage`-encrypted app data, never in renderer state after save, logs, SQLite, source files, or command-line arguments. Renderer IPC exposes only connection status and endpoint, never the stored key.
3. Start with an explicit allowlist of the two verified no-cost routes: FreeLLMAPI `free-router` and Kilo's `nvidia/nemotron-3-super-120b-a12b:free` (surfaced through its catalog alias). Do not pass arbitrary `/v1/models` entries to the picker; that endpoint has availability information but no trustworthy price metadata.
4. Use the OpenAI-compatible chat-completions API for Noema's root streaming and tool-call protocol. A direct tool-call request to the selected Nemotron route returned structured `tool_calls`. DSH currently uses a separate provider protocol; its Anthropic-compatible request reached a provider cooldown before an upstream attempt, so DSH compatibility is unverified and must remain unavailable until a complete multi-turn worker test passes.
5. Every user-visible connection state names FreeLLMAPI. Disclose that messages are saved locally but sent upstream through FreeLLMAPI. On provider error, preserve the user turn and show a recoverable error; never switch to Ollama, a paid model, or another external destination silently.
6. Treat free routing as a runtime capability, not a permanent catalog fact: a route is selectable only when it is both on Noema's allowlist and currently reported available by FreeLLMAPI. A route failure remains a failure; it does not authorize a different billing class.

## Consequences

- The user no longer needs Ollama for Noema. The existing SQLite conversation remains local, but model requests are external; the UI and docs make this explicit.
- Free provider quotas and health are upstream dependencies. The gateway may be reachable while every upstream free provider is exhausted or unavailable.
- The app intentionally exposes a small verified free-model subset rather than all models in the gateway. Expanding the list requires evidence of both zero-cost routing and compatibility with the particular feature (text or tool use). A route may be usable for a single root reply but still be unsuitable for multi-turn agent work under its cooldown.
- The FreeLLMAPI URL and key are per-device settings. Endpoint discovery uses the installed desktop app's local port configuration where available, with the documented default as fallback.

## Reconsider when

- A currently configured route no longer has a free/no-cost guarantee, or its catalog ID/API behavior changes.
- FreeLLMAPI exposes a reliable authenticated cost-classification contract that can replace the app's small allowlist.
- A second provider class is explicitly authorized and its cost boundary can be enforced without silent fallback.
- A supported desktop credential storage mechanism is unavailable; in that case, do not downgrade to plaintext persistence.
