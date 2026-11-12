# Tasks

## 1. Request and Tool Identity

- [ ] 1.1 将 provider request ID 传入工具回调，并为 Social 主聊和项目工具续接创建有界、脱敏的 started / terminal 事件；结构化结果明确表示无效果时（包括 `completed/updated/deleted: false` 与来源 `status=unreadable`）不得记为成功；按实现新增成功、拒绝、失败、中断与诊断异常用例，验证事件身份串联且无参数/结果正文。
- [ ] 1.2 将诊断事件注入 Social main-service owner，展示工具名称、类别和终态字段；核对诊断详情白名单不会持久化自由文本。
- [ ] 1.3 为 provider fetch 与 response-body 设置有界总时限；将 timeout/cancel/failure 的安全错误码与 usage/request terminal 关联。
- [ ] 1.4 新增一次普通主聊 live acceptance 脚本；将数据库/profile 隔离，现存 OS 加密凭据只读引用，并保证成功/失败/取消/超时均清理。

## 2. Acceptance Preparation

- [ ] 2.1 用 `openspec validate social-chat-tool-diagnostics --strict --no-interactive` 验证规格与任务结构。
- [ ] 2.2 在阶段 2 全部实现完成后运行 Social service、provider 和诊断查询相关用例，验证整个请求→工具→usage→终态顺序、隐私排除与取消恢复。
- [ ] 2.3 在阶段 2 gate 中验证 fetch 与 SSE body 停滞超时、用户取消区分、request/usage 终态一致以及失败诊断不含原始错误内容。
- [ ] 2.4 在阶段 2 gate 通过后执行一次单请求 live acceptance，核对真实 request ID、usage/cache 来源和脱敏 trace；分别报告 provider 未返回的 unknown 字段。
