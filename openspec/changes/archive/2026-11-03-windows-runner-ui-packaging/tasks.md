# Tasks

## 1. 主进程能力报告与 setup IPC

- [x] 1.1 定义跨进程 Windows runner capability DTO 与状态刷新/变化事件，覆盖支持状态、有限原因、backend/协议/资源版本、设置状态与非 Windows `not_applicable`；以契约单测验证无路径、凭据和任意错误正文。
- [x] 1.2 在主进程增加唯一状态 owner 与只读 probe 刷新路径，能力变化同步更新 command admission gate 并发出诊断事件；用单测验证 probe 不一致时新命令被拒绝、运行中的 command owner 保留。
- [x] 1.3 增加受信 root IPC/preload 的读取、订阅和显式 setup action；测试主框架授权、启动不自动 setup、取消/失败仍关闭 gate、成功后重新 probe。

## 2. 状态界面与旧 SRT 流程移除

- [x] 2.1 在“运行诊断”显示主进程提供的 runner 状态、版本和拒绝原因，并提供仅在 Windows 显示的用户主动 setup/重试操作；界面测试覆盖不可用、setup 中、ready、取消及 probe 更新状态。
- [x] 2.2 删除 workspace picker 中 SRT Windows 用户/安装检查与旧安装提示；相关测试确认 SRT 不再被调用、Windows 不 ready 时不启动 command。
- [x] 2.3 核查 `@anthropic-ai/sandbox-runtime` 全仓引用后，只移除失效的 Windows SRT extra resource/死代码；更新本模块文档并验证 Linux/macOS 现有 runner 依赖未被误删。

## 3. Windows runner 安装资源与 manifest

- [x] 3.1 更新 Forge Windows extraResource，从 native release 输出确定性复制单一 runner，并生成含平台、架构、协议、版本及摘要的 package manifest；脚本单测覆盖缺失、重复、架构/版本错误和摘要不符时构建失败。
- [x] 3.2 更新 runtime resolver 校验 manifest 与二进制身份，验证开发态和打包态都指向同一 backend 身份；测试缺失/损坏/冲突均拒绝且不调用 SRT 或宿主 shell。
- [x] 3.3 增加 Windows Forge package-content manifest/smoke 检查并更新打包文档；检查产物含一个 Noema runner、不含 `srt-win` backend 资源。源码检查确认 Forge/Squirrel 配置没有删除或重置用户数据的 hook；真实安装、升级、修复和数据保全 smoke 留给 F1 目标机验收。

## 4. 集成回归门

- [x] 4.1 运行受影响的 main/preload/renderer/Forge 测试、TypeScript 与 lint/source-boundary 检查，修复本变更引入的问题并记录结果。全量桌面测试仍有 1 项项目评审集成用例失败，详见进度记录；未归因于 D4。
- [x] 4.2 运行 Windows Forge package smoke 与错误注入（runner 缺失、版本冲突、能力探测变化），核对 UI 报告、诊断 identity 与 executor gate 来自同一状态 owner。
- [x] 4.3 更新 `docs/CURRENT_CONTEXT.md` 与 `.work/planning/PROGRESS.md` 的 D4 进度，明确本机代码/打包检查与目标机 UAC、真实隔离验收的边界；通过 `openspec validate windows-runner-ui-packaging --strict`。

## Workflow follow-up

- F1 目标机验收由用户在安装版上确认安装/升级数据保全、一次 UAC、命令能力状态与真实隔离；若失败则继续保持 Windows command 不可用，不回退宿主 shell。
- D4 完成并验收后继续 D3 OS target-machine gate 与阶段 E；不得将本 change 的完成宣称为 Noema 一期最终验收完成。
