# 设计与取舍

## 事实影响

- 类别：仅执行
- 依据：只改治理工具与条目写入路径，不改产品行为、数据或结构。

## 用户决策

- 2026-11-19 用户批准继续执行阶段（「可以，请开始」），本切片属于执行阶段内的收口缺口，不需要新的产品决定。

## 目标

验收项写回走命令，不再手改 `docs/DECISIONS.md`；写回后覆盖率必须为 0 未覆盖。

## 非目标

- 不自动撰写验收项内容：验证什么、怎么验仍由人写。
- 不做验收页到条目的全自动同步（页面只是输入来源之一）。

## 取舍

- 选择「文件输入 + 整段替换」，而不是逐条增删命令：验收项天然成组，逐条命令会留下半成品状态。
- 替换范围只限 `#### 3 验收` 的勾选行，阶段事件行（重开、用户确认）保留；历史只增门按「批次/完成/决定/验收项/阶段事件」行数比较，验收项变多放行、变少报错。
- 写盘前仍走 `checkDecisionEntries`，失败不落盘。

## 用户可观察的改变

- `npm run decision -- acceptance --entry <D-…> --from <file>` 输出覆盖率；未覆盖 E 不为 0 时命令失败。

## 手测步骤

1. 生成验收页：`npm run acceptance -- --entry D-20261118-decision-dialog-flow --write`。
2. 把按 E 的验收项写进 `.work/review/acceptance-items.md`（每行 `- [ ] …`）。
3. 运行 `npm run decision -- acceptance --entry D-20261118-decision-dialog-flow --from .work/review/acceptance-items.md`，应输出「未覆盖 E：0」。
4. 再跑 `npm run decision -- advance --entry D-20261118-decision-dialog-flow --stage 待验收`，不应被覆盖门拒绝。

## 验收

- [ ] `replaceAcceptance` 替换验收项并保留阶段事件行（kernel 用例）。
- [ ] 非法行、缺文件被拒且不写盘（kernel 用例）。
- [ ] 历史只增门放行「验收项增多」（maintenance 用例）。
- [ ] `npm run decision -- acceptance --entry D-20261118-decision-dialog-flow --from .work/review/acceptance-items.md` 报未覆盖 E=0。
- [ ] `npm run kernel:test`、`npm run tools:test`、`npm run check` 全绿。