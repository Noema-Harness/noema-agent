# Tasks

- [x] 1. Add a bounded store query for recent, completed, user-authored messages in a specified project group.
- [x] 2. Build the direct-read allowlist from original request, current user message, and bounded group history; keep agent messages excluded and update the model-facing explanation.
- [x] 3. Add integration coverage for reading a URL from an earlier user group message, rejecting agent-authored URLs, and trimming Chinese punctuation.
- [x] 4. Run full verification, confirm the live reader can fetch a URL from the real project’s historical user message, then archive the change.
