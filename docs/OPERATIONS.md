# OPERATIONS

Authority: 本文件是 Noema 环境、开发、检查、打包、安装、回滚与诊断方式的唯一权威来源。
Update when: 命令、环境、发布流程或诊断方式变化。
Does not own: 产品定义与验收（见 [PRODUCT](PRODUCT.md)）；系统结构与数据边界（见 [ARCHITECTURE](ARCHITECTURE.md)）；长期决定（见 [DECISIONS](DECISIONS.md)）；当前版本与未交付项（见 [STATUS](STATUS.md)）；维护规则（见 [AGENTS](../AGENTS.md)）。

## 环境

- Windows 10 22H2 x64 或更新版本；当前正式支持 Windows。
- Node.js **24.21.x**（`>=24.21 <25`）和 npm。
- 当前 shell 为 Windows PowerShell 5.1；脚本不能依赖 `pwsh` 7 专有语法。
- 用户数据库、凭据和下载的参考源码不进入仓库；`.work/` 只放本机过程材料。

## 开发

```powershell
npm ci
npm run dev
```

`dev` 启动 Electron Forge 开发模式，renderer 使用 Vite HMR。主进程/预加载修改通常需要重启开发应用；只有 `pnpm run dev:web` 同时运行且改动的是 client plugin 时，页面才会自动重载。

## 检查

提交前：

```powershell
npm run check
```

`check` 依次执行：

1. `workspace:check`：文档路由与结构；
2. `docs:check`：五份权威文档、V1 能力清单、版本/基线、git 门槛安装状态；
3. `plan:check`：OpenSpec 活动变更、推进的能力、任务清单与未决问题；
4. `skills:check`：技能镜像；
5. `source:check`：源码依赖边界；
6. `lint`、`typecheck`、`maintenance:test`、`test`。

里程碑（准备归档变更时）单独运行：

```powershell
npm run milestone:check
```

单独运行：

```powershell
npm run workspace:check
npm run docs:check
npm run plan:check
npm run milestone:check
npm run skills:sync
npm run skills:check
npm run source:check
npm run typecheck
npm run lint
npm run maintenance:test
npm test
```

### 维护门槛

四道门槛由 `scripts/maintenance.mjs` 实现：`docs:check` 与 `plan:check` 在 `npm run check` 里，`milestone:check` 在归档前手动跑，`.githooks/pre-commit` 在提交点跑。失败的常见原因与修法：

| 报错 | 修法 |
| --- | --- |
| STATUS 源码版本与 package.json 不一致 | 发布/交付后先更新 `docs/STATUS.md` 的版本、基线、验证和未交付 |
| STATUS 基线不是 HEAD 祖先 | 基线写成当前可解析的提交；重写历史后重取 |
| PRODUCT 缺少「V1 能力清单」、某行没有验收方式或缺看板链接 | 在 `docs/PRODUCT.md` 补能力行；验收方式只能是“自动测试 / 用户验收 / 自动+用户”；能力清单必须链接 GitHub Project |
| proposal 缺少 `Plan:` 卡片链接 | 先在看板选卡，再把卡片链接写进 proposal 顶部 |
| proposal 缺少「推进的能力」或引用了不存在的 C 编号 | 在 proposal 里写本轮推进的 C 行；纯文档/治理变更写明“无” |
| 活动变更超过 1 个 | 已完成的先 `openspec archive <name> --yes`，过期未做的移到 `openspec/changes/archive/` 并写明关闭原因 |
| 活动变更 tasks 全部完成 | 归档该变更后再开下一个阶段 |
| `## 待用户决定` 超过 3 项 | 先缩本轮范围；超过 3 项说明计划没切干净 |
| `[用户]` 验收项勾选没有确认日期 | 只有用户明确确认后才勾选，并写成 `（用户确认：YYYY-MM-DD）` |
| milestone 报任务未完成 / 有待决问题 / STATUS 不是当天 | 补完任务、拿到用户答案、更新 STATUS 后再归档 |
| pre-commit 拒绝产品代码提交 | 同一次提交带上计划/状态更新与 specs 增量；未决决策只能等用户回答 |
| pre-commit 只提示“工具/治理改动不受未决产品决策阻塞” | 正常；工具与文档维护不被产品决策卡住 |

用户验收项写在 tasks.md 里，格式 `- [ ] [用户] <场景> → 证据`；确认后改成 `- [x] [用户] <场景> → 证据（用户确认：YYYY-MM-DD）`。

### 规划看板（GitHub Project）

排序与状态只存在于 [GitHub Project「Noema V1 路线」](https://github.com/orgs/Noema-Harness/projects/1)，不在任何文档里镜像。需要 `gh` 已登录且 token 含 `project` scope；看板操作失败（断网、token 过期）只报告并阻塞看板动作，不阻塞代码提交与 `npm run check`。

```powershell
gh project item-list 1 --owner Noema-Harness --format json   # 看卡片与字段
gh project item-edit --id <item-id> --project-id <project-id> `
  --field-id <status-field-id> --single-select-option-id <option-id>   # 挪状态
gh issue comment <n> --body "证据：commit <sha>，check 873/873，STATUS 链接"   # 收口证据
```

每张卡片是 `[C<n>]` issue；收口时先贴证据再关 issue，`npm run check` 的离线门槛只校验 proposal 里的 `Plan:` 链接，不校验远端状态。

首次克隆仓库需要安装提交门槛：

```powershell
git config core.hooksPath .githooks
```

检查是否生效：

```powershell
git config --get core.hooksPath
```


测试失败时先跑受影响的单文件，避免每次都跑全量：

```powershell
node --test test/main/chat/social-chat-service.test.mjs
node --test test/main/chat/conversation-continuity.test.mjs
```

## 打包

先关闭正在运行的 Noema，避免 `app.asar` 被占用。

```powershell
npm run package:desktop
npm run make:desktop
```

- `package:desktop` 产出 `apps/desktop/out/Noema-win32-x64`。
- `make:desktop` 产出 Squirrel 安装包；发布产物按版本放到外部 release 目录，不提交。
- `apps/desktop/out*` 是构建产物，不提交。

安装包冒烟：

```powershell
npm run smoke:package --workspace noema-desktop
```

需要指定已解包目录时使用 `NOEMA_PACKAGE_DIR`；具体开关以脚本当前入口为准。

## 版本与安装

版本号同时改：

- `package.json`
- `apps/desktop/package.json`
- `package-lock.json` 的根包/desktop 条目

当前已安装的 0.7.2 位于：

```text
C:\Users\NUC\AppData\Local\noema_desktop\app-0.7.2\Noema.exe
```

已安装版本不一定包含当前源码；源码相对已安装版本的差异见 [STATUS](STATUS.md)。0.6.9 是回退版本。安装/升级前关闭 Noema，必要时确认占用 `app.asar` 的宿主进程（历史上曾由 DeepSeek Harness 持有句柄）；不要用强制结束代替确认占用。

Squirrel 升级失败时先检查：

- `app-<version>\resources\app.asar` 是否被其他进程占用；
- 旧版本目录是否仍有长路径/残留文件；
- 安装日志中的具体删除/重命名错误。

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
