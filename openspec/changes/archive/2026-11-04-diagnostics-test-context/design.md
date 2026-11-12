# Design

## Context

See `proposal.md`. The current diagnostics report is deliberately metadata-only, and RootAgent/DSH legacy paths have incomplete lifecycle instrumentation. Test data is stored locally in RootStore and SocialChatStore; the current export save path already requires a preview and user-selected local file.

## Goals / Non-Goals

- Let the user explicitly attach the selected turn's visible messages and related task input/result to a local support report.
- Trace RootAgent and DSH lifecycle boundaries with stable turn/task/request identities and allowlisted metadata.
- Keep default export metadata-only, redact credential-shaped text, bound every included text field, and never upload automatically.
- Do not include source file contents, model hidden reasoning, raw tool arguments/results, or change task execution behavior.

## Decisions

1. **Per-export opt-in.** Add an unchecked “实测上下文” option before preview. The existing safe export remains unchanged unless selected. The preview displays the complete resulting JSON and a sensitivity warning before local save.
2. **Narrow context retrieval.** Read only visible messages for the selected RootAgent turn, plus the selected SocialWork/DSH task's prompt, result, and bounded error text. Do not export prior unrelated turns, full model request payloads, file contents, or workspace path as a separate field.
3. **Content redaction and limits.** Apply the existing credential redactor and deterministic per-field/record limits. Mark redaction and truncation in the report so omissions are visible.
4. **Lifecycle events are observational.** RootAgent/DSH event writes use the existing diagnostics callback and cannot affect model, task, or child-process behavior. Do not persist PID, command, arguments, stdout, stderr, or paths.
5. **Local handoff only.** Preserve the existing user-selected save dialog. The report is a local artifact the user can inspect and share; Noema does not transmit it to a provider or remote service.

## Risks / Trade-offs

- [The user opts in while the selected text contains private information] → Keep the option unchecked, warn before preview/save, redact common credential formats, and show the complete report before saving.
- [Credential patterns miss an unfamiliar secret] → The user reviews the full export; the feature never uploads automatically.
- [Legacy lifecycle events still cannot represent every internal function] → Keep explicit coverage gaps for unsupported detail instead of reporting false completeness.

## Migration Plan

No database migration is required. Diagnostics export schema advances to v2; v1 reports remain valid artifacts. New diagnostic events use the existing versioned event table.
