# Design

## Context

`ModelUsageStore.getRecent()` already selects `requestCharacters`, `toolDefinitionCharacters`, `messageCount`, and `toolCount`; `getForDiagnostics()` currently omits them. The diagnostics timeline therefore cannot display measurements that are already stored. Older rows and synthetic/headless usage can lack these values.

## Goals / Non-Goals

**Goals:**
- Carry existing nullable measurements through the diagnostics DTO to the timeline.
- Label character counts as characters, never tokens; show missing values as unavailable.
- Keep prompt and message bodies out of the timeline and preserve existing export scope.

**Non-Goals:**
- Add per-message content or role breakdowns.
- Add token estimation, cache-hit inference, or provider calls.
- Change the SQLite schema or model request payload.

## Decisions

- Extend the `getForDiagnostics()` projection using the already persisted columns. No migration is needed.
- Extend `NoemaDiagnosticUsage` with nullable shape fields, and display them as a compact secondary line on each request in the timeline.
- Use `requestCharacters IS NULL` as the legacy/absent-shape discriminator. Existing schema normalized missing message/tool counts to zero, so when the request JSON character count is absent all four values are returned as null; when it is present, a genuine zero tool count remains visible as zero.
- Treat `requestCharacters` as serialized messages JSON characters and `toolDefinitionCharacters` as serialized tool-schema characters. These are local size indicators, not tokenizer-equivalent values.
- Keep current export DTO unchanged; this request is specifically for in-app inspection, and exports remain limited to their existing reviewed fields.

## Risks / Trade-offs

- Character counts do not predict token counts exactly → label the units and retain provider-reported token usage beside them.
- Existing or non-provider records may have null measurements → render “不可用” rather than zero.
- Showing aggregate shape can still reveal approximate request size → it is local metadata with no message contents, consistent with existing usage storage.

## Migration Plan

No database migration. Old rows remain readable with null fields.
