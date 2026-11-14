# Tasks

## 1. Schema and legacy backfill

- [x] 1.1 Bump `SOCIAL_SCHEMA_VERSION` to 37 and add `conversation_branches`, `conversation_turns`, `conversation_active_branch` with indexes.
- [x] 1.2 Implement idempotent backfill from `social_messages.turn_id` and existing boundary markers; assign legacy branches, heads, and the active branch without deleting messages.
- [ ] 1.3 Add migration tests for message count/order, repeated runs, incomplete turns, and rollback on malformed data.

## 2. Continuity store API

- [x] 2.1 Add `listContinuityBranches`, `getContinuityState`, `createContinuityBranch`, `switchContinuityBranch`, `createPendingTurn`, `commitTurnCheckpoint`.
- [x] 2.2 Enforce branch/room/agent invariants and CAS on `head_version`; reject writes to read-only legacy branches.
- [ ] 2.3 Add `getContinuityContext` that follows the ancestor turn chain and excludes sibling branches and system boundary markers.
- [x] 2.4 Add unit tests for branch isolation, CAS conflicts, ancestor ordering, and read-only legacy branches.

## 3. Shadow/on integration

- [x] 3.1 Add `NOEMA_CONTINUITY_MODE=off|shadow|on`; default `shadow` for internal builds.
- [x] 3.2 In shadow mode, mirror completed turns into the new tables while leaving reads on the old path; add consistency diagnostics.
- [ ] 3.3 In on mode, route send/retry/edit through branch APIs; `rewindConversationToMessage` returns `continuity_branch_required` and never deletes.
- [x] 3.4 Add service tests proving edit creates a child branch and old messages remain.

## 4. IPC and contracts

- [x] 4.1 Add IPC/preload/`noema-bridge.d.ts` methods for continuity state, list, create branch, switch branch, edit.
- [x] 4.2 Validate room/branch/version inputs and map errors to typed codes.

## 5. Renderer

- [x] 5.1 Replace the primary new/history actions with branch selector + current branch label; keep old threads accessible as legacy read-only.
- [x] 5.2 Change edit confirmation to “从这一轮创建新分支并重发，原分支保留”; show branch origin/read-only state.
- [ ] 5.3 Add empty/loading/error states and keyboard/focus behavior for the branch menu.

## 6. Crash recovery

- [x] 6.1 On startup, mark uncommitted streaming turns interrupted and preserve committed checkpoints.
- [ ] 6.2 Make retry reuse the same user message/turn and increment assistant attempt only.
- [ ] 6.3 Add recovery tests for app restart mid-reply and retry-after-interrupt.

## 7. Migration and rollout

- [ ] 7.1 Run shadow mode against a copy of the real profile; compare old/new message sets and branch counts.
- [x] 7.2 Switch internal builds to on mode; verify legacy continuation forks a new branch.
- [ ] 7.3 Keep `off` fallback for one release; document rollback and cleanup.

## 8. Verification

- [x] 8.1 Run targeted store/service/migration tests and full `npm run check`.
- [ ] 8.2 Run a real Electron turn, edit, branch switch, and restart recovery.
- [ ] 8.3 Update `docs/architecture/noema-system-atlas.html/.png` and runtime flow with branch/checkpoint implementation status.
- [ ] 8.4 Package and install a release with the continuity change; keep 0.6.9 as rollback.
