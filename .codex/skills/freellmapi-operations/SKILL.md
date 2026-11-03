---
name: freellmapi-operations
description: Diagnose or verify Noema's FreeLLMAPI compatibility gateway, proxy, model catalog, or inference path before changing its settings or interpreting availability.
---

# FreeLLMAPI compatibility operations

FreeLLMAPI is a gateway and router, not a model provider. Distinguish a running desktop API, a readable authenticated catalog, a listed route, and a complete real generation. Only a generation verifies inference at that moment.

Discover the current desktop port from `%APPDATA%/FreeLLMAPI/config.json`; read proxy configuration from the active database or settings UI. Do not assume a remembered port, proxy, release, route or cooldown is current. Preserve user configuration and database integrity before changes.

Use `apps/desktop/scripts/smoke-freellmapi.mjs` for the no-generation catalog probe. Before any real request, follow `docs/CURRENT_CONTEXT.md` and inspect the probe's current route and live flags. A synthetic marker avoids sending private conversations; bounded success does not prove long-term availability.

Never print or copy the API key to a command line, report or scratch file. Use the application's normal encrypted credential path. Inspect only minimal redacted logs. Separate gateway, network, provider quota, model compatibility and route-exhaustion failures.

Prefer the settings surface for changes. A necessary direct database change requires a SQLite backup, stopped owning process, one scoped transaction, restart and verification. Do not edit an active database, blindly restore a whole database, retry indefinitely, or silently add providers or services.
