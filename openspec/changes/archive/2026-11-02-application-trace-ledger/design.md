# Design

## Source Basis

- `research/pi/PI_TELEMETRY_DISTRIBUTION.md`：Pi 用版本化 schema、显式 context 传播和 trace 查询；可选 exporter 不等于默认产品诊断。SQLite writer 的 failure/close 边界也需要由宿主处理。
- `research/goose/DIAGNOSTICS_DEBUGGING.md`：request、tool call、session identity 可跨 Agent→provider→tool 关联，但各诊断 sink 的权限/保留各异，SQLite transcript 不是 span store。
- `research/letta-code/DIAGNOSTICS_TELEMETRY.md` 与 `research/openhands-sdk/DIAGNOSTICS_OBSERVABILITY.md`：用于比对 local/remote scopes、event ownership 和敏感数据边界；不照搬其外部 telemetry 或完整内容导出模式。
- Noema 现状：A1/A3 的 route、authorization 当前写入 `renderer-health.jsonl`；ModelUsageStore 的 `interactionId`、SocialWork task id、Noema tool step id 各自稳定，但无统一父子关系。`createWindow()` 重新生成的 application execution ID 实际是 window identity，不能覆盖同一进程内多次 window lifecycle。

## Event Contract v1

| Field | Meaning |
|---|---|
| `event_id`, `schema_version`, `occurred_at` | Event identity, contract version, UTC time |
| `application_execution_id` | One main-process lifetime; new after process restart, unchanged when a window is recreated |
| `execution_id`, `parent_execution_id` | Stable root operation and optional causal parent; default chat turn uses turn ID, project work uses task ID |
| `task_id`, `turn_id`, `request_id`, `tool_call_id` | Optional typed references; do not overload one ID namespace |
| `module`, `operation`, `status`, `error_code` | Bounded diagnostic facts, not user-facing error text |
| `details_json` | Strict allowlist for route/capability/reason/request status/tool name/category/phase/recovery reason/verification status; credential redaction and string limits apply |

Event rows never store prompts, messages, paths, command text, tool arguments/results, API keys, or full error bodies. Domain stores keep those records under their existing policies; events point to task/turn IDs for a later local query.

## Ownership and Lifecycle

1. `DiagnosticsEventStore` owns its `diagnostic_events` schema migration, insert/query, retention and local write-health counters in the shared SQLite database. It does not own chat/task/usage state.
2. `applicationExecutionId` is generated once during main-process startup. Window recreation reuses it; process restart creates a new one.
3. Chat turn ID is the root `executionId`; SocialWork task ID is the root `executionId`. Provider requests get a fresh request ID and receive the root execution/turn/task context. Tool calls retain task execution ID and distinct provider call ID/step ID.
4. Route and authorization decisions, provider request outcome, task create/resume/stop/terminal/recovery, and executor tool-call/result events are recorded through an injected callback. RootAgent/DSH legacy paths remain explicitly outside this B1 default-path coverage until separately selected.
5. Process lifetime is currently represented by its enclosing executor tool-call/result pair; OS PID and per-child spawn/exit events are intentionally not persisted. Store writes remain owned by SocialChatStore/ModelUsageStore and are not duplicated as per-write diagnostics; task/request events reference their stable IDs. B2 must display these as explicit coverage boundaries rather than imply OS-process or row-level write tracing.
6. Event writes are best-effort and never share a transaction with a chat/task side effect. Failures increment in-memory diagnostic health counters; normal Agent work continues.
7. Retention is capped by row count (default 20,000). Query returns bounded pages by execution/task. No IPC/UI query is added in B1; B2 will expose a read-only query path.

## Validation

- Unit tests cover schema version, allowlist/redaction, execution/task joins, strict retention, and diagnostics write failure isolation.
- Targeted path tests assert provider request ID and task/tool events share the expected execution identity, and restart receives a new application ID while keeping task recovery visible.
- Existing stores remain authoritative; no real provider/network call is used.

## Risks

- A missing propagation site creates a visible break in a timeline. B1 can cover the selected SocialChat/SocialWork route but not claim RootAgent/DSH universal coverage.
- The executor does not currently expose child-process lifecycle callbacks to the event owner; a tool event identifies the operation but not an OS process. Business-store row writes also remain outside the event ledger.
- SQLite unavailability prevents event persistence; the in-memory failure count is diagnostic state, not durable evidence of the failure.
- Event metadata remains potentially sensitive in error/operation identifiers, so inputs are allowlisted, redacted and length-limited.
