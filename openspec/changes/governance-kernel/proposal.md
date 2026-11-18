Plan: none

## 为什么

批次一建立了治理权威的文档结构，但条目操作仍是手改 markdown 与零散脚本：轮次、待裁、已定、阶段推进各有各的写法，行为门只存在于文档约定里。条目越写越长之后，手改出错过一次（文件被写坏并回滚），用户 2026-11-18 明确要求把条目的相关操作收拢成带门的工具链（E16、E17、E21、E23）。

## 改什么

批次二 `governance-kernel`，四组切片：

- K1 内核文本操作：`scripts/decision-kernel.mjs`（读条目、追加轮次、待裁并入已定、换阶段与标记），纯文本、不读盘。
- K2 行为门 CLI：`scripts/decision.mjs`（`round` / `settle` / `advance`），写盘前校验：`--approval` 原话 ≥10 字、只允许相邻阶段或重开、进执行中要求批次指针且 change 目录存在、收口要求验收项全勾选；校验失败不落盘。
- K3 阶段入口：`scripts/stage.mjs`（打印阶段规则包、校验规则包里的每个 `gate:` id 都登记在 RULES、打印活动条目与恢复卡）。
- K4 过渡文档入口：`scripts/transition.mjs`（打印/生成/校验五份模板，设计要求「待确认项：无」才能提交批准）。
- 接线与文档：`package.json` 命令与 `tools:test`；`docs/OPERATIONS.md` 清理 `/plan` 残留并补命令与失败修法；`governance/README.md` 命令表、三份规则包命令、技能指针写实。

## 不在本批

- 规则包检查项的机器判定（仅登记 + 校验 gate id 存在），不把每个 `gate:` 变成独立门实现。
- 抽离成独立治理项目（批次三，等记忆试点）。

## 影响

- 只改治理工具、治理文档与命令表；不改 `apps/desktop/src/` 产品代码，不改数据模型。
- 新增两个行为门规则 `decision-advance-approval`、`round-changes-line`，按 E6 先记观察期（notice）。