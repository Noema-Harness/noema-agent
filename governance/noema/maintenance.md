# 维护与门槛

Authority: 提交门、里程碑门、协作检查与发布前的门槛清单。
Update when: 门、CI job 或协作规则变化。
Does not own: 命令与失败修法（docs/OPERATIONS.md）；状态机（governance/README.md）；产品事实（docs/）。

## 三层门

| 门 | 什么时候 | 查什么 | 拒绝时 |
| --- | --- | --- | --- |
| 提交门 `npm run commit`（`.githooks/pre-commit`） | 每次提交 | 文档自洽（登记文档存在与三行头、未登记文档、治理词提示、内核边界、版本与 STATUS 基线、hooks、技能副本、文档引用的 npm 脚本存在）+ 改动路径播报（产品行为 / 条目数据已取消 / 自由执行） | 先判断规则是否错了，不绕过；确属误报就改规则并说明 |
| 里程碑 `npm run check` | 每个里程碑、发布前 | workspace → branches → docs → figure → source-structure → lint → typecheck → tools:test → test（CI 同源） | 同上；修到全绿再推 |
| 人判断 | 一直 | 用户预期是否变、范围是否被正确理解、签收 | 停下来问 |

`npm run check` 与 CI 的 `verify` 是同一套；本地过即 CI 过。main 推送触发 `platform`（平台状态门）与 `collaboration`（协作者路径检查）。

## 改动路径怎么分

提交门会打印这次改动属于哪种：

- **行为路径**（`apps/desktop/src/`）：先有范围（讨论态 `state -- scope`），执行态再改；实现级修复不需要重开讨论。
- **自由执行路径**：测试、文档、内部脚本、文案——不用范围，过提交门即可。
- **条目数据**：已取消（会话与范围在 `governance/data/state.json`，只经 `npm run state` 写）。

判据：**改完之后，用户的预期会不会变？** 会变→先在讨论态写范围；不会→自由执行。

## 协作检查

- 协作者可改 `apps/`、`docs/**`、`README.md`；治理机制本身由维护者独占（见 `CONTRIBUTING.md`）。
- `scripts/collaboration.mjs` 在 PR 上按登录名检查维护者路径，触碰即失败并提示改为交给维护者。
- 合并与归档由维护者做；main 不允许 force push 或删除。

## 发布前

1. `npm run check` 全绿。
2. `npm run package:desktop` 与 `npm run make:desktop` 产出安装包；冒烟可按 `docs/OPERATIONS.md` 跑。
3. `docs/STATUS.md` 写清这个版本能用到哪、未验证什么。
4. 治理图：源文档（`governance/README.md`、`AGENTS.md`）变了先判断图是否需要改，再 `npm run figure:check`。