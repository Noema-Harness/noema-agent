Plan: none

## Why

验收页已经能按 E 生成，但反过来没有命令把验收项写回条目：`advance --stage 待验收` 要求验收项覆盖全部已定 E，条目里的验收项却只能手改 `docs/DECISIONS.md`——这正是治理要消灭的「绕开接口手改条目」。`D-20261118-decision-dialog-flow` 现有 6 条验收项覆盖不了 E1–E32，用现有命令无法补齐。

## What Changes

- `governance/core/edits.mjs` 新增 `replaceAcceptance(text, id, items)`：整体替换「#### 3 验收」小节的验收项行（`- [ ]` / `- [x]`），保留该小节里已有的阶段事件行。
- `scripts/decision.mjs` 新增子命令 `acceptance --entry <id> --from <file>`：从文件读取验收项行（校验必须以 `- [` 开头），替换后跑 `checkDecisionEntries`（含历史只增不删），失败不写盘；打印覆盖率与未覆盖 E。
- `scripts/maintenance.test.mjs` / `governance/core/kernel.test.mjs` 补用例：替换后历史只增门放行、覆盖率归零、缺文件/非法行拒绝。
- `docs/OPERATIONS.md` 命令与失败修法补 `decision -- acceptance`。

## 不在本批

- 验收页与条目验收项的双向同步（页面只是输入源之一）。
- 按 E 自动生成验收项文本（仍然由人写清「验证什么、怎么验」）。

## 影响

只改治理工具与条目写入路径；不改产品行为、不改条目结构。