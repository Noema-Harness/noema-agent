# 本机运行与平台说明

按需要读取以下入口，实际命令与触发条件以当前 package.json、workflow 和代码为准。

## GitHub 与截图

通用 GitHub 协作与故障判断见用户级 `development-maintenance` 的 GitHub 参考；以下只记录本项目入口和平台差异。

多行 Issue 正文用 `node scripts/set-github-issue-body.mjs <编号> <Markdown文件>` 上传并回读核对，避免 shell 转换丢失换行。Git/GitHub 连接入口及发布规则见 `docs/PROJECT_OPERATIONS.md`。

截图用 `scripts/capture-window.ps1 -WindowTitleRegex '^Noema$' -OutputPath <绝对路径>`，返回所用 API、PID 与文件信息。窗口正常但捕获通道超时时可用此原生路径；窗口无响应时检查 `%APPDATA%\Noema\renderer-health.jsonl` 与 Windows Application Hang/Error 事件。renderer 日志记录 unresponsive、responsive 和 render-process-gone。原生截图成功不能单独证明应用从未卡死。

## 模型与执行链

`npm run e2e:social-work --workspace noema-desktop` 使用隔离数据库与临时工作区验证执行服务。真实模式沿用已选 provider/model，会消耗上游额度，仅在验证实际执行链时使用；`--synthetic` 验证服务行为，不证明真实模型或 UI 表现。临时指定模型可设置 `NOEMA_E2E_MODEL`，不必改用户的应用配置。

FreeLLMAPI 为兼容路径，其目录、生成与路由诊断按专用 freellmapi-operations 技能处理，不将它作为所有客户端验证的前提。

## CI 与打包

工作流位于 `.github/workflows/desktop-checks.yml`。步骤尚未启动、runner 为空时查 check-run annotation；已记录账户 spending limit 阻断，运行结果需要按当次原因解释。

Forge/Vite 打包过滤保留 `.vite`；better-sqlite3 是主进程外置 native runtime，需由 packagerConfig.afterCopy 放入 app 包，兼容 workspace hoisting。生产包能构建与能真实启动分别验证。

该私有仓库曾因 GitHub Free 方案无法启用 branch protection/rulesets；检查定义不能等同平台强制门禁。手动工作流按配置生成私有便携预览，安装器涉及 Squirrel、代码签名与升级流程，修改发行模块时再核对当前实现与本机权限。旧记录中的 `.nupkg` Access Denied 不足以判断新版本状态。
