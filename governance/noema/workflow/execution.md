# 执行

有范围就是在执行。一次把这一轮的任务做完，再谈验收。

## 做什么

- 清单只有一层任务，每条都要有「做完的标准」：
  `npm run state -- tasks plan tasks.txt`（格式见 `governance/README.md`），或单条
  `task add --text "…" --standard "做完的标准" [--phase 名]`。
- 做完就交证据：`npm run state -- task done T1 --evidence "跑过的命令 / 文件名 / 看到的输出"`；
  「…」「你的原话」这类占位会被拒绝。
- 阶段是任务上的可选字段。用阶段的时候，一个阶段的任务全做完就审这一段：
  `npm run state -- review log --scope 段 --phase 名 --from findings.txt`。
- 全部任务做完、进验收前审整体：`npm run state -- review log --scope 总体 --from findings.txt`
  （没有发现就传空文件）。任务书由系统生成，改不掉；确有局部风险，用 `--extra "请特别检查…"` 附加。
- 发现要逐条处置：`finding fix F1 --note "改在哪"`（或先 `finding task F1` 派生修复任务并做完）、
  `finding defer F1 --note "为什么下一轮"`、`finding accept F1 --note "为什么可以接受"`。
- 收口的顺序：任务全完成 → 段审查（有阶段时）→ 总体审查 → `set 验收 --reason "…"` → 用户签收 → `close`。

## 检查

- [ ] gate:source-boundary 产品代码改动落在 `apps/desktop/src/` 的既有边界内。
- [ ] gate:workspace-root-dirs 新目录先在 `scripts/workspace.config.json` 登记。
- [ ] gate:status-today 能用到哪变了就更新 `docs/STATUS.md`。

## 不要做

- 不在没有范围时改产品行为（提交门会拦）。
- 不用自评代替证据；「做完了」不是证据，命令输出、文件、截图才是。
- 不跳过审查直接进验收。
