# OPERATIONS

Authority: 本文件是 Noema 环境、开发、检查、打包、安装、回滚与诊断方式的唯一权威来源。
Update when: 命令、环境、发布流程或诊断方式变化。
Does not own: 产品定义与验收（见 [PRODUCT](PRODUCT.md)）；系统结构与数据边界（见 [ARCHITECTURE](ARCHITECTURE.md)）；长期决定（见 [DECISIONS](DECISIONS.md)）；当前版本与未交付项（见 [STATUS](STATUS.md)）；维护规则（见 [AGENTS](../AGENTS.md)）。

## 环境

- Windows 10 22H2 x64 或更新版本；当前正式支持 Windows。
- Node.js **24.21.x**（`>=24.21 <25`）和 npm。
- macOS（arm64 实测）也用于开发：同样 Node 24.21+；`npm ci` 后需要在仓库根跑一次 `node node_modules/electron/install.js` 下载 Electron 二进制。锁文件已带 oxlint 的 darwin/linux 原生包，`npm run lint` 可直接跑。
- 当前 shell 为 Windows PowerShell 5.1；脚本不能依赖 `pwsh` 7 专有语法。
- 用户数据库、凭据和下载的参考源码不进入仓库；`.work/` 只放本机过程材料。

## 开发

时间轴（四态、每次转移绑哪道门）见 [AGENTS](../AGENTS.md) 的「一条时间轴」与 `scripts/lifecycle.mjs`；本文只写命令、环境与报错修法。两个技能都在 `skills/` 下：`noema-development` 是立项与条目模板（常规轮按需），`noema-governance` 是偏离盘查（只在发现执行偏离治理预期时加载）；`npm run skill:install` 同步到 `~/.dsh/skills`（`docs:check` 校验副本一致）。需要用户决定或验收时看 `npm run review`；条目字段与三道门见「审核入口与决议条目」。

```powershell
npm ci
npm run dev
```

`dev` 启动 Electron Forge 开发模式，renderer 使用 Vite HMR。主进程/预加载修改通常需要重启开发应用；只有 `pnpm run dev:web` 同时运行且改动的是 client plugin 时，页面才会自动重载。

DSH 执行路径的真机检查（不需要模型 key）：先装 DSH（`npm i -g @deepseek-ai/dsh`，Node 24.21+），再在 `apps/desktop` 跑 `npm run e2e:dsh-fake-model`。脚本起一个本地假模型，让 DSH 的 shell 工具执行命令，逐项断言：可写模式能列出并写入工作区、只读模式拒绝写入、可写模式拒绝写到家目录。macOS 与 Windows 都走同一个脚本，shell 工具由 `src/main/platform/host-platform.ts` 决定。

## 检查

提交前：

```powershell
npm run check
```

`check` 依次执行：

1. `workspace:check`：文档路由、根目录结构、已合入却残留的远端分支；
2. `docs:check`：五份权威文档的三行头与路由、版本/基线、git 门槛安装状态、DECISIONS 每条阶段与三层、已收口条目的用户确认；
3. `figure:check`：架构图产物与 `docs/ARCHITECTURE.md` 摘要、README 引用是否同步；
4. `plan:check`：本地活动变更至多 1 个；PR 上只校验本分支自己的那个变更（`openspec/changes/<name>/` 出现在 diff 里的）；合并进 main 的树必须没有未收口变更（`platform` 门）。PR 不套用维护者的待决/待验收流程门，也不核对「事实影响」与 docs 配对（由审核人判断相关性）；事实影响是「结构/取舍/仅执行」的变更标 `skip_specs: true` 时，代码改动不需要规格增量。main 上还留着未收口变更时，PR 会显式报「main 上还有未收口 change」——这是规则，不是协作者的 bug；
5. `source:check`：源码依赖边界，以及 `src` 下 `.mjs` 数量不增加（D-039 TS 迁移棘轮）；
6. `lint`、`typecheck`、`tools:test`（维护脚本测试）、`test`。

OpenSpec 规格只写可观察行为，不写测试实现：每个新增或修改的 requirement，在本次 change 的 `tasks.md` 里写一条验证（测试文件名或命令）；归档后证据留在 Git、变更 tasks 与 STATUS 里，不把测试名写回常驻 specs，也不新增第二套测试映射。

里程碑（准备归档变更时）单独运行：

```powershell
npm run milestone:check
```

单独运行：

```powershell
npm run workspace:check
npm run branches:check             # 已合入或过久未动的分支只提示，不阻塞提交
npm run docs:check
npm run figure:check
npm run plan:check
npm run milestone:check
npm run source:check
npm run typecheck
npm run lint
npm run tools:test
npm run inbox
npm run review             # 只读聚合：需要你决定 / 待你验收 / 执行中（待验收显示勾选进度）
npm run decisions:sync     # 验收项全部勾选后收口（改阶段与标题标记、补当天用户确认）
npm run decision:draft     # 起草条目：只写 .work/decisions-draft/，然后问用户是否已批准创建
npm run decision:accept    # 落库：decision:accept -- <D-…> --approval "<用户原话>"
npm run stage -- <阶段>     # 阶段入口：打印规则包 + 活动条目 + 恢复卡（discussion/execution/acceptance）
npm run transition -- <kind> # 过渡文档：模板 / --write 生成 / --check 校验（design/closeout/kickoff/handoff/report；后两者按条目生成）
npm run acceptance -- --entry <D-…> # 生成验收页：按 E 分节、列未覆盖 E、手测步骤与结论；--write 落 .work/review/
npm run decision -- acceptance --entry <D-…> --from <file> # 把文件里的「- [ ] …」验收项整段写回条目（保留阶段事件行）
npm run decision -- <round|settle|advance|wait>  # 条目操作，写盘前过行为门（wait add|drop 增删待裁项）
npm run governance -- record|move|check|audit # 治理接口：record 五合一、move 进阶段/恢复、check 三类自检、audit 净零计数
npm test
```

### 仓库结构与分支卫生

根目录、文档登记与生成目录写在 `scripts/workspace.config.json`（仓库文件，随代码评审；不再有 `.codex/` 之类的工具私有目录）。`npm run workspace:check` 会拦：未分类的根目录或根文档、`docs/` 里没登记的 Markdown、`.work/` 里的材料被提交、以及**已经合入 `origin/main` 却还留着的远端分支**。

已合入的分支只是垃圾，直接失败；只是“很久没动”的分支只给提示，因为年龄本身不能证明别人的工作没价值。清理流程：

```powershell
npm run branches:prune            # 预演：列出可安全删除的已合入分支（check 的提示就是来源）
npm run branches:prune -- --apply # 执行删除
```

删除前默认先备份到一个 bundle；本机备份放 `.work/archive/`，不进仓库。会话中做过的批量清理：`.work/archive/branches-2026-11-15.bundle`（8 个过时分支，7,299,401 字节）与 `.work/archive/branch-inventory.txt`。

### 过程材料（`.work/`）

`.work/` 是**一次性工作区，不是存档**。判据只有一条：**这东西以后还会不会再被维护？**

- 会（随项目进度更新、要给人长期读）→ 由权威文档承载，或向用户提出新增权威文档；不许放 `.work/`。
- 不会（一次性文档、提交信息与 issue 正文载荷、探针脚本、日志、截图证据、构建与发布产物）→ 可以放 `.work/`，在对应交付收口后删掉；`releases/`、`archive/` 例外。

不要往 `.work/` 写需要维护的东西（阶段总结、计划台账、决定记录）——它们已经有主人：`docs/STATUS.md`、`docs/DECISIONS.md`、看板与 `openspec/changes/`。

```powershell
npm run workspace:clean                            # 预演：.work/runs、.work/scratch 与超过保留期的条目
npm run workspace:clean -- --apply                 # 执行
npm run workspace:clean -- --days 30 --apply       # 改保留期
```

保留目录写在 `scripts/workspace.config.json` 的 `artifactRetention`（默认保留 `.work/releases/`、`.work/archive/`，其余超过 7 天未动即清）。

讨论转执行不再用 DSH 的计划模式：开工清单用 `npm run transition -- kickoff` 生成与自检，阶段推进用 `npm run governance -- move --entry <D-…> --stage 执行中 --approval "<用户原话>" --decision "<一句决定>"`（行为门校验开工清单结构、原话、批次指针与 change 是否存在）。验收不过且决定没变时，用 `npm run governance -- move --stage 执行中 --reason "<哪一处不过>"` 回执行中修；决定变了才回决策中重开。

### 维护门槛

门槛分三个频率（commit / milestone / ci），入口统一在 scripts/governance.mjs；门槛机制、审核入口与协作检查的完整说明见 governance/noema/maintenance.md。失败的常见原因与修法：

| 报错                                                  | 修法                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| STATUS 源码版本与 package.json 不一致                 | 发布/交付后先更新 `docs/STATUS.md` 的版本、基线、验证和未交付                                                                       |
| STATUS 基线不是 HEAD 祖先                             | 基线写成当前可解析的提交；重写历史后重取                                                                                            |
| 文档里写进了不属于它的内容                            | 不是脚本能判的事：每份文档头的 `Does not own` 已写明边界，评审时按边界判断；规划放卡片、状态放 STATUS、架构放 ARCHITECTURE          |
| proposal 缺少 `Plan:` 卡片链接                        | 产品变更先在看板选卡，再把卡片链接写进 proposal 顶部；纯机制/文档/展示的治理变更写 `Plan: none`，且 diff 不能含 `apps/desktop/src/` |
| 里程碑报「本变更引用的决议未获用户确认」              | design 的「用户决策」或对应条目的「阻塞」里点名的决议还在 `决策中`                                                                  | 先把那条议题谈成 `决定`，或删掉无关引用；不相关的「决策中」不阻塞这一刀 |
| 活动变更超过 1 个                                     | 已完成的先 `openspec archive <name> --yes`（归档目录只留本机，不入库）；过期未做的也归档并写明关闭原因                              |
| main 上还有未收口 change                              | 维护者先归档 main 上的变更；这不是协作者 PR 的问题，等归档后让检查重跑                                                              |
| 平台不允许未收口 change                               | 归档并删掉 `openspec/changes/<name>/`、把规格增量合并进 `openspec/specs/` 之后再推送或合并                                          |
| 已经推送了带未收口 change 的提交                      | 别想着 force push：按上一条在本地收口后再推一次，`platform` 复查通过即可；这次红是提交时序问题，不是代码问题                        |
| 活动变更 tasks 全部完成                               | 归档该变更后再开下一个阶段                                                                                                          |
| `[用户]` 验收项勾选没有确认日期                       | 只有用户明确确认后才勾选，并写成 `（用户确认：YYYY-MM-DD）`                                                                         |
| 条目「来源」不是用户指令                              | 普通实现、修复、只补验证本来就该走提交信息或 change；真要用户拍板时，来源写成「用户 YYYY-MM-DD …」再开条目                          |
| 报「缺少 --approval」或「批准原话太短」               | 条目不能先建后说：先用 `npm run decision:draft` 起草并停下问用户，拿到明确答复再用 `npm run decision:accept -- <D-…> --approval "<原话≥10 字>"` |
| 草稿落库前校验失败（条目没有写进文件）                | 草稿结构不合规：按报错补「阶段/结构/来源/阻塞」与「- 要定：」，修好再 accept；草稿会保留在 `.work/decisions-draft/`                    |
| 阶段过了决策中但「决定」没有用户确认日期              | 决定归用户：补上「（用户确认：YYYY-MM-DD）」，没有确认就重开回决策中                                                               |
| 报「还在决策中，「#### 2 执行」却已经有内容」         | 讨论期只写决策层：执行与验收改成一行 `- 未开始：定案后进入执行`／`- 未开始：定案后进入验收`，定案后再填                              |
| 报「「#### 2 执行」没有批次指针」                     | 先立项 openspec/changes/<name>，执行层写一行 - 当前批次：changes/<name>（commit <sha>），再改阶段；没有批次就停在决策中 |
| 报「进执行前没有开工清单」                            | 先跑 `npm run transition -- kickoff --entry <D-…> --write` 生成并填完整，再推进阶段（E1） |
| 报「字段「状态」不在允许列表」                        | 删掉 `- **状态**：` 行：阶段已经表达状态；它想说的信息写进三层正文                                                                 |
| `npm run stage` 报「规则包引用了不存在的门」          | 规则包的 `gate:<id>` 必须是 `scripts/governance.mjs` 的 RULES 里已登记的 id：先登记规则，或改规则包里的 id                        |
| `npm run decision -- advance` 报「不能从X直接到Y」    | 阶段只能相邻推进（决策中→执行中→待验收→已收口），唯一回溯边是重开回决策中；验收不过用 `--stage 决策中 --reason "…"`               |
| `npm run transition --check` 报「还有没填的（待填）」 | 把每节的 `（待填）` 换成真实内容再校验；design 与 kickoff 的「待确认项」必须写 `- 无` 才能提交批准                                 |
| `npm run decision` 报「写入前校验失败（条目没有改动）」 | 生成后的条目结构不合规：按报错修内容后重跑；每次写盘前都会整条校验，失败不会留下半截文件                                          |
| precommit 报「docs/DECISIONS.md 在索引里与命令写下的版本不一致」 | 有人绕过命令改了条目：用 `npm run governance -- move --restore --from <commit>` 经命令恢复，或重新走 record/move 让印记对齐 |
| `npm run governance -- audit` 报「净额检查」          | 规则/门/命令数变了：确认新要求必需并在提交信息写清净额，然后 `npm run governance -- audit --accept` 更新基线                         |
| `npm run transition --write` 报「同类过渡文档有 N 份」 | 回工不要新建：先合并成一份（旧的移到 `.work/review/archive/`）；确实要另开一份用 `--new "<理由>"`                                     |
| `npm run decision -- advance --stage 待验收` 报「还有 N 个已定 E 没有验收项」 | 先跑 `npm run acceptance -- --entry <D-…>` 看缺哪些，把验收项按 E 编号补齐再转待验收（E12） |
| 报「设计方案不合规」                                  | 进执行前必须有结构完整的设计稿：`npm run transition -- design` 看模板，待确认项写「- 无」，再带 `--design <path>` 重跑（E21） |
| 报「proposal.md 没有引用条目」                        | 在 `openspec/changes/<name>/proposal.md` 的 `Plan` 或来源里写上条目 id 再进执行（E23） |
| 报「历史只增不删」                                    | 批次、完成、决定、验收项、阶段事件行是已发生的事实：恢复被删的行并改同一行；带历史的条目也不能整条删除（E32） |
| 报「条目标题格式不合规…阶段标记只能是」               | 标题的阶段标记只能写 `⏳ 🔧 🔍 ✅` 或不写；写错（如 `## 💬 D-…`）时条目不会被解析，会从 review 里消失并把内容并进上一条             |
| milestone 报任务未完成 / 有待决问题 / STATUS 不是当天 | 补完任务、拿到用户答案、更新 STATUS 后再归档                                                                                        |
| milestone 报产品变更没更新卡片正文                    | 在 tasks 写一条“更新卡片正文（现在能做什么 + 手测步骤 / 还没做）”，并真的改卡片正文；治理变更（`Plan: none`）不需要                 |
| 报「本变更引用的决议未获用户确认」                    | 让被引用的条目先走出 `决策中`（用户确认方案），再跑 `npm run milestone:check`                                                       |
| 报「验收结论确认后才算交付」                          | 请用户验收（`npm run review` 的“待你验收”），通过后把条目阶段改 `已收口` 再归档                                                     |
| 报「产品变更没有对应的决议条目」                      | 在 DECISIONS 写一条阶段为 `执行中` 的条目，第 2 层写 `批次：changes/<name>`                                                         |
| 架构文档 / 治理规则变了但图没重出（figure:check）      | 运行 `npm run figure:build`；不要手改 html/png；README 必须引用 png 与 html                                                         |
| figure:check 报图依赖章节变化（如 §2/§5）             | 先判断图要不要改：改图后重出；确认无需改，`npm run figure:build -- --sections-changed "理由"` 记录判断                                 |
| figure:build 报「章节变了但 candidate 未变」          | 同上：只重跑渲染不会让图跟上文档；要么改 candidate，要么带 `--sections-changed` 说明理由                                               |
| figure:check 报 candidate 与记录不一致                | 手改过 `*.source.json` 里的 candidate；运行 `npm run figure:build` 重出图，不要手改产物或摘要                                        |
| pre-commit 拒绝产品代码提交                           | 同一次提交带上计划/状态更新与 specs 增量；未决决策只能等用户回答                                                                    |
| pre-commit 报“本轮变更的计划还没有提交”               | 先把 `openspec/changes/<change>/` 单独提交，再提交产品代码；计划先于实现，Git 历史才能证明开工依据                                  |
| 合并 main 时 pre-commit 拦下从 main 带进来的代码      | 不会：合并提交只检查与两个父提交都不同的路径（冲突解决与手改），实现见 `scripts/maintenance.mjs` 的 `stagedPaths`                   |
| pre-commit 只提示“工具/治理改动不受未决产品决策阻塞”  | 正常；工具与文档维护不被产品决策卡住                                                                                                |
| 阶段不在四种里                                        | 只用 `决策中 / 执行中 / 待验收 / 已收口`；阶段写在正文第一条                                                                        |
| `decision advance` 报「缺少 --reason」                | 重开回决策中必须写原因：带 `--reason "<哪一处不过、决策漏了什么>"`（≥10 字），工具写一行「重开：…（日期）」到发生它的阶段小节   |
| `docs:check` 报 `governance/core/*.mjs` 出现项目专名   | 内核是通用层：把 Noema 专名与仓库路径挪到 `scripts/` 或 `governance/noema/`，core 只留纯逻辑                                        |
| `npm run dev` 报 `listen EACCES ::1:5173`              | 5173 落在 Windows 保留的动态端口段：启动前设 `NOEMA_DEV_RENDERER_PORT=0`（`apps/desktop/vite.renderer.config.mts` 读取）                |
| Electron 启动后立即退出、没有报错                      | 先查 `cmd /c "set ELECTRON_RUN_AS_NODE"`：有值就清掉再启动；清掉后连最小 `electron` 探针都开不了窗，说明是宿主会话限制，换桌面终端或 CI 跑 |

用户验收项写在 tasks.md 里，格式 `- [ ] [用户] <场景> → 证据`；确认后改成 `- [x] [用户] <场景> → 证据（用户确认：YYYY-MM-DD）`。

### 架构图（图源与产物路径）

两张图，读者不同：

| 图         | 读者   | 图源文档               | 入口                 | 产物                                      |
| ---------- | ------ | ---------------------- | -------------------- | ----------------------------------------- |
| 产品架构图 | 用户   | `docs/ARCHITECTURE.md` | `README.md`          | `docs/assets/noema-architecture.*`        |
| 治理全景图 | 维护者 | `governance/README.md` | `governance/README.md` | `governance/assets/noema-governance.*`  |

产品图是 README 的入口，也是规划的总锚点：图里区分“已实现”和“计划中（灰底 + 虚线区域）”；只画 Noema 产品范围，不画本机开发 harness。治理图画治理结构（提示层、事实流、机器门），不进 README。

- 图源是 `*.source.json`：`candidate`（手写 IR）、源文档摘要（`source.sha256`）、**图真正依赖的章节摘要**（`source.sections`；架构图固定 §2 依赖方向、§3.1 拓扑、§5 执行路径、§6 代码地图，治理图固定“三层结构”“四道门”“三阶段规则包”“条目生命周期”）、`candidate` 的内容摘要（`source.candidateSha256`）、产物摘要。
- 章节变了要重新判断图，不是只重跑渲染：`figure:check` 会列出变了的章节；`figure:build` 在「章节变了、`candidate` 一个字没改」时直接拒绝，防止“摘要更新了、图还是旧的”。两条路：真去改图；或确认图不需要改，`npm run figure:build -- --sections-changed "理由"`，理由与该次章节状态绑定写进 `source.rationale`，下次章节再变要重新判断。
- 手改 `candidate` 而不重出图，`figure:check` 报「candidate 与出图记录不一致」。
- 改了 `docs/ARCHITECTURE.md` 或 `governance/README.md` 后重出图：`npm run figure:build`（两张一起；需要本机 Archify 技能和 Edge，finalize 的四道 gate 必须全过）。只重建一张：`node scripts/figure.mjs build governance`。
- `npm run figure:check` 挂在 `npm run check` 里：源文档变了而图没重出、图依赖章节漂移、candidate 被手改、产物被手改、入口文件（README / governance README）没引用图，都会直接失败。PR 的 `verify` 设 `NOEMA_FIGURE_SOFT=1`，这些差异降为提示（图是维护者资产，协作者不必声明或等待）；`main` 与里程碑仍严格，维护者在合并前后重出。
- 不要手改 `*.html|png`；finalize 的侧车 json 由 build 自动移出产物目录，留在 `.work/archify-run/`。

### CI 是异步验证

全量 `npm run check`（约 40 秒、878 个测试）是**里程碑门槛**：一张看板卡的一个切口完成时跑一次。轮内只跑 `npm run typecheck` 与受影响的测试文件；推送后不等 GitHub Actions 跑完——计划任务和 `npm run inbox` 会在下一轮开场报告红/绿。只有三种情况需要主动看 CI：合并协作者的 PR 前、发布前、收到红色通知后定位。

### 外部收件箱（GitHub 通知 → 对话）

三态：`pending`（未送过）→ `delivered`（已注入对话，等处理）→ `done`（处理完），状态在 `.work/inbox-bridge/state.json`。工具本身是外部项目 [c3115644151/dsh-inbox-bridge](https://github.com/c3115644151/dsh-inbox-bridge)（安装与配置见那里）；本仓库只有 `scripts/inbox.mjs` 转发器（先看 `INBOX_CLI`，再看同级目录 `..\dsh-inbox-bridge`），只保留下面这几条 Noema 侧命令：

```powershell
npm run inbox                                  # 列出三态；--json 给脚本用
npm run inbox:ack -- --done -- <key>           # 处理完标记 done（唯一会停止提醒的写法）
npm run inbox:ack -- <key>                     # 只标 delivered（之后会再提醒）
npm run inbox:ack -- --all-delivered --done    # 清空所有已送达未处理
```

`--done` 必须写在 `--` 之后（npm 会吞掉前面的 `--done`，脚本会提示）。注入时机由插件决定：默认排队到下一轮开始，不打断工具循环；插件配置属于那个仓库，不在这里维护。CI 的正式结论以 GitHub Actions 为准，本地 `done` 不改 GitHub 的未读标记。

### 审核入口与决议条目

条目结构与审核规则见 `governance/noema/maintenance.md`；命令仍在本页：`npm run review`、`npm run decision:draft` / `npm run decision:accept`、`npm run decisions:sync`。

### 议题与积压放在哪（D-028/D-029）

只有三处，不另建容器：看板卡片放能力、排序、状态与**每轮交付的观察口**（正文三段：现在能做什么 + 手测步骤 / 还没做 / 证据留在仓库）；`openspec/changes/<name>/tasks.md` 放本轮执行；`docs/DECISIONS.md` 只在出现需要用户拍板的真议题时追加条目（编号 `D-YYYYMMDD-<短名>`），普通讨论与实现不建条目。发散讨论不必先建条目，等它成熟到需要用户定夺再记录。

### 规划看板（GitHub Project）

排序与状态只存在于 [GitHub Project「Noema V1 路线」](https://github.com/orgs/Noema-Harness/projects/1)，不在任何文档里镜像。看板是组织级 private 项目，已链接到 `Noema-Harness/noema-agent`：从仓库的 Projects 页或组织的 Projects 页都能进入；换新仓库时用 `gh project link 1 --owner <org> --repo <repo>` 建立链接，否则卡片只在组织页可见。需要 `gh` 已登录且 token 含 `project` scope；看板操作失败（断网、token 过期）只报告并阻塞看板动作，不阻塞代码提交与 `npm run check`。

```powershell
gh project item-list 1 --owner Noema-Harness --format json   # 看卡片与字段
gh project item-edit --id <item-id> --project-id <project-id> `
  --field-id <status-field-id> --single-select-option-id <option-id>   # 挪状态
gh issue comment <n> --body "证据：commit <sha>，check 873/873，STATUS 链接"   # 收口证据
```

每张卡片是 `[C<n>]` issue；收口时先贴证据再关 issue，`npm run check` 的离线门槛只校验 proposal 里的 `Plan:` 链接，不校验远端状态。

卡片正文只写现在：交付一段就更新「现在能做什么（含手测步骤）」与「还没做」，不写变更日志、不贴交付证据；证据写进提交、tasks 与 STATUS。产品变更的 `design.md` 必须写「## 用户可观察的改变」与「## 手测步骤」，`plan:check` 会拦缺这两节；`milestone:check` 会拦 tasks 里没有“更新卡片正文”。

状态语义只有两层：卡片 Status 表示**交付状态**——Done 是有自动证据且用户能看到，In Progress 是部分交付（缺口写在卡片正文），Todo 是没开始；**“本轮正在做”由活动变更表示**，同一时刻至多 1 个，不要靠把卡片留在 In Progress 来表示。

工作流：**卡片切口 = 一个 change**。选卡后把卡片移到 In Progress，并在 `openspec/changes/<name>/` 立项；tasks 只拆这次切口（不要把整个阶段塞进一个 change）；收口时归档 change、更新卡片正文（`milestone:check` 校验）、卡片 Done；证据留在仓库，不贴评论。纯机制/文档/展示的治理变更写 `Plan: none`，不占能力卡，也不能带产品代码（`pre-commit` 会拒绝）。

三条链路各有一句出口，遇到时照这里走：**接手或会话被压缩**——先跑 `npm run inbox`，再读看板 In Progress、`docs/DECISIONS.md` 待定条目和活动变更 tasks，边界就在这三处（AGENTS §1 步骤 0）。**决定被推翻**——在原条目写 `**被替代**：D-0xx` 指向新条目，不设第三个状态。**归档后发现问题**——开一个新 change（proposal 引用原变更），不改 Git 历史；需要回退版本时按上面「版本与安装」的回滚步骤。

提交门槛只在维护者本机安装，不自动修改协作者配置：git 只在 `core.hooksPath` 指向时才跑仓库里的钩子，新克隆默认没有这道门；协作者靠交付前跑 `npm run check` 保证，同样的检查在 `check` 里也会跑一遍。维护者本机安装：

```powershell
git config core.hooksPath .githooks
```

钩子文件在 Git 里带可执行位（`100755`）；macOS/Linux 上若 git 提示 `hook was ignored because it's not set as executable`，说明是旧检出，`chmod +x .githooks/pre-commit` 即可。

检查是否生效：

```powershell
git config --get core.hooksPath
```

CI（GitHub Actions）不要求安装钩子：`docs:check` 在 `CI` 环境变量为真时只提示、不失败；workflow 用 `actions/checkout` 的 `fetch-depth: 0` 取完整历史，基线祖先判断才能成立。

测试失败时先跑受影响的单文件，避免每次都跑全量：

```powershell
node --test test/main/chat/social-chat-service.test.mjs
node --test test/main/chat/conversation-continuity.test.mjs
```

## 协作与 PR 检查

协作者契约、分支保护、CI 与路径守卫见 `governance/noema/maintenance.md`；本地预演用 `npm run guard -- --actor <登录名> --base origin/main`。

## 打包

先关闭正在运行的 Noema，避免 `app.asar` 被占用。

```powershell
npm run package:desktop
npm run make:desktop
```

- `package:desktop` 产出 `apps/desktop/out/Noema-<platform>-<arch>`：Windows 是 `Noema-win32-x64`，Linux 是 `Noema-linux-x64`，macOS 是 `Noema-darwin-<arch>`。
- `make:desktop` 走 `apps/desktop/scripts/make.mjs`，由它处理三个环境陷阱后再调 `electron-forge make`：
  - `TEMP`/`TMP`/`TMPDIR` 固定到 `apps/desktop/.tmp`（受限令牌下写系统临时目录会被拒绝，NuGet 子进程会因此失败）；
  - `SQUIRREL_TEMP` 固定到 `.tmp/squirrel-temp`（Squirrel 默认在 `%LOCALAPPDATA%\SquirrelTemp` 建临时目录，同样可能不可写）；
  - 把 `apps/desktop/vendor/squirrel/nuget.exe`（NuGet 6.11.1）铺进 `.tmp/squirrel-vendor`，通过 `NOEMA_SQUIRREL_VENDOR` 交给 MakerSquirrel；electron-winstaller 自带的 NuGet 2.8 在打包 `app.asar` 这类高压缩率文件时会抛 `ObjectDisposedException`。
- 如果 `out/Noema-win32-x64/resources/app.asar` 被其他进程锁住（无法改名），脚本会自动改在 `.tmp/forge-out` 重建并打印提示，命令仍然成功；产物路径以日志为准。2026-11-15 实测占用者是 DSH 的宿主进程（只读句柄、不带 `FILE_SHARE_DELETE`），关掉占用方即可回到默认 `out/`；不要用强制结束代替确认占用。
- `make` 产出 Squirrel 安装包（`.tmp/forge-out/make/squirrel.windows/x64` 或 `out/make/...`）；发布产物按版本放到外部 release 目录，不提交。
- 非 Windows：`make` 只验证该平台的 maker 能跑通——macOS 出 ZIP（`MakerZIP` darwin），Linux 出 DEB；Squirrel 安装生命周期只有 Windows 有。产品仍只发布 Windows 包。RPM maker 已移除：`electron-installer-redhat@4.0.0` 的 spec 用相对路径 `cp -r usr/*`，在 rpmbuild ≥ 4.20（`%mkbuilddir` 会把 `%install` 的工作目录改到 `BUILD/<name>-<version>-build`）下必然失败；产品不发布 RPM，需要时再按上游修复或自带 spec 模板恢复。
- `MakerDeb` 的安装器 helper（`electron-installer-debian`，`os: ["darwin","linux"]`）在 `apps/desktop/package.json` 里声明为 `optionalDependencies`：Windows 上 `npm ci` 跳过，Linux/macOS 上才会安装。不要改到 `devDependencies`——Windows 安装会因平台不匹配直接失败；也不要指望从 maker 的传递 optionalDependencies 自动解析，锁文件里记录不到。
- `MakerDeb` 传 `options.bin: 'Noema'`（`forge.config.mts`）：安装器默认把 `bin` 取成 `package.json` 的 `name`（`noema-desktop`），而产出的可执行文件按 `productName` 叫 `Noema`；不传会报 `could not find the Electron app binary at ".../noema-desktop"`。
- `apps/desktop/out*`、`apps/desktop/.tmp` 是构建产物，不提交。
- 安装验证注意：Squirrel Setup 先在 `%LOCALAPPDATA%\SquirrelTemp` 解包。本机仓库目录带 `Low Mandatory Level:(OI)(CI)(NW)` 完整性标签，区内构建的 `Setup.exe` 以 Low IL 运行，写 `%LOCALAPPDATA%`/`C:\ProgramData` 会被内核 MIC 拒绝，此时 Setup 回退到 `C:\ProgramData\<用户>` 并弹 `Unable to write to … - IT policies may be restricting access to this folder`（`icacls <仓库根>` 可看到该标签；`%LOCALAPPDATA%\SquirrelTemp\Squirrel-Install.log` 会有 `Win32Exception (0x80004005): 拒绝访问`）。验证载荷时可把 `SQUIRREL_TEMP`/`TEMP` 指到可写目录（安装根变成该目录的父级）；验证真实安装先把 exe 复制到 `%TEMP%` 再运行（副本没有 Low 标签），或经批准删掉 `apps/desktop/out` 的 Low 标签。

安装包冒烟：

```powershell
npm run smoke:package --workspace noema-desktop
```

需要指定已解包目录时使用 `NOEMA_PACKAGE_DIR`；具体开关以脚本当前入口为准。

默认按宿主平台找产物：win32 `Noema.exe`、linux `Noema`、darwin `Noema.app/Contents/MacOS/Noema`，目录为 `out/Noema-<platform>-<arch>`。Windows runner 资源与托盘断言只在 Windows 执行；Linux CI 用 `xvfb-run -a npm run smoke:package` 启动，并在无特权用户命名空间时附加 `--no-sandbox`（只属于测试侧，不进产品）。

## 版本与安装

版本号同时改：

- `package.json`
- `apps/desktop/package.json`
- `package-lock.json` 的根包/desktop 条目

当前已安装的 0.7.2 位于：

```text
C:\Users\NUC\AppData\Local\noema_desktop\app-0.7.2\Noema.exe
```

已安装版本不一定包含当前源码；源码相对已安装版本的差异见 [STATUS](STATUS.md)。0.6.9 是回退版本。

发布口径（D-025）：安装包暂未签名。若安装包放在带 Low 完整性标签的目录（例如本机仓库工作区），双击安装会因 Low IL 写不了 `%LOCALAPPDATA%`；把安装包复制到 `%TEMP%` 或普通用户目录再运行即可，或改用便携目录运行。这与签名无关，签名留作后续选项。安装/升级前关闭 Noema，必要时确认占用 `app.asar` 的宿主进程（2026-11-15 曾由 DSH 宿主进程持有句柄）；不要用强制结束代替确认占用。

Squirrel 升级失败时先检查：

- `app-<version>\resources\app.asar` 是否被其他进程占用；
- 旧版本目录是否仍有长路径/残留文件；
- 安装日志中的具体删除/重命名错误；
- Setup 直接弹 `Installation has failed` 时，先查 exe 所在目录是否带 Low 完整性标签（`icacls`），必要时把 exe 复制到 `%TEMP%` 再运行（见「打包」节）；再看 `%LOCALAPPDATA%\SquirrelTemp\Squirrel-Install.log`。

不要通过覆盖 `app.asar` 假装升级完成；手工部署只作为临时诊断，完成后再走正常安装验证。

## 回退

1. 保留 0.6.9 的安装包或已安装目录，不删除。
2. 关闭当前 Noema。
3. 运行 0.6.9 安装包，或恢复到 `app-0.6.9` 后启动。
4. 确认版本、数据库可打开、历史可读；不要用回退版本写入新 schema 后再切回。

回退不删除用户数据库；如果 schema 已升级，旧版本可能无法读取，必须提前备份。

## 数据与诊断

- 用户数据在 Electron 用户数据目录（通常为 `%APPDATA%\Noema`）；具体以应用运行时显示为准。
- 数据库、密钥、日志不手工提交；需要排查时先复制到 `.work/diagnostics/`，不要直接改生产库。
- 应用执行 ID、诊断记录和工具事件用于定位工单失败；不要只凭模型文本判断执行成功。
- 清理 `.work/` 前确认没有正在运行的任务和需要保留的证据。

## 发布检查

发布前至少完成：

- `npm run check` 全绿；
- 目标平台打包冒烟；
- 关闭应用后安装/升级，不依赖手工覆盖；
- 启动后版本、数据库、历史、设置正常；
- 记录安装包哈希与已知未验证项到 [STATUS](STATUS.md)。

## 常见问题

- **端口/数据库被占用**：关闭旧进程，确认没有第二个 Noema 实例；不要删除数据库来“修复”。
- **模型不可用**：在设置中检查连接、模型和密钥；不要把网络失败说成任务完成。
- **工单不执行**：确认承接人、工作区和运行诊断；执行环境不可用时如实提示，不自动伪造结果。
- **文档检查失败**：只保留五份 `docs/` 权威文档、README 和 AGENTS，清理旧路由和归档目录，再运行 `workspace:check`。
