---
name: noema-project-work
description: Track substantial Noema product, architecture, or multi-file implementation work through its GitHub Issues and Project. Use when starting or finishing tracked work, not for small mechanical edits.
---

# Noema Project Work

1. Read `docs/PROJECT_OPERATIONS.md` for repository and Project details. Issues hold goals and acceptance conditions; the Project holds workflow state.
2. For substantial work without an issue, create one with `gh issue create -R c3115644151/noema-agent`. Include the user outcome, scope, acceptance checks, and relevant decision links. Do not create an issue for every small edit.
3. Add the issue to Project #6 with `gh project item-add 6 --owner c3115644151 --url <issue-url>`. Query current fields using `gh project field-list 6 --owner c3115644151 --format json` before editing custom values.
4. Move work to In Progress only when implementation starts. If blocked, apply `status:blocked` and state the exact missing input or dependency in the issue.
5. On completion, run only relevant checks, record their exact results and remaining gaps, and move the project item to Done only when issue acceptance is met. Use PR review state rather than adding another Project status.
6. Never claim that an issue, board update, test, or external operation succeeded unless the command returned success and the resulting state was checked.
