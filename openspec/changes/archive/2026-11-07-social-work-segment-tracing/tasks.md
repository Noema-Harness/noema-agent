# Tasks

## 1. Implementation

- [x] 1.1 Propagate stable task ID, unique execution-segment ID, and original source turn ID from SocialWorkService through NoemaProjectExecutor to provider requests.
- [x] 1.2 Preserve task-versus-segment identity when mapping provider request events into diagnostics.
- [x] 1.3 Add a file-backed SQLite test that resumes through separate Node processes, preserving identity, no tool replay, and diagnostic redaction across repeated restarts.
- [x] 1.4 Add an isolated Electron renderer probe for stale task-event non-regression and durable task projection after renderer reload.
- [x] 1.5 Add assertions that request diagnostics and usage persistence/query/export use the same task, segment, and source-turn identities; execution remains part of the unified Stage 4 gate.
- [x] 1.6 Run the complete Stage 4 acceptance gate after S4-01 through S4-04 implementation is complete.
