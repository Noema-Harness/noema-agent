# 设计：治理内核的命令与行为门

## 事实影响

- 类别：仅执行
- 依据：只改治理工具（`scripts/*.mjs`）、命令表与规则包文字，没有产品行为、数据或用户可见界面的变化；条目与阶段推进的既有约定不变。

## 用户决策

用户 2026-11-18 批准把条目操作收拢成工具链并建立行为门（E16、E17、E21、E23，见 `D-20261118-decision-dialog-flow`）。

## 目标

- 条目操作只有一条路径：`npm run decision -- round|settle|advance`，写盘前过行为门，失败不落盘。
- 阶段入口只有一个：`npm run stage -- <stage>`，输出规则包 + 活动条目 + 恢复卡；规则包里的 `gate:` id 必须在 `scripts/governance.mjs` 的 RULES 里。
- 过渡文档只有一个入口：`npm run transition -- <kind>`（模板/生成/校验）。

## 非目标

- 不实现规则包里每个检查项的机器判定；`gate:` 目前只保证“门真实存在”。
- 不做条目历史的自动压缩或重构（收口重构仍是人工 + 过渡文档第二步）。

## 取舍

- 内核与 CLI 分开：`decision-kernel.mjs` 只做文本变换、无 IO，便于单测；CLI 负责参数、门与写盘，避免把规则散进字符串操作。
- 决策与阶段推进一次写盘：决策中的条目不允许出现「- 决定：」，所以 `advance` 把决定行与阶段标记放在同一次生成里，校验通过才写。
- 恢复卡只放指针（E14-A）：四项 + 新提交提示，不复制条目正文。
- 门失败的错误信息直接给修法命令，避免“知道错了不知道怎么改”。

## 风险与缓解

- 旧格式条目（缺 `###### 待裁` 或 `###### 已定`）会让内核定位失败 → 命令只报错并提供行号提示，不猜格式；历史条目保持原样。
- 工具链本身可能被绕过（手改文件）→ 提交门仍校验条目结构（`docs:check`），手改后结构错误一样会被拦。

## 用户可观察的改变

- 不再需要手改 `docs/DECISIONS.md`：轮次、待裁、已定、阶段都有命令。
- 阶段开始时运行 `npm run stage -- discussion` 能看到规则包与“我在哪、下一步做什么”。
- 过渡文档用 `npm run transition` 生成与自检，不再靠临时 markdown。

## 手测步骤

1. `npm run stage -- discussion`：看到规则包、活动条目、恢复卡；未知阶段返回码 2。
2. `npm run decision -- advance --entry <D-…> --stage 待验收`：拒绝并给出合法转移说明。
3. `npm run transition -- design`：打印模板；`--write --entry <D-…>` 生成 `.work/review/` 骨架；`--check` 报缺节或待填。

## 验收

- [ ] `npm run kernel:test` 14 条通过，`npm run tools:test` 全绿。
- [ ] `npm run docs:check` 与 `npm run figure:check` 通过；`npm run check` 全绿。
- [ ] 三份规则包的 `gate:` id 全部在 RULES；`npm run stage` 对三阶段都能输出。
- [ ] 行为门拒绝时文件不变（单测覆盖）。