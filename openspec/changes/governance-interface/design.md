# 设计：治理接口收敛

## 事实影响

- 类别：仅执行
- 依据：只改治理工具、规则包与条目操作方式，不改产品行为、数据与发布产物。

## 用户决策

- 设计方案 §11（v4）经用户 2026-11-19 批准，原话「可以通过」。
- 开工清单经用户 2026-11-19 批准，原话「可以」。

## 目标

- 一个意图一次调用；正常推进一轮需要记住的附着动作不增加。
- 写入口有强制力，文档只有一份。

## 非目标

- 不追求把治理做成通用框架（等记忆试点后再议）。
- 不删除旧别名（本批只加新入口与转发）。

## 结构

```
governance/core/interface.mjs   动词表（名称、参数、落点、门），纯数据 + 校验
governance/core/transitions.mjs 过渡文档选目标与唯一性（S6）
governance/core/edits.mjs       既有文本操作（record 复用）
scripts/interface.mjs           record / move / check 的 CLI 接线
scripts/transition.mjs          就地更新与唯一性（S6）
scripts/maintenance.mjs         写盘印记校验（S3）与文档唯一性 notice（S6）
```

## 取舍

- 长文本走文件：多一次写临时文件，但避免命令行转义写坏中文（已发生两次）。
- 印记而非数据库：git 仍是事实来源，印记只证明「这条改动经过了接口」。
- 文档唯一性先 notice 两个里程碑：避免误伤历史遗留的多份文件。

## 用户可观察的改变

- `npm run transition -- design --write` 第二次运行会更新原文件，而不是新建。
- 手改 `docs/DECISIONS.md` 后提交会被拒，报错给「用 record/move 重做」的修法。
- 同类文档出现两份时，`check transition` 报错并给出合并建议。

## 手测步骤

1. 跑 `npm run check -- transition design --write` 两次，确认 `.work/review/` 里 design 只有一份。
2. 直接改 `docs/DECISIONS.md` 一行并 `git add`，跑 `node scripts/maintenance.mjs precommit`，确认被拒。
3. `npm run governance audit` 查看命令数、参数数、门数。

## 验收

- [ ] S6：同类文档 ≥2 份时报错；第二次 `--write` 就地更新
- [ ] S1–S2：`record` 五个意图各一次调用落盘；`check` 三个只读入口可用
- [ ] S3：无印记的 `DECISIONS.md` 改动被 precommit 拒绝，`--restore` 可恢复
- [ ] S4：重开后再进执行续接同一 change；`--new-batch` 才另开
- [ ] S5：`governance audit` 输出三类计数；未写净额的新门被拒
- [ ] S7：`npm run check` 全绿，别名转发正常
