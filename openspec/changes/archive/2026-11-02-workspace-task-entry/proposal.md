# Proposal

## Why

Noema 默认主聊目前只能依赖模型从自然语言中判断是否调用 `start_project_work`，界面没有明确的工作区任务入口。用户需要能主动区分普通对话与本地开发委托，并在项目执行器不可用时看见真实原因。

## What Changes

- 在 Noema 主聊输入区提供可切换的“工作区任务”模式；普通对话保持默认。
- 工作区任务模式提交时保留用户原始指令，并明确表达本地工作区执行意图，让现有项目工作工具链处理任务。
- 执行器未就绪时入口不可启用，并显示其不可用原因；不改走 RootAgent/DSH 或宿主命令。
- 在本机记录默认路由、执行器可用性和已创建 task ID，以便后续沿执行链排查。
- 继续由用户选择工作区；沿用现有 `SocialWorkService` 任务 owner、授权说明、取消和结果卡片。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`：增加从默认 Noema 主聊显式请求本地工作区任务的入口及不可用行为。

## Impact

- `apps/desktop/src/renderer/chat/social-chat-app.tsx`
- `apps/desktop/src/renderer/chat/use-social-chat-controller.tsx`
- `apps/desktop/src/renderer/chat/social-chat-surface.css`
- `apps/desktop/src/main/main.ts`
- `apps/desktop/src/main/ipc/root-ipc.mjs`
- `apps/desktop/test/main/ipc/root-ipc.test.mjs`
- `apps/desktop/src/main/chat/social-chat-service.mjs`（仅在现有意图识别不能稳定满足显式入口时调整）
- `openspec/specs/project-execution/spec.md`
- 覆盖主聊入口与当前工作区任务请求路由的定向测试

不新增依赖、IPC API、任务表或第二套执行 owner；不调用真实模型或解除 Windows command fail-closed gate。
