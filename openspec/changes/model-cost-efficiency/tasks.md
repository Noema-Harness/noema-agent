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
- [ ] 2.3 源码审计显示主社交路径会按项目/房间生成不同工具集合及动态枚举；当前账本过去只记工具数量，缺少定义体积，无法量化它对 token/cache 的贡献。利用新增的 `toolDefinitionCharacters` 观察后续自然请求，再决定是否精简工具描述或改为稳定 schema + 请求上下文；在此之前不删减模型能力、不为验证而额外花费余额。首个根对话顺序调整已有 55 项 root-agent 测试与 35 项 provider/storage 测试通过；之后回到 R0 真实协作闭环续接，不把成本专项误报为 R0 已完成。

## Workflow follow-up

- 归档前核对本地 usage 记录不含 prompt、response 或凭据；阶段结果回写 `docs/ROADMAP.md` 后再归档 change。
