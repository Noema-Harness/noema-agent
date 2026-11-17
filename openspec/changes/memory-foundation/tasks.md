# 任务：记忆底座（个体级第一版）

## 1 规格与迁移

- [ ] 1.1 `openspec/changes/memory-foundation/specs/personal-memory/spec.md` 写规格增量（改写“不得后台抽取”、新增来源/确认/失效/审计要求）
- [ ] 1.2 `apps/desktop/src/shared/contracts/noema-bridge.d.ts` 增加记忆类型与五个方法
- [ ] 1.3 `apps/desktop/src/main/chat/migrations.ts` 加 schema 44：`agent_memories`、`agent_memory_audit`、`agent_memory_fts`
- [ ] 1.4 `apps/desktop/src/main/chat/social-chat-schema.ts` 版本改 44；迁移测试覆盖新表与重复迁移幂等

## 2 存储与检索

- [ ] 2.1 新建 `apps/desktop/src/main/chat/agent-memory-store.ts`：`create`/`list`/`get`/`confirm`/`retract`/`supersede`/`search`/`audit`
- [ ] 2.2 检索只取 `active` 且未过期；复用 `buildMemorySearchExpression`；字符预算与条数上限
- [ ] 2.3 `apps/desktop/test/main/chat/agent-memory-store.test.mjs`：中文句命中、候选不命中、确认后命中、替代后旧条目不命中、撤销后不命中、审计追加
- [ ] 2.4 迁移测试：43→44 后旧表仍可用、新表存在、重复迁移不报错

## 3 服务与通道

- [ ] 3.1 `apps/desktop/src/main/chat/social-chat-service.mjs` 增加五个代理方法与一条审计写入
- [ ] 3.2 `apps/desktop/src/main/ipc/root-ipc.mjs` 增加五个通道
- [ ] 3.3 `apps/desktop/src/shared/bridge/create-bridge.ts` 与 `apps/desktop/src/preload/preload.ts` 接线
- [ ] 3.4 `apps/desktop/test/main/ipc/bridge-transport.test.mjs` 增加通道用例
- [ ] 3.5 `apps/desktop/test/main/chat/social-chat-service.test.mjs` 增加确认前不可检索、确认后可检索的服务级用例

## 4 界面

- [ ] 4.1 新建设置里的「记忆」面板：分组（待确认 / 生效 / 已失效）、来源、确认、撤销、空态
- [ ] 4.2 面板接线到 bridge，并在设置入口挂上
- [ ] 4.3 `apps/desktop/src/renderer/styles/index.css` 补样式（桌面与窄窗）

## 5 收口

- [ ] 5.1 更新卡片 #166 正文的「现在能做什么」与「还没做」
- [ ] 5.2 `docs/STATUS.md` 记验证结果与未验证项（界面真机手测、旧记忆数据迁移）
- [ ] 5.3 `npm run typecheck`、`npm run milestone:check`、`npm run check` 全绿后收口