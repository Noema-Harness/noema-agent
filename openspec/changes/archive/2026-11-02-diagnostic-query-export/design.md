# Design

## Context

B1 provides `diagnostic_events` with bounded execution/task queries. `ModelUsageStore` owns token/cache facts but currently stores only the legacy `interaction_id`; its rows cannot be joined to B1 request IDs. `SocialChatStore.getSocialWorkTask()` returns useful execution steps alongside private prompt/result/path fields, so the query boundary must project an explicit safe DTO. Existing `scripts/model-usage-diagnostics.mjs` exports those sensitive domain records and is not a safe in-app export implementation.

Reference evidence:

- `.work/planning/research/mxc/DIAGNOSTICS_PRIVACY.md`: separate structured audit from richer request diagnostics; closed fields and explicit sinks make privacy scope inspectable.
- `.work/planning/research/goose/DIAGNOSTICS_DEBUGGING.md`: summary/full diagnostics have materially different sensitivity, and truncation alone does not make a report safe.
- `.work/planning/research/openhands-sdk/DIAGNOSTICS_OBSERVABILITY.md`: report metadata/coverage and consent boundaries are separate from runtime tracing.
- `.work/planning/research/pi/PI_TELEMETRY_DISTRIBUTION.md`: trace identity propagation and local event ownership do not imply a user-facing query surface.

## Goals / Non-Goals

**Goals:**

- Let the user inspect recent local executions, a selected turn/task timeline, correlated provider token/cache usage, task/tool statuses, and explicit coverage gaps.
- Preserve existing storage owners and expose only purpose-built read DTOs through trusted main-frame IPC.
- Make a user-triggered, versioned report that contains allowlisted event and usage metadata only, with an exact preview before save.

**Non-Goals:**

- Do not export or display prompts, chat bodies, task result text, workspace paths, commands, credentials, or unrestricted error messages.
- Do not create telemetry upload, automatic collection/retention beyond B1, or a new source of task/provider state.
- Do not claim RootAgent/DSH legacy, OS child PID lifecycle, or per-row business-store writes are covered when their owners do not emit those facts.

## Decisions

### 1. Add request identity to the usage owner's records

Extend `model_usage_records` additively with nullable `request_id`, `execution_id`, and `turn_id`. New provider callbacks already supply these IDs; `ModelUsageStore.record()` stores them while preserving `interaction_id` for existing reports and callers. `getRecent()` exposes the new IDs; migration leaves old rows null and query results mark their linkage as unavailable. Do not copy token counts into `diagnostic_events` or infer joins from timestamps/model names.

**Alternative considered:** match usage to events by `interaction_id` or nearest timestamp. Rejected because SocialChat's legacy interaction ID is the assistant message ID, which differs from the turn ID, and concurrent/retried requests make time-based joins ambiguous.

### 2. Put joins and field projection behind a main-process query service

Add `DiagnosticsQueryService` with bounded `listRecent`, `getTimeline`, `getExportPreview`, and `writeExport` operations. It reads `DiagnosticsEventStore`, `ModelUsageStore`, and `SocialChatStore`; it never writes their business state. For task details it calls the task owner and projects status, verification status, error code, and step category/status/effect status only. For turn timelines it uses the event execution ID and request ID to join usage rows. Missing historic IDs, absent events, truncation, or unavailable tables are explicit coverage metadata, not zero values.

The recent list is derived from event executions, bounded to 50 entries; an opened timeline is bounded to 500 events. The preview and report use the exact same assembled DTO and include schema version, generated time, selected execution/task IDs, record counts, included field categories, exclusions, and coverage gaps.

**Alternative considered:** query SQLite directly from the renderer or expand the existing diagnostics CLI. Rejected because renderer-side SQL breaks the preload boundary, while the CLI intentionally includes sensitive domain content.

### 3. Keep export local, explicit, and narrower than the CLI

The renderer first requests a preview. On explicit save, main opens the native Save dialog and writes the same projected report as UTF-8 JSON. Cancel creates no file; a write error returns a bounded error code and leaves source records unchanged. No path supplied by the renderer is trusted, and the report is never uploaded. An export manifest states that prompts/messages/results/paths/commands/credentials/full error text and unsupported legacy/process/store detail are excluded.

### 4. Expose read-only queries through root IPC and a dedicated in-app view

Add narrowly named root IPC channels and preload methods; they inherit A3's trusted-main-frame check. A dedicated diagnostics dialog is launched from the SocialChatApp shell and presents recent execution rows, timeline detail, loading/empty/error states, export preview, and save/cancel controls. It does not reuse the provider-configuration settings dialog. It displays unsupported coverage as a visible boundary note.

### 5. Versioned safe report contract

Export schema v1 includes only:

- execution/event IDs, timestamps, module/operation/status/error code, and bounded allowlisted details;
- provider/model labels, request status, usage-received flag, numeric token/cache metrics, and request/execution/turn IDs;
- safe task status/verification metadata and tool category/status/effect status;
- export manifest and explicit coverage gaps.

It excludes provider cost JSON if it contains opaque provider payload, and excludes external-usage rows without stable request identity in this iteration. Export count/size are bounded; preview reports truncation before writing.

## Risks / Trade-offs

- [Old usage rows have no request identity] → keep their metrics visible only in aggregate/legacy summaries and show them as unlinked; never guess a request association.
- [Task DTO accidentally leaks private fields] → construct every response/export field explicitly and test sentinel prompt/path/result values are absent from serialized output.
- [Large traces make UI/export slow] → cap list/timeline/report rows, return truncation metadata, and query by indexed execution/task/request IDs.
- [Renderer invokes privileged channels from a frame] → use existing `registerRootIpc` trusted main-frame wrapper; test untrusted and child frames reject before query/save dialog.
- [Export directory write fails] → surface a bounded UI error; never mutate or prune the event/usage/task owners as a side effect.

## Migration Plan

1. Add nullable usage identity columns with additive SQLite migration; retain existing rows and `interaction_id` semantics.
2. Implement and test the query projection/export contract before exposing IPC.
3. Add trusted IPC/preload and the diagnostics dialog; verify preview and saved report are byte-for-byte based on the same projected DTO.
4. Rollback needs no data deletion: older binaries ignore the nullable columns and the report feature. Keep event and usage rows intact.

## Open Questions

None. The B1 coverage limits are explicit and will be displayed as gaps; later phases can add those sources without changing this report contract.
