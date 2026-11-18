# 设计：治理一致性修正

## 事实影响

- 类别：仅执行
- 依据：只改治理工具（`scripts/`、`governance/`）与治理文档，`apps/desktop/src` 无改动，产品行为不变。

## 用户决策

- 用户 2026-11-19 原话：「你自行判断即可，这些事不必向我批示，我只关心的是预期行为是否符合我的目标」（m110914）；验收定位按 m110853「验收这件事…别再找我，也不应该定位为人去执行这个阶段」。
- 判定依据：偏差清单来自独立对照审查（`.work` 记录），修法按 E1/E18/E24–E36 的原意取最直的一条。

## 目标

- 36 条已定项与实际实现逐条对齐；差异只留「需要用户目标判断」的 0 处。

## 非目标

- 不新增阶段、不新增动词；不引入新文档体系；不动产品代码。

## 取舍

1. 批次：选「当前批次 + 批次历史多行」，而不是单行列表——`history.mjs` 按行计数就能只增不删，迁移时行数只增不减。
2. 净零：`audit` 不再占独立动词，收进 `check net`，保持三动词；接进 milestone（净增未写基线即红），不接进 commit（提交时不必跑）。
3. 印记：升级为阻断。误伤面只有「绕过命令改条目」，恢复路径是 `move --restore`，属设计内动作。
4. 开工清单：用结构校验 + 文档存在性做门，不用「批准原话」——原话已在决定行里，重复要求只是打卡。

## 用户可观察的改变

- 手改 `docs/DECISIONS.md` 后直接提交会被拦，提示走 `move --restore`。
- 没有开工清单就进不了执行中，报错给出 `npm run governance -- check transition` 的用法。
- `npm run governance -- check net` 输出规则/门/命令计数；只加不减会导致 milestone 红。

## 手测步骤

1. `npm run governance -- check net` → 输出计数、无差异。
2. 手改条目一行 → `git add` → `node scripts/maintenance.mjs precommit` → 必须失败并给恢复命令；随后 `npm run governance -- move --restore --from HEAD` → 通过。
3. `npm run governance -- check transition --kind kickoff` 结构校验；无 kickoff 时 `move` 进执行中被拒。

## 验收

- [ ] 批次两行模型落地，`history` 三类批次行统一计数，旧条目迁移后行数不减
- [ ] 进执行中要求 kickoff 文档且结构合格，条目留「开工清单：路径（日期）」
- [ ] 印记不一致时 `precommit` 失败，`move --restore` 可恢复
- [ ] `check net` 收进三动词，`milestone` 会跑它
- [ ] 文档残留清零：无「退回执行中」；README 标注试点/抽离挂起
- [ ] E24–E26 编号修复、E27 指称并入 E28、验收项覆盖 E1–E36 且覆盖门通过