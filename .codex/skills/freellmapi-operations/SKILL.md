---
name: freellmapi-operations
description: Diagnose or verify Noema's FreeLLMAPI gateway, proxy, model catalog, or live inference path; use before changing provider settings or interpreting model availability.
---

# FreeLLMAPI operations

FreeLLMAPI is Noema's local API gateway and upstream router; it is not itself a model provider. Keep these observations separate:

1. The desktop app is running and its loopback API answers.
2. The authenticated model catalog is readable.
3. A route is listed as available or ready.
4. A real synthetic generation returns a complete response.

Only the last observation validates inference at that moment. Free upstreams have no availability guarantee; an individual key's `healthy` status or a readable catalog does not prove generation. Never promise long-term uptime from a short test.

## This workstation

- FreeLLMAPI desktop data lives at `%APPDATA%\FreeLLMAPI`; its current desktop API port is read from `config.json` (currently 31415), and Noema auto-discovers it. Do not assume the default 3001 port.
- The outbound proxy setting lives in `freeapi.db`, not `config.json`. Current verified value is `socks5h://127.0.0.1:7890`, mode `forward`, enabled. Historical Noema logs showed repeated provider socket resets under `http://127.0.0.1:7890`; SOCKS5h was selected after an isolated generation succeeded, but later requests still showed upstream failures. Treat this as the better current transport, not a guaranteed fix.
- The installed FreeLLMAPI desktop version was 0.16.0 at last inspection. Check the installed version and official release notes before any update; do not update merely to chase a newer number.
- Noema development requires Node 24.21.x and npm >=10.9. The machine's system Node 20.18 is incompatible and can crash native tests; bundled Node 24.19/npm 10.8 also fails the project's npm gate. A verified Node 24.21.0 plus npm 11.6.2 runtime is installed under `D:\Tools\NoemaRuntime`.

## Safe verification

- Start with the no-generation catalog/desktop probe: prepend the verified Node and npm paths to `PATH`, then run `node apps/desktop/scripts/smoke-freellmapi.mjs`. It reads the encrypted Noema credential and loopback model catalog; it does not send a chat.
- When inference itself must be checked, run exactly one synthetic probe with `NOEMA_SMOKE_SOCIAL_CHAT_LIVE=1` and the same script. The message contains only a fixed test marker and uses `auto:noema-free`; it consumes upstream quota. Verify the complete marker response and inspect the FreeLLMAPI attempt log to see whether failover occurred.
- For broader social-chat UI coverage, `node apps/desktop/scripts/social-agent-e2e.mjs --live` uses isolated synthetic fixtures but may issue more than one model request. Use it only when the broader UI path is relevant; do not run it repeatedly as a generic health check.
- Do not print, copy, or place the Noema API key on a command line. Never copy it out of Electron `safeStorage`. Redact credentials before sharing logs; inspect only the minimal recent `[Proxy]`, `[FallbackLoop]`, or `[Health]` lines needed.
- If model generation fails, distinguish gateway/API failure, proxy/TLS/socket failure, provider quota/rate-limit, model/request incompatibility, or full-chain exhaustion. Do not retry in a loop. A bounded retry is appropriate only after the observed condition has plausibly changed (for example, cooldown expiry or a corrected transport).

## Changing the proxy setting

Prefer the FreeLLMAPI settings surface. If it cannot be operated without computer use and a local database change is the only safe route, first create and verify a SQLite backup using SQLite's backup API, stop the FreeLLMAPI desktop process tree, make one narrowly scoped transaction, restart the app, and verify the loaded setting in `freeapi.log`. Never edit the database while the app is running or restore a whole database from an ad-hoc export.

Free upstream availability remains an external dependency. Achieving a contractual uptime target would require an explicitly authorized paid or independently operated inference fallback; do not silently add one or fall back to local models.
