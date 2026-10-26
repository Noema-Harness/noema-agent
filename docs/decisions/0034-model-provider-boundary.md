# 0034: Keep Noema's model connection replaceable

- Status: Accepted
- Date: 2026-10-26

## Context

Noema's main chat and social agent services currently speak an OpenAI-compatible
Chat Completions protocol, but the connection code only accepts loopback URLs,
filters models through a FreeLLMAPI-specific allowlist, and labels the whole
product as FreeLLMAPI. That prevents users from connecting directly to a
compatible provider and makes an optional gateway look like a product
dependency.

## Decision

- Treat the configured model endpoint as replaceable. Keep FreeLLMAPI's
  verified route metadata as a supported local gateway behavior, while allowing
  standard OpenAI-compatible model catalogs and chat requests from remote HTTPS
  endpoints.
- Keep API keys encrypted in the OS-backed credential store. Store the active
  generic endpoint separately from the existing FreeLLMAPI credential so a
  provider change does not destroy the previous configuration. HTTP remains
  allowed only for loopback services.
- Use provider-native model IDs. For DeepSeek, default to `deepseek-flash` and
  explicitly disable thinking unless a later user-facing setting requests it;
  keep normal output bounded by Noema's existing per-request token limit.
- This is an OpenAI-compatible protocol boundary, not a claim that every model
  provider is interchangeable. Add a native protocol adapter only when a real
  provider capability cannot be expressed through the existing boundary.

## Consequences

- Noema can connect directly to DeepSeek and other compatible services without
  installing a local gateway; the gateway remains available as an option.
- Remote model requests carry the conversation and any explicitly attached
  context to the configured provider. The UI must identify that destination and
  must not imply that credentials or data stay local.
- Usage metering and provider-specific pricing remain separate from transport.
  A successful API probe records token usage, but does not yet provide durable
  per-turn cost accounting inside Noema.
- The current settings model still configures one active endpoint. Concurrent
  per-agent provider routing is not introduced without a demonstrated need.

## Reconsider when

A provider needed by the product cannot support Noema's tool-call, streaming,
error-recovery, or privacy requirements through the OpenAI-compatible boundary,
or when users need different providers active concurrently for distinct agent
roles.
