---
name: noema-development
description: 在 Noema 仓库推进一轮开发、立项或收口一个 OpenSpec 变更、或遇到门槛拒绝与 CI 红时使用。给九步操作步骤、模板与命令速查；规则本身以 AGENTS.md 为准，本技能不重复规则。
---

# Noema 开发运行手册

定位：`AGENTS.md` 是不变量（常驻、判断用），本技能是操作程序（按需加载、给命令与模板）。两者冲突时以 AGENTS 为准。规则变化改 AGENTS；步骤变化改本文件。

## 0. 开场（每轮先做）

```powershell
npm run inbox
git log --oneline -3
git status --short
```

再读三处：`docs/STATUS.md` 的「最后一次验证」、`docs/DECISIONS.md` 里 `**状态**：待定` 的条目、看板 In Progress：

```powershell
gh project item-list 1 --owner Noema-Harness --format json
```

（阶段字段的键是中文「阶段」；PowerShell 控制台显示乱码但值正确。）

然后判断这轮落在哪一步：**只读调查**（查到即回）、**需要用户定夺**（先追加 `待定` 条目再讨论）、**已批准的实现**（进立项）。判断不了就停在定性，不写代码。

## 1. 立项模板

产品切片：`openspec/changes/<name>/` 三件套。

- `proposal.md`：首行 `Plan: <卡片链接>`；Why / What Changes / Impact / 推进的能力。
- `design.md`：三行开工声明（改动落点、共享逻辑是否移动、是否新增路径）；选择与理由；`## 待用户决定`（没有就写“无”）；`## 用户可观察的改变`；`## 手测步骤`。
- `tasks.md`：按切口分节，每项可验收；只有人能判的写 `- [ ] [用户] <场景> → 证据`。

治理变更：`Plan: none`，`.openspec.yaml` 里 `skip_specs: true`，且不能带 `apps/desktop/src/` 产品代码。

## 2. 过计划门

```powershell
npm run plan:check
```

失败对照：缺 `Plan:` → proposal 首行；活动变更不唯一 → 归档或关掉旧的；`待定` 超过 3 条 → 先收一条；用户验收未确认 → 补确认日期；治理变更夹带产品代码 → 把产品改动拆到另一个切口。

## 3. 实现与自验

- 一次只做一个纵切；先写失败测试再修，或先写测试断言新行为。
- 轮内验证：`npm run typecheck` 加受影响的测试文件（`node --test <file>`）。
- 真机或真实数据跑一次；证据写进 tasks：命令、计数、失败原因、未验证项各一行。

## 4. 收口（每一刀都做）

- 卡片正文三段：**现在能做什么**（含手测步骤）/ **还没做** / **边界**。正文写事实，不写日志。
- tasks 勾选并附证据；`docs/STATUS.md` 更新本轮验证。
- 归档提交：

```powershell
npm run check
npm run milestone:check
npx openspec archive <name> --yes
```

提交信息写明 change 名与并入的规格文件；推送后不等 CI（收件箱在下一轮报告）。

## 5. 出口处理（对应 AGENTS §3）

| 出口 | 处理 |
| --- | --- |
| 被否 / 不批 | DECISIONS 记否决理由与触发条件；切回只读，不改代码 |
| 计划门拒绝 | 补计划；若是规则本身错，登记规则修订 |
| 执行失败 / 要撤 | 重试或换路；`git revert` 并写原因，不静默丢改动 |
| 验收未过 | 卡片正文如实回退为事实，缺口进「还没做」，不新开卡 |
| CI 红 | 下一轮开场从收件箱带出，先修再开新刀 |
| 决定被替代 | 新条目写「**被替代**：D-xxx」，旧条目只加该字段 |

## 6. 命令速查

```powershell
npm run inbox                  # 远端变化、CI、PR
npm run plan:check             # 计划门
npm run check                  # 里程碑：docs/plan/milestone/figure/source/lint/typecheck/tests
npm run milestone:check        # 收口前置
node scripts/governance.mjs audit   # 规则登记表与证据分级
npm run figure:build           # 架构源变了才重出图（本机 Archify + Edge）
npm run branches:prune         # 已合入分支清理预演（--apply 执行）
npm run skill:install          # 把本技能同步到 ~/.dsh/skills
```

报错含义与修法：`docs/OPERATIONS.md` 的门槛表与「常见问题」。

## 7. 维护本技能

- 只引用 AGENTS 的章节标题与 OPERATIONS 的命令，不复制规则正文。
- 规则变了改 AGENTS；步骤变了改这里；两者都要在同一提交里对齐。
- 改完运行 `npm run skill:install`，`docs:check` 会校验已安装副本与仓库文件一致（CI 只提示）。
