# STATUS

最后更新：2026-11-12 09:10（Asia/Shanghai）

## 版本

- 源码版本：**0.7.2**
- 已安装版本：**0.7.1**，路径 `C:\Users\NUC\AppData\Local\noema_desktop\app-0.7.1\Noema.exe`
- 可回退版本：**0.6.9**
- 0.7.2 尚无安装包；0.7.1 是当前实验版本，不是稳定发布。

## 当前可用

- Core Chat 单对话、流式回复、消息操作（复制/引用/重试）、历史查看、设置入口。
- SQLite 本机持久化；用户数据、密钥和日志不进入仓库。
- 工单派发与执行轨迹：Noema 不直接写文件，执行结果回到原对话。
- DSH headless 优先、native 回退；Windows Runner 负责本机命令边界。
- Phase 1 连续时间线基础：schema 37、检查点、活动分支头、启动恢复；默认开启仅限 `room-noema`。
- 文档初始化：README、PRODUCT、SYSTEM、BEHAVIOR、DECISIONS、OPERATIONS、STATUS 和项目 AGENTS 已重建；用户 AGENTS 已更新。仓库只保留 8 份仓库文档，旧文档已移入外部归档。
- 产品校准同步（2026-11-11）：Q1–Q11 与 Q13 的已确认答案已写入 PRODUCT/BEHAVIOR/DECISIONS/README/项目 AGENTS：一个账号；执行者可见常驻私聊；专家/群聊/项目按需可见；项目是临时复杂输出、团队长期；只做本地；桌面 + 手机远程界面；主动关怀后置；Noema 不直接写文件；编辑/回退采用单 HEAD + 存档。Q14 及之后仍未关闭。
- 组织模型同步（2026-11-12）：D-013 已写入岗位库、一个岗位一个长期 Agent、团队长期/项目临时、负责人由 Noema 从岗位库产生且先于团队；同岗位不按人数复制，项目执行用 fork；团队负责人可请求招聘，Agent 不能直接创建 Agent。D-011 同步为所有执行者（含团队负责人）都按项目 fork；MVP 阶段一个团队同一时间只推进一个项目。实现未开始。
- 角色模型同步（2026-11-11）：D-012 已写入岗位与项目角色分离；项目负责人默认纯协调，不直接承接工作项，兼任必须显式记录。
- 个体框架同步（2026-11-12）：D-014 已写入 Noema 与执行者共用的六模块（Core/Policy/Competence/Tool Grants/Memory/Context）、Compiler 是组装过程、能力条目是最小可执行单位、岗位包属于组织层；实现未开始。

## 当前不完整

- **产品文档校准**：Q1–Q11、Q13 已同步；Q14 及之后的问题尚未逐条关闭。当前不能把文档当成完整产品规格。
- **执行者可见私聊**：目标已写入 PRODUCT/BEHAVIOR/DECISIONS，但 0.7.1 仍把执行者放在后台，用户不能直接打开；尚未实现。
- **会话分层**：目标已定（常驻会话 + 项目 fork（含团队负责人）+ 归档复盘 + Noema 不加入），0.7.1 仍是旧 room/branch 结构，尚未实现。
- **项目负责人**：目标已定（岗位与项目角色分离；默认只协调、不直接执行；可显式兼任一个工作项）。0.7.1 没有独立项目负责人模型，仍按旧 room/branch 运行。
- **岗位库与团队模型**：D-013 已定目标（一个现实岗位一个长期 Agent；团队长期、项目临时；负责人先于团队；同岗位不按人数复制；项目执行 fork）。0.7.1 没有岗位库、团队负责人、临时项目或项目 fork 的独立实现，仍是旧 room/branch。
- **个体 Agent 模型**：D-014 已定目标（六模块、能力条目、Compiler 组装、成长需候选/评估/影子/版本化）；0.7.1 没有能力库、记忆层或 Context 编译，仍是提示词、工具和旧 room/branch。文档已同步，实现未开始。
- **编辑/回退**：语义已定：用户消息编辑截断其后并重发；任意助手回复可原地编辑，修改进入上下文，后续消息保留。编辑/回退前的旧线进入不可变存档；回退同步恢复工作区，检测到用户手动改动冲突时停止。0.7.1 仍未实现：renderer 的 `saveEdit`/`rewindAndResend` 和 `core-chat-app.tsx` 仍创建分支并显示分支栏，助手回复不可编辑；后端 `rewindConversationToMessage` 只完成了部分清理。
- **分支 UI**：0.7.1 仍暴露实验性分支栏；不能作为产品交互验收。
- **验证**：2026-11-12 提交 `fafce31` 后运行完整 `npm run check` 通过 **847/847**，35.18s；D-011/D-013/D-014 文档编辑后 `npm run workspace:check` 为 8 份当前文档、0 错误，`git diff --check` 干净。编辑/回退功能仍未达到 BEHAVIOR 的目标。
- **打包**：0.7.2 没有安装包；0.7.1 安装包已验证可用。0.7.0 是旧的 shadow 版本，不应使用。
- **工作区清理**：`.work/research` 仍被 `DeepSeek Harness.exe` 占用（约 166 MB），未删除；其余 `.work` 大目录已移到外部归档。
- **长期能力**：ContextCompiler、Memory Store、ModuleHost 热重载均未交付；云端和跨设备当前不承诺。

## 已知问题与风险

- 模型/工具失败时必须保留用户消息和已有文件，不能自动宣称完成；当前实现仍需逐场景验证。
- 旧社交/项目/团队代码仍在仓库中，主界面已收成一个对话；结构收口未完成。
- 旧文档已备份到 `C:\Users\NUC\Desktop\Noema-archive-2026-11-11\pre-doc-reset-2026-11-11`，仓库内旧入口已删除。
- 文档路由固定为 8 份仓库文档；`workspace:check` 已通过（8 份当前文档、0 错误）。

## 半废弃代码登记（2026-11-12）

这些代码当前没有产品入口，但保留用于后续重做；不得按死代码删除。恢复时必须同时补回真实入口、验收场景和测试，不能只把组件挂回界面。

- **暂缓的界面模块**（文件头已标注 `DORMANT (2026-11-12)`）：
  - `apps/desktop/src/renderer/search/global-search-dialog.tsx`
  - `apps/desktop/src/renderer/diagnostics/diagnostics-dialog.tsx`
  - `apps/desktop/src/renderer/settings/personal-memory-dialog.tsx`
  - `apps/desktop/src/renderer/settings/user-followups-dialog.tsx`
  - `apps/desktop/src/renderer/projects/project-plan-panel.tsx`
  - `apps/desktop/src/renderer/projects/project-review-card.tsx`
  - `apps/desktop/src/renderer/chat/chat-start-state.tsx`
- **旧执行器回退**：`apps/desktop/src/main/execution/noema-project-executor.mjs` 仍被 `apps/desktop/src/main/main.ts:85`、`main.ts:1926` 和 `apps/desktop/src/main/execution/work-runtime-registry.mjs:36-42` 引用；只在 DSH 不可用时使用，属于 legacy fallback，不是可删死代码。
- **判定规则**：零入引用不等于可删。只有同时满足“无动态/测试入口、无未来产品用途、无数据/恢复依赖”才删除；其余保留并登记。当前没有新增的确定可删产品文件；此前的 `settingsOpen`/no-op JSX、临时文件已清理。
- **退役验证资产（2026-11-12）**：`apps/desktop/scripts/social-agent-e2e.mjs`、`apps/desktop/test-support/electron/agent-probes.ts`、`apps/desktop/test-support/electron/conversation-navigation-e2e.mjs` 面向已移除的会话导航/房间界面，已从 `package.json` 的发布验证入口移除，文件保留作恢复该界面时的参考。它们不是当前产品测试，不得作为发布验收。

## 下一步

1. 先继续文档校准：逐条关闭 Q14 及之后的问题；对 D-013 的 Agent 多团队、fork 经验回写、单执行者项目等未决项逐条澄清后再改文档；不执行产品改动。团队并行多项目在 MVP 阶段明确不做，等核心链路可用后再评估。
2. 用户决定冻结在 0.6.9 的最小可用形态，还是继续当前重建；这个决定不由实现自动推进。
3. 若继续：实现两种编辑语义、不可变存档和工作区回退，移除分支栏；不要先做 UI 美化。
4. 完成后再打包 0.7.2，安装验证，并保留 0.6.9 回退。
5. 单独处理 `.work/research` 的占用，再完成 `.work` 清理。

## 交付判断

当前可以用于本机开发和受控试用，不能称为完成品。用户可观察的核心对话和执行链可用；编辑/回退已定语义但未实现，产品方向和安装包仍是未完成项。详见 [BEHAVIOR](BEHAVIOR.md) 与 [DECISIONS](DECISIONS.md)。
