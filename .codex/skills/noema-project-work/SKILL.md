---
name: noema-project-work
description: Track substantial Noema product, architecture, or multi-file implementation work through its GitHub Issues and Project. Use when starting or finishing tracked work, not for small mechanical edits.
---

# Noema Project Work

1. Read `docs/PROJECT_OPERATIONS.md` for repository and Project details. Issues hold goals and acceptance conditions; the Project holds workflow state.
2. For substantial work without an issue, create one with `gh issue create -R c3115644151/noema-agent`. Include the user outcome, scope, acceptance checks, and relevant decision links. Do not create an issue for every small edit.
3. Auto-add is configured for open issues/PRs, but API-created Issue #5 did not appear automatically during setup. Always verify the item exists on Project #6; add it with `gh project item-add 6 --owner c3115644151 --url <issue-url>` if missing, then query the resulting item. If `gh project` reports `unknown owner type`, use GraphQL `addProjectV2ItemById` with the project's ID and the issue/PR node ID. Query fields with `gh project field-list 6 --owner c3115644151 --format json` before editing custom values.
4. Use the actual lifecycle: Inbox → Backlog → Todo → In Progress → In Review → Done, with Blocked/Canceled as explicit branches. Newly added items start in Inbox; move to Todo only after Definition of Ready. Set Blocked only with a native `blocked by` relationship and a named blocker, not a `status:blocked` label.
5. On completion, run only relevant checks and record exact results and remaining gaps. Set Status to Done only after acceptance; this automatically closes the issue. Closing an issue does not automatically change its Project status. For canceled work, set Canceled before closing with the `not planned` reason.
6. Never claim that an issue, board update, test, or external operation succeeded unless the command returned success and the resulting state was checked.
