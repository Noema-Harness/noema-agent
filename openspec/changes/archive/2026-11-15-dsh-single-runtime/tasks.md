# Tasks

## 1. Execution runtime

- [x] 1.1 Create `apps/desktop/src/main/legacy/` and move `NoemaProjectExecutor` there.
- [x] 1.2 Update migration tests and scripts to import the legacy path.
- [x] 1.3 Remove `NoemaProjectExecutor` and command-mirror construction from `main.ts`.
- [x] 1.4 Make `SocialWorkService` receive only the synthetic test adapter or DSH adapter.
- [x] 1.5 Add `legacy/README.md` and the production-import boundary in `scripts/source-structure.mjs`.
- [x] 1.6 Run `npm run source:check`, `npm run typecheck`, focused execution tests, and full `npm run check`.

## 2. Runtime distribution

- [x] 2.0.1 Prefer a pinned `resources/dsh-runtime` bundle over PATH, with external DSH only as a developer fallback.
- [x] 2.0.2 Stage Node and DSH into the packaged application (`runtime:stage-dsh` + `extraResource`).
- [x] 2.0.3 Verify a work ticket with no external DSH or Node installed.
- [ ] 2.0.4 Record the DSH/model compatibility matrix before moving chat loops.

## 3. Runtime contract

- [x] 3.1 Add session profiles `noema`, `specialist`, `executor`, `group-lead` with explicit tool and context policy.
- [x] 3.2 Add a loopback MCP tool server and let the DSH worker patch attach it; verify tool listing and call in unit tests.
- [x] 3.2.1 Verify packaged main chat calls `start_work_ticket` through MCP, creates a task for `noema-executor`, and writes no file itself.
- [ ] 3.3 Record profile, task card, workspace, and permission policy on each run.
- [ ] 3.4 Remove the production RootAgent model loop and route Noema chat through the DSH profile. Main social chat is DSH; RootAgent remains.
- [ ] 3.5 Remove SocialChatService's direct model loops for specialist, group, and project member turns.
- [ ] 3.6 Move context compaction entirely to DSH; keep only compression events in Noema.

## 4. Product boundary

- [ ] 4.1 Introduce task-card draft/assign/waiting/review states and two-way messages.
- [ ] 4.2 Allow assignment to one executor or a team; team uses lead + member sessions, not a second runtime.
- [ ] 4.3 Reroute project-member `start_project_work` through the card/run contract.
- [ ] 4.4 Keep ordinary chat and read-only consultation card-free.
- [ ] 4.5 Migrate historical `agent_id='noema'` runs to read-only legacy records.

## 5. Verification

- [ ] 5.1 Test each profile cannot access another profile's tools, memory, or workspace.
- [ ] 5.2 Test DSH unavailable fails closed with no legacy fallback.
- [ ] 5.3 Test a task card survives app restart and resumes in the same DSH session where safe.
- [ ] 5.4 Test team card: one lead, member sessions, shared workspace, single result.
- [ ] 5.5 Run packaged smoke and real provider acceptance after phases 2–3.
