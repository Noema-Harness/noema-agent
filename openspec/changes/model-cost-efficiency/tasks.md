# Tasks

## 1. 完成请求用量采集与本地持久化

- [x] 1.1 归一化 OpenAI-compatible usage 和 DeepSeek 缓存统计；针对 SSE 终止 usage chunk、缓冲响应、未知字段与非法数字补测试，运行 provider 测试。
- [x] 1.2 新增独立 SQLite 用量记录器，保留未知字段为 NULL 且绝不写入提示词正文；用内存数据库验证迁移、记录及汇总查询。
- [x] 1.3 给主聊、社交/群聊、项目执行和成员成长调用标注内部场景，并接入统一记录器；运行相关服务与 storage 测试，核对失败时记录错误不会中断原响应。
- [x] 1.4 更新 `docs/ROADMAP.md`、`docs/ARCHITECTURE.md` 与本变更说明，标明 `ModelUsageStore.getSummary()` 的本地汇总入口；运行 `openspec validate model-cost-efficiency --strict --no-interactive` 和 `npm run workspace:check`。
- [x] 1.5 补齐 DSH worker 用量路径：读取 headless `step_end` 聚合 usage、区分 cache write、给旧 profile 表做兼容迁移；无 usage 或中断步骤记录为未知，不产生新模型请求。

## 2. 从真实 usage 找到并实施最大成本杠杆

- [x] 2.1 对照官方 DeepSeek 缓存文档、OpenCode、Goose 与当前 DSH headless/token-meter 源码，形成覆盖 Noema 请求路径的短对照记录；确认缓存字段与稳定前缀边界，不复制造成额外维护的外围机制。
- [x] 2.2 根据 5 次近期 `deepseek-flash` 真实请求和源码追踪选择首个低风险优化：96,128 输入 token 中命中 44,160，token 加权命中率 45.9%，单次 0.8%–99.1%；请求均为社交/项目协作场景，不含 `root_chat`，不能代表全部调用。根对话中按请求增加的网页引用/历史检索系统消息原先位于历史之前，现移至稳定历史之后、当前用户消息之前，以保留更长的可复用前缀。用量账本同时补记工具定义 JSON 字符数（不含工具正文），便于以后区分上下文和工具负载；不新增付费基线调用。
- [x] 2.3 源码审计显示社交工具 schema 会嵌入项目、成员、工作项与来源 URL，导致这些运行时值随请求改变工具定义。将动态名单移到单条项目工具上下文，schema 保持稳定；所有真实 ID、URL 和工作项仍在服务端原有执行入口校验。一次 fixture 对照中，8 个工具定义共 17,578 字符，单个 `manage_project_plan` 定义 9,667 字符；动态上下文为 503 字符。该测量只描述字符大小，不是 token 或费用。68 项聊天、计划、协作、评审用例通过；没有为此发送新模型请求。
- [ ] 2.4 在更新后的客户端自然使用中读取 `tool_definition_characters`、cache hit/miss 与完整输入用量，确认稳定 schema 是否延长了可复用前缀，以及调用场景中的实际收益。只有自然流量，不造付费测试；若无足够重复请求，就保留为未验证并先推进 R0，不凭字符数宣称节省金额。

## Workflow follow-up

- 归档前核对本地 usage 记录不含 prompt、response 或凭据；阶段结果回写 `docs/ROADMAP.md` 后再归档 change。
