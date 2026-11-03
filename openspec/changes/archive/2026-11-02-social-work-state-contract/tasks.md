# Tasks

## 1. 固定 task 状态 owner 与恢复契约

- [x] 1.1 按 `migrations.mjs`、`records.mjs`、`SocialChatStore`、`SocialWorkService`、`SocialChatService` 和 `NoemaProjectExecutor` 建立 task/status/phase/step/effect/checkpoint/run-handle owner 矩阵；项目结果字段的直接 SQL 写入已收归 SocialChatStore API，生产 task 持久状态写入只经过 SocialChatStore。
- [x] 1.2 扩展 `social-chat-store.test.mjs`：重开 store 时 active task 按规则中断、completed/failed/interrupted 终态保留；旧 DSH engine 即使有相似 checkpoint 也不能通过 Noema 恢复门禁；项目结果 task 元数据由 SocialChatStore API 写入和清理。3 个针对性 store 用例通过，work service/executor 53 项通过。完整 store 文件仍有 4 个其他失败，见交付记录。
- [x] 1.3 运行 `npm run typecheck`、`npm run source:check`、`openspec validate social-work-state-contract --strict` 和 archived/spec validation；对照状态矩阵核验代码、规格与数据库 schema 一致。

## Workflow follow-up

- [x] 归档已完成 change 并核对主规格和 archive 状态。
