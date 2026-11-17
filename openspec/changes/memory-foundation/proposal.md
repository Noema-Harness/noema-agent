# 提案：记忆底座（个体级第一版）

## 为什么

记忆是成长的底座，也是长期伙伴关系的实际载体，但当前实现只覆盖了两个窄面：

- 主聊个人记忆（`social_user_memories`）只能手写，检索把整句当成一个 trigram 短语，中文自然句 Recall@5 实测 25%。
- 成员资产是五条固定 markdown 路径，按字符预算整体塞进系统提示词，没有来源、没有确认、没有失效。

用户 2026-11-17 已定三件事：第一版只做个体级；事实/承诺/约束由 agent 提议后必须用户确认才可被检索，情境/偏好自动生效但可见可撤销；经验资产毕业要任务级评测加用户确认。外部七家同类产品（fish-memory、dsh-soul、dsh-agent-soul、xingxi、memory-brain、SeekMemory、mnemosyne）没有一家做到条目级来源可追溯与用户审批，这是可以做出差别的地方。

## 改什么

1. **表结构**（schema 44）：`agent_memories`（一条断言：scope、agent、kind、content、status、trust、来源四列、valid_from/to、superseded_by、confirmed_at）、`agent_memory_audit`（确认/撤销/替代的追加审计）、`agent_memory_fts`（FTS5 trigram，随写入同事务同步）。
2. **存储与检索**（`apps/desktop/src/main/chat/agent-memory-store.ts`）：`create` / `list` / `get` / `confirm` / `retract` / `supersede` / `search`；检索只返回 `active` 且未过期，按 bm25 + 字符预算；查询装配复用 3-gram OR 展开。
3. **服务与通道**：`SocialChatService` 增加五个方法，root-ipc 增加五个通道，bridge 增加五个方法，契约增加类型。
4. **界面**：设置里新增「记忆」面板——按状态与来源列出、确认候选、撤销、查看来源消息或项目。
5. **规格增量**：`openspec/specs/personal-memory` 改“不得后台抽取”为“可提议候选、事实类需确认”，并新增来源/失效/审计要求。

## 影响

- 现有 `social_user_memories` 暂不删除，第一版新表与其并存；迁移到新表放进下一轮（要一并决定旧数据的 scope 与 trust）。
- 无新增依赖：FTS5 trigram 与 better-sqlite3 已在用。
- 升级需要 schema 43→44，迁移前备份已有机制（`main.ts:614`）。

Plan: https://github.com/Noema-Harness/noema-agent/issues/166