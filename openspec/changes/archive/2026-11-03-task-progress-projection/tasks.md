# Tasks

## 1. 持久阶段表示

- [x] 1.1 定义有限 SocialWork phase 集并在 task projection 中将未知历史值归一为 `unknown`；测试合法值、旧值、terminal status 优先和 room snapshot 持久读取。
- [x] 1.2 确保建立 runtime session 不覆盖已到达的新 phase；以竞态单测验证 `session` 与首个执行 phase 的事件顺序不会把阶段退回 `running`。

## 2. 执行生命周期信号

- [x] 2.1 在 provider 调用前、首个可见 delta、模型工具请求和工具执行边界报告有限 phase；增加 executor event-order tests，空响应不得伪造 `model_response`。
- [x] 2.2 在 workspace/network 授权请求期间持久化 `awaiting_authorization` 并在返回后更新 phase；覆盖批准、拒绝、异常和写入失败，断言事件不包含命令、路径、host、reason 或凭据。
- [x] 2.3 保留限流等待、核验和 terminal status 的既有事实来源；以 SocialWorkService integration tests 断言每一阶段刷新后可从 store snapshot 复读，terminal/unknown 副作用不被 phase 覆盖。

## 3. 用户界面投影

- [x] 3.1 为有限 phase 与 active execution step 建立简洁中文状态投影；覆盖请求模型、接收响应、工具待执行、每种工具类别执行、授权等待、限流等待、核验、terminal 与未知旧值。
- [x] 3.2 在 project task card 中显示准确阶段及有限工具类别，不显示隐藏推理或临时事件载荷；验证失败/中断/outcome_unknown 文案不会出现成功或自动重放暗示。
- [x] 3.3 保留现有 room-load request sequence freshness gate；核对每次任务事件只触发持久快照重读、renderer 不把事件载荷保存为独立 task state，并通过 E1/E3 store projection 与 TypeScript 验证。

## 4. 集成和交付记录

- [x] 4.1 覆盖 executor → SocialWorkService → SocialChatStore → main event → room reload → task card 的模型/工具/授权/终态闭环；结合现有 active-workspace 与 trusted-frame IPC 回归用例验证重复/过期请求不扩大执行或回退授权。
- [x] 4.2 运行 E3 定向 tests、TypeScript、改动文件 oxlint/oxfmt、source:check、strict OpenSpec 与 diff check；更新 `docs/CURRENT_CONTEXT.md` 和 `.work/planning/PROGRESS.md`，记录阶段语义与仍不可证实的模型内部状态。

## Workflow follow-up

- 任务与规格完成且严格验证通过后归档本 change。
