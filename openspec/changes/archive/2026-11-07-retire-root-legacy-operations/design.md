# Design

## Context

当前应用默认加载 `SocialChatApp`；历史实现曾通过 `#legacy` 加载 Root 对话、DSH、capture、Codex import、interaction adjustment 和 workspace 操作页面，该 route 现须退役。`root-ipc.mjs` 同时承载 Root 旧操作与 Social 仍在使用的 provider/model 配置、模型事件及其他 Social IPC，因此不能通过删除整个模块完成退役。RootStore 中的历史表和 Social 活动表各自保留；历史数据由独立只读归档 owner 提供查询/导出。

## Goals / Non-Goals

- 关闭旧 Root/DSH/capture/import/adjustment/workspace 的活动 UI、IPC、快捷键、provider context 和启动恢复路径。
- 保持旧历史表原地不变，提供独立有界只读 query/export owner；历史正文只在本机 archive view/export 中显示，不进入 Social model context。
- 保留 Social 仍使用的 provider/model 配置与 `onRootEvent` 事件子集，逐条检查 renderer/IPC 的调用者，不按文件或 channel 前缀整体删除。
- 不将 Root/DSH 工作流迁移或包装成 Social 能力；不在本变更中删除 legacy tables、加密凭据或用户数据。

非目标：重做 Social 聊天、迁移旧 Root 消息到 Social rooms、添加替代 Quick Capture、恢复 DSH、永久删除历史表，或调整与旧 Root 无关的共用 provider 语义。

## Decisions

1. **按能力拆分 IPC retirement，而非删 Root IPC 文件。** Root 活动写入、执行、重试/停止、快捷键 handshake、workspace grant 和旧 import/adjustment handler 关闭并从 preload contract 移除。Social 调用的共享 model/provider configuration 与事件由当前 owner 暂留，必须有调用点保护测试。
2. **新增专用只读归档 service。** 查询 API 只允许固定数据类别、游标/数量上限和安全过滤；不接受 SQL/table/任意路径。底层只调用 RootStore 只读查询方法；任何读取错误回为有限错误状态，不启用写回、任务启动或 consent 操作。
3. **旧路由与历史归档分离。** `#legacy` 立即退役并回到默认 Social，不作为归档入口或兼容 UI 保留。历史数据通过单独的 `#archive` 只读页面访问，显示来源标签与记录关联；没有发送、回复、重试、续跑、编辑或删除动作。Social 活动主界面不增加旧 Root 功能。
4. **导出本机显式完成。** 用户选择数据类别，先看有界预览再选本地目标；导出 JSON 保留来源 ID/时间/record type，携带完整性/省略标记。取消不写文件；不发网络请求。
5. **禁止旧恢复有固定 owner。** main startup 不消费或重试 Root pending worker events，不恢复 DSH sessions，不启动 Quick Capture shortcut。旧行仍由 archive service 查询。shutdown 只停止本进程已跟踪的旧 worker，不把它再续到下次启动。
6. **规格责任按行为分离。** `project-execution` 继续拥有活动 workspace/agent 事件；`legacy-history-archive` 拥有已退役数据的只读访问和显式导出契约。

## Data / Security

Archive IPC 继续使用现有主框架和 sender 验证。查询和导出字段在 main process 投影；renderer 不能传入 database path、SQL、表名、model context 或文件目标路径。保存目标只通过可信 main process 文件对话框取得。读取和导出失败不修改源表；已存在的 consent 字段只作为历史字段展示，不能成为 provider admission 输入。

## Migration and Recovery

不迁移、不清空、不改造历史业务记录。对 RootStore schema 不作删除性 migration。新增代码先用临时数据库验证已有 schema；若读取某类记录失败，归档结果需报告 unavailable/partial，并保持原数据库可打开。停用 DSH recovery 不删除 task/session/event 行。

## Validation

- 按 API/channel/source 退役矩阵验证旧 IPC 不可达、main startup 不产生 Root/DSH 活动操作、快捷键不注册且 pending 清理。
- 以带哨兵数据的临时 RootStore 验证各类别分页查询和导出准确、可读且不改变源表计数/校验值。
- 验证历史 imported consent 不进入任何 Social request，旧任务查询不会启动 DSH adapter。
- renderer/CDP 验收归档入口的 query、empty/error/partial/export-cancel/save 状态及无旧操作控件。
- 阶段 2 末按冻结验收表统一执行整阶段 gate。
