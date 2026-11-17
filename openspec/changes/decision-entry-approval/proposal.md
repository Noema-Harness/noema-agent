Plan: none

## 为什么

用户 2026-11-18 指出：agent 在未得到明确许可时自行新建了决议条目，这已是同类问题第二次。规则本来写着「条目由用户驱动、agent 不自行开条目」，但那条规则只活在提示里，机器门也只能校验「来源」的文字（`checkDatedEntry` 要求来源以「用户」开头），拦不住「先建后说」。

用户提出把这件事做成门槛化的提醒：程序在条目创建时先问 agent「本次创建是否已获用户批准」，确认后才真正创建。本变更把这句话落成一条可停下来的命令链，而不是再加一句文档提醒。

## 改什么

- 新增 `scripts/decision-entry.mjs`：`draft` 只把草稿写进 `.work/decisions-draft/<id>.md` 并打印确认问题，不碰 `docs/DECISIONS.md`；`accept` 必须带 `--approval "<用户原话>"`（≥10 字），把批准原话与日期写进条目的「来源」，校验通过后才追加落库，草稿删除；校验失败回滚并保留草稿。
- 新增 `scripts/decision-entry.test.mjs`：草稿不落库、缺批准原话拒绝、原话过短拒绝、合法批准落库并带原话、结构不合法的草稿拒绝。
- `package.json` 增加 `decision:draft` / `decision:accept`，并把新测试挂进 `tools:test`。
- `AGENTS.md` 加一句入口规则（新建条目前先申请；起草用 draft，批准后 accept）；`skills/noema-development/SKILL.md` 模板同步提示；`docs/OPERATIONS.md` 写命令与失败修法；`docs/DECISIONS.md` 头部补一条「新建条目前先申请」。

## 影响

- 无产品代码（`apps/desktop/src/` 不动）；只改 `scripts/` 治理工具与文档、技能。
- 依赖：本机制不能验证批准真伪，只能把默认路径从「直接写」换成「先起草、再确认、才落库」，并留下两个时间点。