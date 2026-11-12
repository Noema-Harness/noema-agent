# STATUS

Authority: 本文件是 Noema 当前版本、验证证据、已知缺口、未交付项和下一步的唯一权威来源。
Update when: 交付节点、安装/打包、关键验证结果、阻塞或优先级变化。
Does not own: 产品定义与验收（见 [PRODUCT](PRODUCT.md)）；系统结构与数据边界（见 [ARCHITECTURE](ARCHITECTURE.md)）；长期决定（见 [DECISIONS](DECISIONS.md)）；命令与发布步骤（见 [OPERATIONS](OPERATIONS.md)）；维护规则（见 [AGENTS](../AGENTS.md)）。

最后更新：2026-11-13

## 版本与源码

- 源码版本：`0.7.2`。
- 当前源码基线：`463d817 feat: surface task delivery events in chat`，加上本次 Agent 模型文档提交（HEAD）。
- 最近交付：本次 AgentRuntime/团队模型文档（HEAD）；`2abb42c` 文档收敛；`463d817` 任务完成事件 + 本地持久化；`4f21ac3` 任务 dock 生命周期/胶囊/交付记录；`2b742a1` 移除聊天流内任务卡。
- 文档收敛：五份权威文档 + README/AGENTS；`BEHAVIOR`/`SYSTEM` 已合并删除，`.codex/workspace.json` 为 7 个当前入口；D-016/D-017 已记录 Agent 核心分层与团队审批 A。
- 已安装：`0.7.2`，路径 `C:\Users\NUC\AppData\Local\noema_desktop\app-0.7.2\Noema.exe`。该安装早于任务卡/生命周期/完成事件三个提交，不包含当前源码 UI。
- 本轮没有重新打包或安装；0.7.2 之后不再更新安装包。发布构建只在准备分发时进行。

## 当前可用

- Core Chat：单对话、流式回复、停止、消息复制/引用/转发/主题、历史只读、搜索。
- 任务执行：自然语言派发、工单受理、执行者/工作区、DSH headless 优先、native 回退、Windows Runner、执行轨迹和结果。
- 任务 UI：活跃任务 dock、8 秒完成胶囊、交付记录、点开执行者任务详情；完成事件不追加第二条 Noema 回复。
- 完成事件：每个任务一条，完成/失败/中断分别标记；最近 8 条写入 `localStorage`，刷新后保留；损坏/不可用时回退为空，不影响交付记录。
- 0.7.2 已包含工作区路由和 DSH 非 JSON 容错；真实 inventory/orders 任务已验证文件修改和测试通过。

## 验证

- `npm run check`：**847/847，0 fail，29,062.9655ms**（Agent 模型文档同步后最后一次全量）。
- `npm run typecheck`：通过。
- 真实任务：`orders` 双缺陷修复（`orders tests passed`）、`inventory` `totalValue` 修复、任务完成事件、刷新持久化、执行者详情。
- 这些是工程/产品自查证据，不等于用户最终验收；最终验收以真实使用和用户判断为准。

## 未交付（按目标文档）

1. **执行者可见私聊**：当前执行者仍是后台身份；用户不能在私聊里直接看到其工作过程，`@Noema` 切换尚不存在。
2. **会话拓扑**：仍使用旧 room/branch 结构；常驻会话、项目 fork、团队共享上下文、项目结束归档/复盘未实现。
3. **岗位库/团队/项目负责人**：组织对象和长期团队、岗位复用、团队负责人、项目负责人尚未落地。
4. **六模块**：Core/Policy/Competence/Tool Grants/Memory/Context 仍是目标；ContextCompiler、Memory Store、ModuleHost 热重载未交付。
5. **编辑/回退**：用户消息编辑仍走分支结构；助手回复原地编辑和单 HEAD 回退未完成。
6. **证据完整性**：部分执行路径的 `social_work_file_changes`、`file_change_operations`、`command_batches` 为空，任务验收仍依赖步骤/文本证据。
7. **旧任务卡**：废弃的 0.7.2 任务卡不迁移、不回填；旧历史只读保留，新的任务事实由交付记录和事件承担。

## 已知限制

- 完成事件是 renderer 级 `localStorage`，按浏览器/应用数据隔离；交付记录/SQLite 才是任务事实源。
- 任务 dock 只展示活跃任务；历史通过交付记录查看。
- 旧完整 social UI 不再挂载，七个 renderer 模块保留为 dormant；旧 `noema-project-executor.mjs` 保留为 fallback。不要仅凭零引用删除，恢复需要真实入口和验收。
- `main.ts` 仍是组合根（约 1,303 行，7 个 main 模块）；main/service/UI 的进一步拆分以真实缺口为驱动，不做无验收的大搬迁。
- 旧 `docs/BEHAVIOR.md`/`SYSTEM.md` 已合并进 PRODUCT/ARCHITECTURE 并删除；`.codex/workspace.json` 已收敛为五份权威文档 + README/AGENTS。

## 下一步

当前按 D-016/D-017 的新 Agent 模型推进；先完成基础，不先做团队 UI。

1. **阶段 1：AgentRuntime 核心**：建立不可变核心契约、两个实例（Noema + 一个执行者）、独立个体环境、追加式事件日志；把 Noema 自身工具调用内联到主对话回复下，普通回答不显示轨迹。
2. **阶段 2：历史与编辑**：用成熟 Git 模型实现单 HEAD、用户消息截断重发、助手回复原地编辑和回退；先做 Git vs content-addressed SQLite 的 spike。
3. **阶段 3：可见执行者**：执行者常驻私聊、常驻会话/项目 fork 和 `@Noema` 切换。
4. **阶段 4：组织层**：岗位库模板、招募与模板分层、长期团队、团队负责人提案、默认 A 审批、项目结束归档/复盘。
5. **阶段 5：六模块与前端**：用六模块和 ContextCompiler 替换当前提示词/工具/上下文拼装，再做一次主要前端升级。
6. **收尾**：补齐任务文件/命令证据，完成最终验收与分发构建。

## 交付判断

当前是可日常使用的 0.7.2 工程版，不是已完成 V1。核心对话和执行链路可用；组织层、会话拓扑、六模块、编辑/回退和证据完整性仍是未交付项。任何“完成”结论必须有文件/命令/测试证据，不能以模型自述或计划代替。
