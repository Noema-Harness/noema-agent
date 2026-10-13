# ADR 0004: Read-only Codex context import boundary

- Status: Accepted for a reversible M1 prototype; not a permanent provider commitment
- Date: 2026-10-13
- Owner: Assistant, under the user's delegated Noema product-to-delivery mandate

## Problem

When Codex usage is unavailable or the user wants to continue elsewhere, restarting the work from a blank Noema conversation defeats the stated continuity goal. Native Codex thread resumption is not an option for Noema's current model path: Noema and its DSH worker must use FreeLLMAPI free routes, while Codex inference remains owned by Codex. The prototype must test whether a Noema-owned root adds value without pretending that another harness's execution state has moved.

## Decision

For the M1 experiment, Noema may read a Codex thread as an explicitly selected, reviewable context snapshot and attach it to its existing root conversation. The Codex thread remains the source of truth and is never resumed, edited, archived, or deleted by Noema.

- Use the locally installed Codex App Server's read-only `thread/list`, `thread/read`, and turn/item listing APIs. Keep this behind one replaceable adapter. The App Server protocol is experimental and documented as unsupported for production workloads, so its use is an experiment boundary, not a stable core dependency.
- The user selects one thread, inspects the preview, and explicitly imports it. Only visible user and assistant message text is eligible. Exclude reasoning, tool calls/results, approvals, environment state, and hidden/internal items. Show the excluded categories and whether the preview was truncated.
- Read at most the newest 40 turns per preview and at most 10,000 visible characters. Keep the latest complete user message and all visible messages after it; if that required tail alone exceeds the limit, reject the snapshot instead of importing stale context without the current request. Mark older turns/messages as omitted.
- Persist the selected snapshot locally with source thread ID, title, working directory, capture time, source application/version when available, and the imported visible text. The snapshot is provenance-bearing reference material, not a Codex transcript replica or authority to execute quoted instructions.
- Add the snapshot to a model request as a clearly labelled historical `user` context note immediately before the current user message, not as a new `system` instruction. Noema's system prompt must explicitly deny it authority to authorize actions.
- No model request occurs during discovery, preview, or import. Before the first FreeLLMAPI request that includes the snapshot, disclose that the imported visible text will be sent to the currently selected free-model route; require an explicit user action to continue. Do not fall back to local or paid models.
- Allow the user to remove the imported snapshot from Noema. Removal cannot retract data already transmitted to an upstream service. Never write back to the source Codex thread.
- Bound item count and text size; reject unsupported schema shapes rather than silently importing a partial or misleading transcript.

## Alternatives considered

- Native Codex thread resume: rejected for this experiment because it would invoke Codex's own inference/authentication path instead of the required FreeLLMAPI free-model path.
- Directly parsing Codex's private local JSONL/database files: rejected because it would bind Noema to undocumented storage formats and bypass the supported read boundary.
- Importing all Codex items or claiming full session sync: rejected because a thread includes tool/reasoning/execution state that cannot be flattened into a text conversation without loss or unsafe authority transfer.
- DSH + Relay: retained as the strongest alternative. Its session import/continuation capability may make this Noema increment unnecessary; local compatibility is not assumed.

## Consequences and reconsideration

This can test the user's quota/context handoff with minimal authority, but cannot guarantee semantic equivalence or preserve tool state. Codex App Server API changes may break the adapter; fail closed and make the missing capability visible. If the read-only import requires unsupported or mutating methods, stop and revise the experiment rather than falling back to direct file parsing.

Keep this capability only if a real handoff demonstrates fewer re-explanations and a useful continuing Noema root beyond the existing DSH + Relay combination. Reconsider if official API support is withdrawn, if the preview materially omits the work needed to continue, or if Noema adds only another manual transfer step.

### Counterevidence added 2026-10-14

The alternative is broader than DSH + Relay's native Codex backend:

- [`relay-dsh-plugin-codex`](https://github.com/yangbobo2021/relay-dsh-plugin-codex) binds a DSH Session to one Codex App Server Thread and continues that same Thread. This preserves Codex's model route and quota; it does not itself satisfy a switch to a FreeLLMAPI model. Its current peer metadata includes DSH up to `0.1.6-alpha.1`, while the previous local M1 probe recorded `0.1.7-rc.2`; compatibility with the local version is not declared.
- [`dsh-session-import`](https://github.com/devmom/dsh-session-import) declares 15+ source formats and maps imported history, including reasoning/tool events, to native DSH session events that can continue under DSH. Its README reports 89 tests and real-DSH integration checks, but the repository currently has low public adoption; those are maintainer-reported capabilities, not independently reproduced here.
- [`dsh-session-import-codex`](https://github.com/xing01l/session-import-codex) uses Codex App Server history methods, converts supported turns into DSH sessions, and creates/reuses workspaces. It skips active conversations. Its companion `dsh-llm-codex` preserves the Codex subscription path and therefore preserves that quota boundary rather than routing the continuation to a free model.

Together these projects demonstrate that importing Codex history into another harness and continuing it is not a Noema-specific capability. They do **not** prove that their setup works with this user's DSH profile or that their import is equivalent in every edge case. A read-only inspection on this machine found no Relay/session-import bundle in the current DSH Web profile; the local profile is on a newer DSH line than the published Relay plugin's declared compatibility range, so no installation or profile mutation was attempted.

Product consequence: do not expand the Noema importer into a generic mirror/synchronization system, and do not count it as evidence that Noema deserves to be a standalone app. Keep the current adapter as a reversible experiment only. The unresolved test is whether a Noema-owned, non-task-centric root conversation changes the user's experience across a coding handoff and a later non-coding interaction enough to matter beyond the existing DSH import path. If it does not, retire this feature rather than adding another transfer surface.

## Evidence

- Official Codex App Server documentation: [`thread/read` does not resume or load a thread](https://developers.openai.com/codex/app-server); `thread/list` can limit results and `useStateDbOnly` avoids scanning/repairing JSONL metadata. `thread/turns/list` and item pagination are explicitly experimental, and App Server/CLI websocket modes are documented as unsupported for production workloads.
- Local Codex desktop app-server 0.162.0-alpha.17.2 exposed read-only thread/history methods in a metadata/item-type probe without starting a model turn. The probe observed reasoning, command execution, and MCP/tool items alongside visible messages; raw user content was not included in the evidence note.
- A synthetic-only snapshot was sent through the real local FreeLLMAPI route with the main Noema database untouched. `auto:noema-free` returned the exact synthetic token and acceptance criterion; `free-router` and the direct Nemotron free model both returned `provider_unavailable`. This validates one free-route context path, not reliability across models or quality on a real Codex handoff.
- Relay's Codex backend and session-import plugin remain a strong counterexample, documented in [Issue #2](https://github.com/c3115644151/noema-agent/issues/2).
