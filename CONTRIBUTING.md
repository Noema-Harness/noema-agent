# 协作约定

这是协作者与维护者之间的契约：谁决定什么、PR 里必须有什么、哪些文件只能维护者改、CI 会拦什么。规则本身在 `AGENTS.md` 与 `CONTRIBUTING.md`；两者冲突时以 `AGENTS.md` 为准。

## 角色

| 角色   | 谁                            | 能决定                                                            |
| ------ | ----------------------------- | ----------------------------------------------------------------- |
| 维护者 | `c3115644151`                 | 计划与优先级（看板）、决议条目、治理文件、合并、发布              |
| 协作者 | `ichika0130` 及其他外部贡献者 | 在自己负责的实现范围内写代码与测试、提交 PR、在 PR 里给出验证证据 |

合并只有维护者能做。作者不合自己的 PR，即使 CI 全绿。

## 平台能强制什么

本仓库是私有 Free 组织仓库，GitHub 不允许启用分支保护或 ruleset（`GET /branches/main/protection` 与 `/rulesets` 均返回 403）。所以规则不靠平台拦，靠三件事：

1. CI 红灯：`Desktop checks / verify` 跑 `npm run check`；`Desktop checks / collaboration` 拦路径越界；`Desktop package` 跑打包与安装包。
2. 维护者审核：只有维护者在检查通过后合并。
3. 约定：下面这些边界，越过就会在审核里退回。

`CODEOWNERS` 只提供审查提示，不阻止合并；不要把它当成强制。

## 你可以改

- `apps/` 下的实现与测试（按模块归属）。
- 你自己的 `openspec/changes/<你的变更名>/` 三件套。
- `README.md` 里与你改动直接相关的用法说明。

## 只能维护者改

| 路径                                      | 为什么                         |
| ----------------------------------------- | ------------------------------ |
| `AGENTS.md`                               | 开发循环与治理规则             |
| `.github/`                                | 工作流、模板、CODEOWNERS       |
| `.githooks/`、`scripts/`                  | 本地与远端门槛本身             |
| `docs/PRODUCT.md`、`docs/ARCHITECTURE.md` | 产品定义与系统结构的事实源     |
| `docs/DECISIONS.md`、`docs/STATUS.md`     | 决议流水与“今天能说到什么程度” |
| `docs/OPERATIONS.md`                      | 环境、命令、发布流程           |
| `openspec/specs/`、`openspec/config.yaml` | 规格由维护者在归档时合并       |
| 根 `package.json`                         | 脚本登记表                     |
| 看板卡片、issue 标签、版本号              | 计划与交付状态                 |

需要动这些文件时：开 issue 写清为什么、打算改什么，由维护者处理。**不要自己改，也不要先改后问。**

`scripts/collaboration.mjs` 会在 PR 上按登录名检查这些路径；协作者触碰即失败，提示改为交给维护者。

## 一个 PR 必须包含

1. **看板卡**：PR 描述里写出对应的卡片链接（`https://github.com/orgs/Noema-Harness/projects/1` 里的 `#N`）。没有合适的卡就先开 issue，由维护者建卡；不能自己建卡。
2. **OpenSpec change**：`openspec/changes/<name>/` 至少要有
   - `proposal.md` 首行 `Plan: <卡片链接>`（治理类改动写 `Plan: none`，且需要维护者同意）；
   - `design.md` 含 `## 事实影响`（行为 / 结构 / 取舍 / 仅执行 + 依据）、`## 用户可观察的改变`、`## 手测步骤`；
   - `tasks.md` 列清这次要做的项，做完带证据勾选。
3. **验证证据**：跑过的命令与结果写进 PR，不要只写“应该没问题”。
4. **提交信息**：`type: 中文摘要（change <name>）`，让提交能追到变更。
5. **平台说明**：在 Windows 上跑过什么；在 macOS 上跑过什么、哪些用例失败（见下）。

UI 或交互改动附截图；数据、迁移、安装包改动写清回滚方式。

## 检查

本地：

- Windows：`npm run check`（文档、计划、类型、全量测试）。
- macOS：同样跑 `npm run check`，但当前有约 20 个只在 Windows 能过的用例会失败；在 PR 里列出失败的用例名，说明不是本次改动引入。
- 提交钩子（`.githooks/pre-commit`）会检查“计划先于代码”。不要用 `--no-verify` 绕过；绕过会在审核里退回。

远端（每个 PR 自动跑）：

| 检查                             | 覆盖                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `Desktop checks / verify`        | `npm run check`，以及 PR diff 上的提交门（产品代码必须带计划/状态，未确认决议不能改产品代码） |
| `Desktop checks / collaboration` | 协作者是否改了维护者路径                                                                      |
| `Desktop package`                | 触及 `apps/desktop/**` 时跑 smoke、打包、安装包安装/升级/卸载验证                             |

main 推送不再触发 CI（Windows runner 分钟数昂贵）；发布前由维护者用 `workflow_dispatch` 手动跑全套。

如果 job 在 4 秒内失败、日志为空，那是组织 Actions 额度或付款问题，不是代码问题。此时以维护者本机 `npm run check` 与 PR 里的验证证据为准，并在 PR 说明里注明「CI 因额度未运行」。

## 合并与发布

- 检查全绿 + 维护者审核通过 → 维护者 squash 合并，合并后删除分支（`npm run branches:check`）。
- 归档：维护者在里程碑把变更归档、合并规格、更新 STATUS。协作者不要自己归档，也不要直接改 `openspec/specs/`。
- 发布：版本号、安装包、哈希、升级验证由维护者统一处理；日常 PR 不带版本号。

## 范围与数据

- 不提交 API key、用户数据库、真实用户内容、安装包或 `.work/` 运行产物。
- 一个小 PR 只解决一个问题；不混入无关格式化与重构。格式化请在 PR 里单独说明或拆开。
- 环境问题（例如某平台 CI 失败）优先在 PR 里说明，不偷偷改治理文件来让它变绿。
