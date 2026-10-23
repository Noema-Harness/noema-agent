# Noema 项目工作流

## 真相来源

- GitHub Discussions：尚未形成可执行任务的开放问题与方向讨论。
- GitHub Issues：已决定要推进的工作、验收条件、依赖和实际结果。
- GitHub Project：Issue/PR 的流转、优先级与工作流视图；不在本地再维护一份易过时的状态表。
- `docs/decisions/`：长期产品/架构决定及其被取代的历史。
- 产品和架构文档：当前契约，不记录每天的进度。

发生冲突时按事项判断权威来源：用户当前明确方向决定是否继续及授权边界；Issue 的最新描述/评论记录当前交付和续接点，Project 字段反映实时流转；ADR 记录长期取舍。聊天摘要、旧计划、过时 issue 文字是历史线索，不自动高于这些来源。已委托的普通产品/技术判断应依据证据推进；必要裁决和事先约定的品牌/关键体验反馈门按下文处理。

用户已将 Noema 的产品设计与交付生命周期委托给助手；在这个范围内，助手应先研究后自主决定产品与技术方案，不为实现细节反复提问。决策记录必须区分“用户明确确认”和“助手在委托范围内决定”，并记下依据、假设、后果与重审条件。缺少不可推断的用户专属事实、需要超出 Noema 开发授权的账户/数据/支出/对外承诺，或涉及重大不可逆影响时，请求必要裁决。Issue 的验收条件仅锁定当前交付，不永久冻结产品路线或尚未讨论的实现；遇到新证据时可以改写、拆分、退回 Backlog/Discussion 或取消，并保留理由。

### 跨会话续接

开始或恢复实质工作时，先核对 `git status`、当前分支/提交、对应 Issue 的最新状态与评论、Project 状态、依赖和关联 ADR；不要仅凭旧聊天摘要继续。多阶段 Issue 只保留一个简短的最新续接点（已完成及证据、未决判断、下一步动作），在里程碑完成、方向改变、阻塞或交接时更新。不要另建本地状态表；长技术计划才放入 Issue checklist 或其链接文档。

不要把想法直接变成开发任务。方向未清楚时留在 Discussion 或 Project Inbox；确定要做什么、如何判断完成之后才进入可开工状态。

### 并行开发与可接手的交接

主导方向不等于独占代码，也不表示其他 agent 已知道最新聊天。开工在关联 Issue 公布责任范围、分支/基线和集成依赖；并行实现使用独立目录或 worktree。涉及同一存储契约、共享入口或同一界面时，先通过 GitHub 明确先后、共享契约与冲突处理，再落代码。不要靠轮流改同一个工作目录维持隔离。

区分三个事实：Issue 报告完成、成果已推送、成果已合入。检查远端分支/提交/PR，而非仅信评论。发现未发布成果时可继续独立研究或不重叠修改，但不得把他人的未提交变化删掉、替换或宣称已集成。负责人有计划接管时也要先记录交接边界。

暂停、里程碑或移交时，当前 Issue 的最新续接点至少能回答：

- 现在交付什么，以及用户确认、助手决定和待验证假设分别是什么；
- 成果在哪个分支/提交/PR，是否仍有未发布或未提交的改动；
- 哪些验收已由什么检查证明，检查对应哪个版本/环境，还有什么没验证；
- 下一项具体动作是什么，是否有未清除的反馈门、依赖或冲突。

可运行的方法与非敏感配置说明进入仓库；机器特定缓存、日志和凭据保留本机。仅在本机存在的成果不能算陌生 agent 可接手；必要时把去敏的最小重现步骤与证据附在私有 PR/Issue。交接前实际从入口走查一次：能否找对当前版本、运行方式与下一步，而非只确认文档存在。

### 用户反馈与长期目标

长期目标负责维持任务连续性，不代替 Issue/Project，也不代表会无限后台运行。每阶段以有限、可验证的用户结果收束；不因目标仍激活就扩展功能范围。

需要对齐品牌方向、关键交互或产品边界时，先给出具体可评审方案、推荐、取舍与待回答问题。普通实现选择不增加确认。用户已要求在这种讨论点主动暂停长期目标：先保存 Issue 续接点，再调用 harness 的暂停能力；不设超时默认通过，不用自动化重新启动尚待反馈的工作。收到反馈后核实它是否解决待决项，再恢复相依工作。看板按实际阶段（如 In Review）维护，不为等待人类反馈虚构原生 blocked-by 关系。

### 防止功能堆积

新增功能先明确真实使用情境、比现状改善什么、为何必须由 Noema 核心拥有、引入哪些状态/权限，以及失败/删除/替代时如何处理。缺少具体问题的想法留在候选讨论，不从竞品功能表、agent 惯例或样例人数直接生成任务。可靠性底线、产品策略和审美选择分别讨论；测试证明行为，不证明某个定位有价值。

## 看板入口

仓库：[`c3115644151/noema-agent`](https://github.com/c3115644151/noema-agent)（私有）

Project：[`Noema 开发`](https://github.com/users/c3115644151/projects/6)（私有）

- [执行看板](https://github.com/users/c3115644151/projects/6/views/9)：聚焦 Todo/In Progress/In Review/Blocked，按 Workstream 分组、按 Status 分列。
- [收件箱](https://github.com/users/c3115644151/projects/6/views/5)：新建 Issue/PR 进入此处，尚未分诊。
- [候选工作](https://github.com/users/c3115644151/projects/6/views/6)：已有问题与范围，但还不应投入当前执行。
- [待启动](https://github.com/users/c3115644151/projects/6/views/3)：达到 Definition of Ready、可以开工的队列。
- [已交付](https://github.com/users/c3115644151/projects/6/views/4)：已关闭的交付记录。
- [工作总览](https://github.com/users/c3115644151/projects/6/views/1)：全量字段表，用于检查优先级、工作流、父子项与 PR 关联。
- [已取消](https://github.com/users/c3115644151/projects/6/views/8)：已关闭但未交付的事项，保留取消原因。
- [全流程看板](https://github.com/users/c3115644151/projects/6/views/7)：包含收件、候选、执行与终态的全状态视图。

## 状态流转

`Inbox → Backlog → Todo → In Progress → In Review → Done`

必要时转为 `Blocked` 或 `Canceled`。状态表达工作所处阶段，不表达工作类型、重要性或估时。

| 状态 | 含义与进入条件 |
| --- | --- |
| Inbox | 自动纳入的新 Issue/PR；还没有分诊。 |
| Backlog | 问题和候选价值已整理，但范围、时机或依赖仍未满足开工条件。 |
| Todo | 已达到 Definition of Ready，排入近期工作。 |
| In Progress | 当前正在实施；个人项目默认同时只推进少量高优先级事项。 |
| In Review | 实施已结束，正在核对验收、测试、数据影响或用户可见结果。 |
| Blocked | 有明确外部依赖或待裁决事项；Issue 需链接 GitHub 原生 `blocked by` 依赖并写明解除条件。 |
| Done | 所有验收条件均有证据，结果与必要文档已记录。设为 Done 会自动关闭 Issue；关闭 Issue 也会将 Status 设为 Done。 |
| Canceled | 明确决定不再做；以 `not planned` 原因关闭 Issue 后，将 Project Status 改为 Canceled，覆盖关闭自动化的默认 Done。 |

GitHub Project 自动化负责减少机械维护：自动纳入规则针对该仓库的开放 Issue/PR；新加入项进入 Inbox，重新打开的事项回到 Backlog。设为 Done 会关闭 Issue，关闭 Issue 也会自动设为 Done；因此“关闭”只能用于已验收交付，取消事项需在关闭后把状态改为 Canceled。PR 合并只完成 PR 自身；关联 Issue 仍需独立验收。

不要假定 Auto-add 对 API/连接器创建的 Issue 一定及时生效：本次的 Issue #5 是通过 GitHub API 创建，未自动出现在 Project，随后已手动加入并设置字段。创建 Issue 后必须确认它确实在看板上；缺失时用 `gh project item-add` 手动添加，再核对状态、Priority 和 Workstream。

## Definition of Ready / Done

Issue 从候选工作进入 Todo 前，需要满足：

1. 问题或期望用户结果具体，不只有功能名或方案口号。
2. 已知背景、外部证据与假设分开记录；重要未知已解决或说明为何可暂按假设推进。
3. 范围、非目标、依赖和用户数据/权限影响明确。
4. 验收条件能通过观察、测试或明确设计产物判断；优先级和 Workstream 已设置。

工作进入 Done 前，需要：

1. 逐项核对验收条件并记录实际证据；未做的验证明确列出，不能写成已完成。
2. 运行与风险相称的检查；代码变更须通过 Windows CI 中的 lint、typecheck、tests、桌面 smoke 和 package。
3. 更新受影响的产品/架构文档或 ADR；不为每次提交制造无用文档。
4. Issue 记录交付结果并设为 Done（会自动关闭）。PR 模板记录关联 Issue、验证和未验证项；PR 合并本身不会代替关联 Issue 的验收。

## 优先级、工作流与分解

- `P0`：当前主线或阻塞性基础工作；`P1`：本阶段必要；`P2`：有价值但不挡路；`P3`：暂缓。它们不是点数、工期或紧急程度的伪精确估计。
- Workstream 描述主要责任面：产品、Agent Core、记忆连续性、外部集成、桌面端、工程基础。一次工作只选一个主工作流；跨领域细节放在 Issue 内容和关联关系里。
- Label 描述工作类型：`type:design`、`type:engineering`、`type:bug`、`type:research`。状态不再用 label 表达。
- 只有存在可独立验收的交付物时才拆子 Issue；Parent/Sub-issue 表示包含关系，GitHub `blocked by` 表示先后依赖，不用一段文字代替真实依赖。
- Milestone 表示一组有共同结果的 Issues，不代表日期承诺。没有依据就不填 due date、不建立周迭代、不估故事点。

## 阶段验收

工程底座看可重复构建、运行和验证；核心使用闭环看真实日常场景是否成立。阶段与 Issue 的完成状态只在 Project 维护。CI 通过、本机可运行、视觉预览和用户日用价值是不同证据，不互相代替；若证据改变问题定义，修订当前范围，不为旧清单扭曲产品。

## Git、CI 与平台边界

- 重要的多文件/架构变更默认从分支提交 PR，以 CI 结果和 Issue 验收为合并依据；机械改动可直接提交。
- `.github/workflows/desktop-checks.yml` 在 push 与 PR 上验证 Windows 环境：干净安装、lint、类型检查、安全测试、开发态桌面 smoke、生产打包后的真实 Electron 启动 smoke、Electron 构建目录与 Squirrel 安装器。Forge/Vite 的打包过滤仅保留 `.vite` 构建；`better-sqlite3` 是主进程外置的 native runtime，必须经 `packagerConfig.afterCopy` 显式放入 app 包。该 hook 兼容 npm workspace 的 hoisted 根目录布局和 workspace-local 布局，生产启动 smoke 检查包内模块并实际打开 renderer。
- 若 Actions job 未拿到 runner，且 GitHub annotation 明确指出付款失败或 spending limit 阻断，不要把它记成代码测试失败，也不要靠反复 push/rerun 继续制造同一条红色检查。保留本机验证，在当前分支积累必要改动，并在 Issue checkpoint 记录未推送提交；账户所有者恢复可用预算后再集中推送并重跑检查。助手不更改付款方式或支出预算。
- `npm run smoke:freellmapi --workspace noema-desktop` 使用隔离的根 SQLite / DSH_HOME 和本机已加密凭据，只读取 loopback FreeLLMAPI 的可用模型目录，不发送聊天或生成请求；它用于区分“网关目录可读”和“上游模型生成成功”，后者必须另做合成生成验证。
- 修改 FreeLLMAPI 路由、传输或 Noema 客户端后，用 `npm run e2e:social-agents --workspace noema-desktop -- --live` 做真实合成调用；它要求 Node 24.21.x、本机 FreeLLMAPI 正在运行，使用 `auto:noema-free`，只发送 E2E 合成消息，并验证完整回复持久化。该测试会消耗上游免费额度/限频，平时不要当作每次开发的常规 smoke。自动路由以完整响应方式请求，使 FreeLLMAPI 能在交付前回退；直接模型 SSE 必须收到 `[DONE]` 才算完整。
- `npm run e2e:social-work --workspace noema-desktop` 使用隔离数据库与临时工作区，从 Electron 主进程直接启动 Noema 自有执行服务，验证多步工具任务、文件核验、上下文/经验快照与结果持久化；它不驱动聊天界面的控件，也不作为视觉验收。默认真实模式会调用 FreeLLMAPI 并消耗上游额度，只有在需要验证当前真实执行链时才运行一次。`--synthetic` 用隔离合成执行器验证相同服务闭环，不调用模型或 DSH；`--synthetic --case-only` 验证仅携带用户已同意的已核验案例。`--live-practice` 与 `--live-episodes` 是独立的 DSH 经验提炼实验，会消耗免费模型额度/限频；episodes 模式仅在 B 明确收到有限 429 冷却、零工具动作且所有 verifier 检查均显示目标文件缺失时，等待 Retry-After 后重启 B 一次，不重复已产生写入的任务。UI 状态由对应界面测试单独验收；synthetic 模式不替代真实模型/DSH 能力验证。
- 当前仓库是 GitHub Free 下的私有仓库。GitHub API 明确拒绝为此仓库启用 branch protection/rulesets；所以 CI 已自动运行，但平台目前不能强制阻止不合格的直接 push。若以后要求服务器端强制 PR/检查，需要升级 GitHub 方案或改变仓库可见性；现在不擅自公开代码或增加订阅。
- 当前 CI 证明开发构建、生产打包后的真实启动、桌面 smoke 与未签名 Squirrel 安装器可生成。手动运行 Desktop checks 时只上传 7 天保留的私有 Windows 便携预览目录，方便在 D 盘直接运行；PR/push 不上传，避免占满 artifact 配额。Squirrel 安装器仍参与 CI 验证，但本机 maker 在 C/D 临时目录写 `.nupkg` 均遇到 Access Denied；不关闭安全防护，也不把未签名安装器当日常入口。便携预览和安装器均未配置代码签名或自动更新；只有确定正式发行需求后再建 release 流程。

## Codex 项目 harness

- 根 `AGENTS.md` 只放产品边界、续接规则和质量门。
- `.codex/skills/noema-project-work/` 管 Issue/Project 生命周期与上下文恢复；`.codex/skills/noema-architecture-review/` 用于重大边界决策；`.codex/skills/noema-interface-quality/` 仅在创建或显著修改用户可见界面时加载；`.agents/PLANS.md` 只在长任务需要跨会话延续时使用。
- 用户级 `~/.codex/AGENTS.md` 仅保存跨项目判断与协作偏好；仓库不依赖这台电脑的全局文件，接手必需的边界要能从仓库找到。不要把 Noema 细节或阶段状态放进全局指令。
- 项目 `.codex/config.toml` 暂无必要配置；不为扩大上下文而堆提示，不为“增强 harness”安装没有当前用途的插件或覆盖模型/凭据/权限。只有复现的能力缺口才引入配置或工具，并记录用途、验证与撤回方式。
- 原理依据：[Codex 指令发现与分层](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[长期任务与持久项目记录](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)。这是工作机制参考，不是质量保证；不照搬示例目录，避免与 GitHub 再建一份状态来源。
