# 任务：governance-interface

## 1 结构

- [ ] 1.1 `governance/core/interface.mjs` 动词表（名称/参数/落点/门）与校验
- [ ] 1.2 `scripts/interface.mjs` 接线（record/move/check）

## 2 S6 过渡文档唯一性与就地更新

- [x] 2.1 内核 `pickTransitionTarget` / `duplicateTransitionDocs`（验证：kernel:test「transition documents stay unique」，两份同类返回 error+duplicates）
- [x] 2.2 `scripts/transition.mjs`：`--write` 默认就地更新，`--new` 才新建（验证：kernel:test「transition --write updates in place and only --new creates a second file」，就地更新加修订头、无理由 --new 拒绝）
- [x] 2.3 precommit notice（规则 `transition-doc-singleton`）（验证：`node scripts/maintenance.mjs precommit` 在 .work/review 出现两份同类时打出提醒；归档旧稿后不再出现）
- [x] 2.4 单测：两份同类报错、就地更新、`--new` 通过（验证：kernel:test 22/22）

## 3 S1 check 三合一

- [ ] 3.1 `check stage <phase>`
- [ ] 3.2 `check acceptance --write`
- [ ] 3.3 `check transition <kind> --write`
- [ ] 3.4 旧命令转发与单测

## 4 S2 record 五合一与写盘印记

- [ ] 4.1 `record round|pending|settle|acceptance|field --from <file>`
- [ ] 4.2 写盘后哈希印记 `.work/decision-writes/`
- [ ] 4.3 单测：一意图一调用

## 5 S3 提交前印记校验

- [ ] 5.1 `precommit` 校验暂存区哈希
- [ ] 5.2 `move --restore --from <commit>`
- [ ] 5.3 单测：手改被拒、恢复可用

## 6 S4 move

- [ ] 6.1 `move <stage>` 一次校验设计稿/提案/批次/覆盖/原因
- [ ] 6.2 批次两行模型与续接
- [ ] 6.3 单测：续接与 `--new-batch`

## 7 S5 净零与门数

- [ ] 7.1 `governance audit` 输出命令/参数/门计数
- [ ] 7.2 未写净额的新门被拒

## 8 收尾

- [ ] 8.1 规则包、OPERATIONS、技能同步
- [ ] 8.2 `npm run check` 全绿
- [ ] 8.3 更新 STATUS 与看板卡片正文
