# Tasks

## 1. Diagnostics Workbench

- [ ] 1.1 Complete distinct list/timeline retry and stale-data states; verify with targeted renderer probe and diagnostics component review.
- [ ] 1.2 Add isolated diagnostic event fixtures and verify module/phase filtering, count, empty-filter clearing, and export scope remains execution-wide.
- [ ] 1.3 Verify desktop and 420px native renderer screenshots and no horizontal overflow; record screenshot evidence in `.work/ux-redesign/PROGRESS.md`.
- [x] 1.4 Run `openspec validate diagnostics-workbench-recovery --strict --no-interactive`, `node --check apps/desktop/scripts/social-agent-e2e.mjs`, formatting, and scoped `git diff --check`; all passed.
