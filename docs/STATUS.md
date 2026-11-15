# STATUS

Authority: 本文件是 Noema 当前版本、已验证证据、未交付项与已知限制的唯一权威来源。
Update when: 交付、打包、验证、限制或阻塞变化。
Does not own: 产品定义与验收（见 [PRODUCT](PRODUCT.md)）；系统结构与数据边界（见 [ARCHITECTURE](ARCHITECTURE.md)）；长期决定（见 [DECISIONS](DECISIONS.md)）；命令与发布步骤（见 [OPERATIONS](OPERATIONS.md)）；治理与门槛（见 [AGENTS](../AGENTS.md)）；计划与排序（见 GitHub Project 看板与 `openspec/changes/`，D-026）。

最后更新：2026-11-15

## 版本与源码

- 源码版本：`0.7.6`；当前源码基线：`f592a9b release: Noema 0.7.6`；功能基线 `b7c41fa`。
- 0.7.4–0.7.6 的功能变化见 Git 提交与看板 Done 卡片；本文只保留当前结论。
- 便携构建：`apps/desktop/out/Noema-win32-x64/Noema.exe`（0.7.6，246,819,840 字节）。
- 安装包：`npm run make:desktop` 可产出 Setup/nupkg/RELEASES（固定 `TEMP`、vendored NuGet 6.11.1、`SQUIRREL_TEMP`；`out/` 被占用时回退 `.tmp/forge-out`，D-024）。0.7.6 产物在 `.work/releases/Noema-0.7.6/`：`Noema-0.7.6 Setup.exe` 170,410,496 字节 sha256 `6E773C854FBF6E4B0A39720608737555114E5E95E9F5526F1E05D7A32964BCDC`；`noema_desktop-0.7.6-full.nupkg` 169,672,685 `43C7BCA5288EEDDF0B63465AAD68807CB41D636CB1B3D0AAB51945070951E618`；`RELEASES` 84 字节 `98F69C9F3D1D08A710B16844E4C963264FDAF051D01BC4D1BBC3370DE0DD5B08`。Squirrel 写入构建时间，同源码两次构建哈希不同。
- 已装目录只有 `%LOCALAPPDATA%\Programs\Noema-0.7.3|0.7.4|0.7.5` 便携版；桌面 `Noema.lnk` 仍指向 0.7.5。

## 当前可用

- Core Chat：单对话、流式回复、停止、复制/引用/转发/主题、历史只读、搜索。
- 任务执行：自然语言派发、工单受理、执行者与授权工作区、DSH headless 优先/native 回退、Windows Runner、执行轨迹与交付记录。
- 任务界面：活跃任务 dock、完成胶囊、交付记录、任务详情按文件 diff 可保留/撤回；可见执行者的常驻私聊。
- 项目：创建即绑定工作文件夹、负责人、成员提案（默认 A）、项目群与项目会话、成长记录（批次可重试/归档）。
- 消息编辑与存档：单 HEAD 编辑、助手原位编辑、`conversation_archives` 与恢复；恢复只回退对话，不回滚工作区文件。
- 干净起点：新装只有 2 个默认联系人和 1 个默认会话，无项目、团队、成员、任务。
- 数据：对话快照、项目、工单、证据、记忆、成长都在本机 SQLite；整库导出/备份/删除未做。

## 未交付（卡片）

C3 执行者会话拓扑 · C6 成长证据门槛 · C7 组织模型迁移（成员关系迁到 `social_project_sessions`、删团队表） · C8 会话 fork 拓扑 · C9 `@Noema` 跨房间 · C10 岗位库剩余（管理 UI、招募来源） · C11 数据自主 · C12 真实安装与升级演练 · C13 六模块（Policy/Memory Store/ContextCompiler/ModuleHost）。

## 已知限制

- 安装包未签名（D-025）：需用户放行或改用便携版。本机工作区带 Low 完整性标签，工作区内构建的 exe 写不了 `%LOCALAPPDATA%`；真实安装要把 exe 复制到 `%TEMP%` 再运行。这是本机环境，不是产品缺陷——CI 干净 Windows runner 上的安装/升级/卸载已验证。
- 0.7.6 的成长记录、成长对话框、任务文件审阅只在测试中验证，没有在真实项目上完整走一遍。
- 成长仍是“复盘回合里写资产文件、写入即注入提示词”，没有跨项目证据门槛，也不能当“已实现成长”对外宣称（C6）。
- 完成事件是 renderer 级 `localStorage`；任务事实源是交付记录与 SQLite。
- 旧完整 social UI 的七个 renderer 模块保留为 dormant；`main.ts` 仍是组合根，进一步拆分以真实缺口为驱动。
- 编辑仍是破坏性截断/覆盖；恢复只回退对话，不随对话回滚工作区文件。
- 架构图与 `docs/ARCHITECTURE.md` 的同步由 `figure:check` 保证；改架构文档必须在本机跑 `npm run figure:build`（需 Archify 与 Edge），CI 只 check 不重出图。
- 项目工作区只在创建时选择；创建后更换目录走对话框，取消不改变已有绑定。

## 最近一次验证（2026-11-15）

- `npm run check`：**873/873，0 fail，31,477ms**。链：`workspace:check`（含 `branches:check`）→ `docs:check` → `figure:check` → `plan:check` → `source:check` → `lint` → `typecheck` → `tools:test`（29 个维护脚本测试）→ `test`。
- `docs:check` OK：五份文档三行头与路由、版本 `0.7.6`、基线 `f592a9b`、`core.hooksPath=.githooks`、DECISIONS 条目状态完整。
- 架构图 v2：`figure:build` 端到端跑通（Archify 四 gate 全 pass → Edge headless 截图 → 摘要回写），12 组件、4 张卡片，灰底 + 虚线区域标出「计划中」。
- GitHub：CI run `43673883619` success（13 分 11 秒），含 `make:desktop` 与安装/升级/卸载数据保留验证；本地收件箱（`npm run inbox`）每 10 分钟计划任务运行。

## 未验证

- 真实 provider 全链与长时运行。
- 真实 `%LOCALAPPDATA%` 安装与跨版本升级（本机受限，CI 覆盖）。
- 真实项目上把成长批次跑通并产出资产。

## 交付判断

当前是可日常使用的 0.7.6 工程版，不是完成 V1。任何“完成”结论必须有文件、命令或测试证据，不能以模型自述或计划代替。
