# 设计：用户控制的一次性回访

## 目标与现状

现有 `desktop-notifications.mjs` 只为已经发生的聊天回复显示一次通用通知。Noema 没有可跨重启保留的用户回访状态。新能力复用 SQLite、主聊工具和 Electron `Notification`，不引入 cron、后台常驻进程或新的通知服务。

## 状态与所有权

新增 `social_user_followups`，仅由主进程持有：

- `id`、`title`、`body`、`due_at`（UTC ISO 时间）
- `source_room_id`、`source_message_id`（可为空；聊天发起时固定为服务端当前主聊消息）
- `status`: `pending | delivering | delivered | canceled`；`delivering` 是调度器短期领取态，设置页可显示为“正在发送”。`delivered` 表示 Electron 通知 API 已接受调用，不表示操作系统保证展示或用户已读。
- `delivered_at`、`created_at`、`updated_at`

正常路径为 `pending → delivering → delivered`；通知失败或领取租约过期时，`delivering` 回到 `pending` 以便重试，用户取消则从 `pending` 转为 `canceled`。取消采用软取消以留住去重依据。来源消息被删除时其外键单独置空，回访本身仍保留；来源聊天被删除时对应关联也由外键清理。设置中编辑只允许修改待处理项，不改写已投递记录。

`app_settings` 保存总开关，默认开启。关闭时不投递，已到期项目保留为待处理；重新开启后由调度器补发。通知 API 不可用或调用失败时不把项目标成已投递。

## 创建权限与成本

- `schedule_followup` 只在 Noema 主聊、当前用户消息明确要求提醒/回访或接受 Noema 的明确提议时提供。
- 相对时间必须能解析为具体未来时间；含糊时先在对话里问清。不接受模型自行选日期、从旧资料推断触发点、成员/项目会话调用或用户消息以外的来源 ID。
- 服务端绑定当前用户消息作为来源；只允许计划未来 1 分钟至 365 天内的时间，标题最多 80 字，正文最多 500 字，最多 30 条待处理回访。
- 到期通知只读本机记录并打开 Noema 主窗，不发模型请求、不访问网络。费用为零模型调用。

## 调度与失败恢复

- 主进程启动后立即扫描到期项，此后每 30 秒扫描；系统恢复、设置重新开启时也扫描。
- SQLite 事务将一个待处理项领取为短时 `delivering` lease，调用通知后改为 `delivered`；通知 API 明确失败则退回 `pending`。过期 lease 在进程重启后可再次领取。
- 通知显示与 SQLite 写入无法构成跨系统原子事务。极端情况下进程恰在 OS 通知显示后、持久化状态前退出，可能重复显示一次；lease 限制常规并发重复，下一轮 UI 仍只保留一条记录。
- 应用完全退出时不能唤醒进程。到期项在下次启动补发；睡眠后唤醒按同一规则补发。
- 时间全部按绝对瞬间存 UTC，UI 按当前本地时区展示；时区变更不移动已确认时间。

## 用户界面

在现有伙伴设置中增加“回访”管理入口：总开关、待处理/已发送/已取消列表、来源时间、手动新增、编辑、取消。到期通知使用短标题和用户认可的正文；点击只打开主窗，聊天不会伪造一条用户消息。空状态、通知 API 不可用和调用错误都有清晰状态；不宣称能侦测操作系统实际展示或用户是否读到通知。

## 参考边界

DeepSeek 官方仓库 `deepseek-ai/dsh-superagent-prototype` 是一个 MIT 许可的研究原型，不是可直接当作生产实现的产品。源码里值得用作工程参照的是：领域状态由单一事务入口维护；事件先持久化并去重，再进入按线程批处理的评估；已授权工作以 Ticket/Assignment 绑定独立执行会话；异步副作用经持久队列在事务提交后执行；重启后检查并恢复被中断的 Assignment。它把运行时责任落实成状态和恢复规则，而不是只靠 Router/Worker 这两个名称。

这些模式帮助校准 Noema 的委托与恢复机制，但一次性用户回访不是执行 Ticket：它由用户明确安排或接受，不能因此启动 worker、项目群或定期模型轮询。此变更复用 Noema 的 SQLite 和 Electron `Notification`，用数据库状态作为到期依据；只有当多类后台副作用都需要统一重试、去重与健康状态时，才考虑抽取通用效果队列。应用完全退出时不要求操作系统唤醒进程；到期项在下次启动补发。提醒本身不调用模型，也不自动代表用户授权。

原型边界及实现可从[官方仓库说明](https://github.com/deepseek-ai/dsh-superagent-prototype)、[领域引擎](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/src/core/engine.ts)、[持久效果队列](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/src/app/effects.ts)与[执行恢复逻辑](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/src/core/assignments.ts)核对。上游 README 明确说明该仓库是供参考的研究原型，尚非生产就绪。

## 验证

定向测试覆盖当前主聊来源绑定、越权会话拒绝、时间/容量校验、暂停与恢复、通知失败后重试、投递去重、重启补发、取消后不再通知。类型/格式检查和短时桌面启动 smoke 验证线路接通；完整真实客户端体验在本地 T-11 留给最终整体验收。
