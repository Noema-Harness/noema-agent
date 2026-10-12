---
name: noema-issue-workflow
description: Track substantial Noema product, architecture, or multi-file implementation work through the linked GitHub Issues and Project. Use when starting or finishing a tracked change, not for small mechanical edits.
---

# Noema Issue Workflow

1. Confirm the repository and project board recorded in `docs/PROJECT_OPERATIONS.md`; inspect the issue before changing status.
2. For substantial work without an issue, create one with `gh issue create -R <repo>` and include the user outcome, scope, acceptance checks, and relevant decision links. Do not create an issue for every small edit.
3. Add the issue to the linked project with `gh project item-add`; set Status/Priority/Workstream using field IDs recorded in `docs/PROJECT_OPERATIONS.md`. The issue is canonical for acceptance details; the project item is canonical for workflow state.
4. Move work to In Progress only when implementation starts. If blocked, name the exact missing input or dependency in the issue; do not leave stale status.
5. On completion, run only the checks relevant to the change, record their exact results and any remaining gaps on the issue, and move it to Review or Done according to acceptance.
6. Never claim that a project-board update, issue creation, test, or external operation succeeded unless the command returned success and the resulting state was checked.
