## 事实影响

- 类别：仅执行
- 依据：三处偏差都在治理工具与治理文档里；不改产品行为、数据、契约。

## 用户决策

- 2026-11-18 用户验收 `D-20261118-decision-dialog-flow` 时指出两处机制偏差（m108565），并裁定「你先把之前已知问题给修复了吧，然后再考虑这件事」（m108583）。
- 我先记成 T12/T13/T14 三个待裁项，用户未逐条裁，但明确要求先修；本批按此执行，条目补 E24–E26 后再走验收。

## 目标

1. 阶段进入由机制完成：agent 不读规则文件，而执行 `npm run stage -- <phase>`，规则随工具反馈进入上下文（E21）。
2. 内核落地：条目模型、状态机、规则包校验、过渡文档结构校验在 `governance/core/*.mjs`；`scripts/` 只留路径、命令、门接线（E17）。
3. 退回路径存在：`待验收 → 执行中` 必填 `--reason`，写进条目，规则包与状态机一致。
4. 边界可校验：`docs-check` 检查 `governance/core/*.mjs` 不含 Noema 专名与仓库路径。

## 非目标

- 不改产品代码与产品文档。
- 不做治理框架的通用化与独立概念（等这次修完再讨论）。
- 不做 DSH harness hook 注入。

## 取舍

- **core 放 .mjs 而不是 .ts**：治理工具不参与桌面构建，`node --test` 直接跑；避免引入编译步骤。
- **core 只做纯文本/纯逻辑**：不读盘、不 `import` 仓库路径；所有 IO 与路径常量留在 `scripts/`，这样边界检查可以用一条正则守住。
- **退回路径用 `--reason` 而不是 `--approval`**：退回是发现问题的动作，由 agent 发起、用户可随时纠正；真正需要用户原话的是阶段向前推进与收口。
- **注入点放在失败信息与 precommit**：不新增常驻提示；出错时自然把「先跑 stage」带进上下文，提交时把当前条目与阶段打一次。

## 用户可观察的改变

- `AGENTS.md` 的阶段地图只写「执行哪个命令进入阶段」，不再列「该读哪个文件」。
- `npm run decision -- advance --stage 执行中` 在 `待验收` 条目上可用，但必须带 `--reason "…"`；成功后条目多一行退回记录。
- `docs:check` 在 `governance/core/*.mjs` 出现 `noema`/`apps/desktop`/`docs/`/`.work/` 时报错。

## 手测步骤

1. `npm run stage -- acceptance`：输出验收规则包与恢复卡，恢复卡显示条目、阶段、上一轮结论与下一步。
2. `npm run decision -- advance --entry D-20261118-decision-dialog-flow --stage 执行中 --reason "验收发现三处机制偏差，退回修复"`：成功，条目出现退回记录。
3. `node -e "console.log(require('fs').readFileSync('governance/core/entries.mjs','utf8').includes('noema'))"`：输出 `false`。
4. `npm run docs:check`：通过；故意在 core 文件里写一个 `docs/` 字样再跑，报错。

## 验收

- [ ] `AGENTS.md` 阶段地图不再指向规则文件，改为 `npm run stage -- <phase>`。
- [ ] `governance/core/` 至少四个模块（条目、状态机、规则包、过渡文档），`scripts/` 对应文件只剩接线。
- [ ] `待验收 → 执行中` 可用且必填 `--reason`，条目留痕；规则包与 `scripts/lifecycle.mjs` 同步。
- [ ] `docs:check` 的 core 边界检查有单测覆盖。
- [ ] `npm run kernel:test`、`npm run tools:test`、`npm run check` 全绿。