# OPERATIONS

Authority: 环境、命令、失败修法与发布流程的唯一出处；NOC 与需求放在别的文档。
Update when: 命令、依赖、CI、发布流程或已知失败修法变化。
Does not own: 产品定位（PRODUCT）、结构与数据地图（ARCHITECTURE）、治理规则与流程（governance/）、当下可用到哪（STATUS）。

## 环境

- Windows 10/11 + PowerShell 5.1；Node 24（pnpm 由 corepack 提供）；Electron 桌面宿主。
- 仓库一律用 UTF-8 无 BOM 的 JSON/TS/Markdown；改含中文的源码用编辑工具或临时 `.mjs` 脚本，
  不要用 PowerShell 管道重写文件（GBK 会写坏）。
- 本地提交钩子：`git config core.hooksPath .githooks`（CI 会检查这一项，缺了 `docs:check` 报错）。

## 开发

- 安装依赖：`pnpm install`（根目录）。
- 起桌面端：`npm run dev`；Windows 保留端口段可能占用 5173，用 `NOEMA_DEV_RENDERER_PORT=0` 换空闲端口。
- 类型检查：`npm run typecheck`；lint：`npm run lint`；单测：`npm test`。

## 当前状态与工作台

- 查看当前在做什么：`npm run state`（状态、会话、待裁、最近切换、当前规则包与下一步命令）；
  下一步单问：`npm run state -- next`；交接卡：`npm run state -- brief`；机器读：`-- json`；自检：`-- verify`。
- 切状态：`npm run state -- set <讨论|执行|验收> --reason "…"`。
- 声明范围：`npm run state -- scope "<一句话/设计稿/里程碑>" [--kind 里程碑|修复]`（进执行前必须有范围）。
- 验收单元：`npm run state -- phase add --name "…" [--goal "…"]`；开始单元：`phase start --id P1`；
  任务：`task add --phase P1 --text "…"`；完成：`task done --id P1-T1 --evidence "…"`；单元完成：`phase done --id P1`。
- 阶段验收四层：`accept add --phase P1 --text "…" --layer D|C|R|H`；判定 D/C `accept set --id P1-A1 --status 通过|不通过`；
  H 项只能由用户原话判：`accept human --id P1-A4 --text "用户原话"`；
  审查发现处置 `accept resolve --id P1-A3 --decision 已修|延期|接受 [--note "…"]`。
- 人签收：`npm run state -- sign "<用户原话>"`（必须所有单元完成、D/C/H 全绿、R 全处置）。
- 归档：`npm run state -- clean`（只归档已签收的工作，写入 `governance/data/history.json`）。
- 工作台：`npm run work:view` 生成 `.work/review/work-view.html`（只读；一个焦点＝当前单元与下一步命令，
  一条骨架＝验收单元时间线，点节点展开、`#P3` 深链、`J`/`K` 移动，验收层用形状区分、证据悬停出现，
  明暗切换 `T`）。

## 检查

- `npm run docs:check`：文档登记、权威文档头、版本/基线/最后更新、内核边界、钩子、技能副本、文档里引用的脚本存在。
- `npm run figure:check`：架构图/治理图与源文档一致；图改了先判断内容，再 `npm run figure:build`。
- `npm run source:check`：产品源码目录约定；`npm run workspace:check`：根目录与产物根登记；`npm run branches:check`：分支卫生。
- `npm run check`：里程碑全量（workspace → branches → docs → figure → source-structure → lint → typecheck → tools:test → test）。
  CI 跑同一条链（`governance.mjs milestone`），本地过 = CI 过。
- 任务超过两分钟（评测、打包、全量测试、大范围扫描）放后台作业或子代理，主进程只等结果。

### CI 是异步验证

- push 后等 CI；`platform`/`collaboration` 失败先看是否环境问题，不要只看本地绿。

### 外部收件箱（GitHub 通知 → 对话）

- `npm run inbox` 列出未转发的通知；`npm run inbox:ack` 标记已读。转发器在 `scripts/inbox.mjs`。

## 架构图

- 产品图源：`docs/ARCHITECTURE.md` → `docs/assets/noema-architecture.source.json`（产物 html/png 同目录）。
- 治理图源：`governance/README.md` → `governance/assets/noema-governance.source.json`。
- `figure:check` 比对源文档 sha、依赖章节摘要与 candidate 摘要；章节变了要先判断图是否要改，
  确认不改用 `node scripts/figure.mjs build <name> --sections-changed "理由"` 记录判断，再提交。

## 打包与版本

- 打包：`npm run package:desktop`；安装包产物在 `.work/releases/`。
- 版本：`package.json` 与 `apps/desktop/package.json` 同步；`docs/STATUS.md` 写源码版本与基线。

## 回退

- 代码：`git revert <sha>`；数据：桌面端 SQLite 在用户 profile，升级前自动备份。
- 状态数据损坏：`governance/data/state.json` 报「状态数据不合规」时按报错修，或删除重建（会话历史会丢）。

## 常见问题

| 现象                                      | 修法                                                              |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `npm run state` 报「未知状态」            | 状态只有 讨论 / 执行 / 验收；按报错改用三个之一                   |
| 报「进执行前先声明范围」                  | 先 `npm run state -- scope "<范围一句话>"`                        |
| 报「进验收前没有完成的验收单元」          | 先用 `phase done` 完成单元（任务全勾、验收项全判）                |
| 报「还有审查发现没处置」                  | `accept resolve --id … --decision 已修/延期/接受 [--note "理由"]` |
| 报「是人签收项（H）：agent 不能自己判」   | 拿到用户原话后 `accept human --id P1-A4 --text "用户原话"`        |
| `docs:check` 报文档引用了不存在的脚本     | 改 `package.json` 时同步 AGENTS/README/CONTRIBUTING/OPERATIONS/CI |
| `docs:check` 报内核出现项目专名           | 挪到 `scripts/` 适配层；`governance/core/` 不许出现项目路径       |
| `npm run dev` 报 `listen EACCES ::1:5173` | 设 `NOEMA_DEV_RENDERER_PORT=0`                                    |
| 磁盘空间不足导致测试预留失败              | 清理 `.work/` 与 `%TEMP%`；C 盘至少留 2 GB                        |
| PowerShell 写文件后源码出现乱码           | 用编辑工具或 `.work/*.mjs` 重写，不要用管道 `Set-Content`         |
