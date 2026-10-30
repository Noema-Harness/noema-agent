# Noema 开发工作流

## 职责与记录

| 对象 | 负责什么 |
| --- | --- |
| GitHub Issue | 用户结果、退出条件、阶段依赖、交付证据与当前续接结论 |
| GitHub Project | 优先级与流转状态，不用 label 重复状态 |
| OpenSpec change | 本次行为差异、重要技术设计、细任务和验证依据 |
| OpenSpec specs | 已采用的行为约定；实现是否符合仍靠代码与运行检查 |
| docs 与 ADR | 全产品/系统结构、用户可读流程和跨变更长期取舍 |
| 代码、提交与运行结果 | 实际实现与验证版本 |

用户当前方向可以使记录被修订或取代。新想法先探索，足以确定交付再安排实施；小修直接做，有边界的工具维护可只用 change。不要为历史代码一次性补造全套规格。

## 从讨论到交付

续接时核对真实代码现场、最近相关讨论、当前 Issue/Project 及已有 change。Issue 链接 change，不抄细任务；change 链接 Issue，不复制阶段路线。change 内 design 与 tasks 替代原独立执行计划格式。

每次围绕一个可验证交付片段推进。工程和文档检查与风险相称；对 Noema 行为的判断检查实际交互链，服务单测、UI 预览和使用价值是不同证据。必要的用户反馈带可审阅成果和推荐方案；独立工作继续，用户要求停下讨论时按要求停下。

阶段完成、方向改变、阻塞或交接时更新 Issue 一个简短续接点：结论与提交/PR、关键缺口、下一动作及 change 链接。测试证据注明版本；未提交工作明确保存位置。归档 change 说明技术工作已收束，Issue 是否完成仍按其退出条件判断。

## 看板

仓库：`c3115644151/noema-agent`；[Project #6](https://github.com/users/c3115644151/projects/6)。生命周期范围与阶段门见 [#109](https://github.com/c3115644151/noema-agent/issues/109)。

- [阶段路线](https://github.com/users/c3115644151/projects/6/views/1)：开放产品 Issue，标题 `[R阶段-模块 职责] 用户结果`，Milestone 表示阶段。
- [当前执行](https://github.com/users/c3115644151/projects/6/views/4)：Todo / In Progress / In Review / Blocked。
- [集成评审](https://github.com/users/c3115644151/projects/6/views/9)：开放 PR，集成顺序与产品阶段分开。

| 状态 | 含义 |
| --- | --- |
| Inbox | 新进入，待分诊 |
| Backlog | 有价值的候选，尚未可开工 |
| Todo | 结果、范围、依赖和验收已足够明确 |
| In Progress | 正在实施，通常一个主要交付项 |
| In Review | 正在验收或核对关键体验 |
| Blocked | 有明确外部依赖，标明解除条件；有对应 Issue 时用原生 blocked by |
| Done | 退出条件已满足 |
| Canceled | 已决定取消，用 not planned 关闭并覆盖关闭自动化的 Done |

Project 的 Done 会关闭 Issue，Issue 关闭也会映射 Done；PR 合并仅表示 PR 已集成。自动纳入不保证即时完成，新建 Issue 后确认是否在看板中，缺失用 `gh project item-add 6 --owner c3115644151 --url <url>`；改字段先查询 `gh project field-list`。只为能独立验收的结果拆子 Issue，Parent/Sub-issue 管包含关系，blocked by 管依赖。

## 协作与源码同步

并行前明确职责、分支/基线与共享契约，使用独立 worktree。任务都涉及同一存储或界面入口时先安排先后，不用共用目录交替覆盖。区分报告完成、已推送和已合入；保留他人未提交改动。

重要多文件或架构变更按 PR 验收；源码可先同步集成分支。发布前检查 Actions 触发条件、已有失败 job/runner/annotation；账户阻断不重复触发，不误报成代码失败，也不据此停止源码备份。推送后核对远端 SHA。

GitHub CLI 用 `scripts/gh-direct.ps1`，Git 用 `scripts/git-direct.ps1`；connector 传输错误后切 CLI。两者提供显式代理绕过路径，不保证外网永不失败。细分连接诊断、截图、打包和真实执行命令见 [运行与平台说明](../.codex/skills/noema-project-work/references/runtime.md)。

## Harness 维护

用户级 AGENTS 管跨项目协作，项目 AGENTS 管 Noema 特有边界；`openspec-workflow` 是变更入口，`noema-project-work` 接 GitHub 与发布，架构/界面/provider 技能在对应判断时加载。主入口不重复维护各技能的全部方法。

修改 harness 时保留可恢复版本，按实际冲突删改指导，并验证工具入口与记录引用。常驻文字、模板和工具各负责自身能控制的事，不用它们的数量衡量成熟度。
