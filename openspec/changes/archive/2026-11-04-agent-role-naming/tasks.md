# Tasks

## 1. Naming contract

- [x] 1.1 Update both model-created agent schemas and Noema's agent-creation guidance to require role-based names and allow personal names only on explicit user request; verify tool contract tests cover specialist and project-team creation.
- [x] 1.2 Add the specialist-agent spec delta for ordinary role names and explicit user-requested persona names; verify `openspec validate agent-role-naming --strict --no-interactive` passes.

## 2. Integration checks

- [x] 2.1 Run the focused model-tools test and `npm run check`; verify existing agent flows remain unaffected.
- [x] 2.2 Review the diff and ensure no database migration or rewrite of existing agent names was introduced.

## Workflow follow-up

- Archive the change after implementation and validation are complete.
