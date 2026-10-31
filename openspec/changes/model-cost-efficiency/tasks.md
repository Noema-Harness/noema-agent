# Tasks

## 1. 完成请求用量采集与本地持久化

- [x] 1.1 归一化 OpenAI-compatible usage 和 DeepSeek 缓存统计；针对 SSE 终止 usage chunk、缓冲响应、未知字段与非法数字补测试，运行 provider 测试。
- [x] 1.2 新增独立 SQLite 用量记录器，保留未知字段为 NULL 且绝不写入提示词正文；用内存数据库验证迁移、记录及汇总查询。
- [x] 1.3 给主聊、社交/群聊、项目执行和成员成长调用标注内部场景，并接入统一记录器；运行相关服务与 storage 测试，核对失败时记录错误不会中断原响应。
- [x] 1.4 更新 `docs/ROADMAP.md`、`docs/ARCHITECTURE.md` 与本变更说明，标明 `ModelUsageStore.getSummary()` 的本地汇总入口；运行 `openspec validate model-cost-efficiency --strict --no-interactive` 和 `npm run workspace:check`。
- [x] 1.5 补齐 DSH worker 用量路径：读取 headless `step_end` 聚合 usage、区分 cache write、给旧 profile 表做兼容迁移；无 usage 或中断步骤记录为未知，不产生新模型请求。

## 2. 从真实 usage 找到并实施最大成本杠杆

- [x] 2.1 对照官方 DeepSeek 缓存文档、OpenCode、Goose 与当前 DSH headless/token-meter 源码，形成覆盖 Noema 请求路径的短对照记录；确认缓存字段与稳定前缀边界，不复制造成额外维护的外围机制。
- [ ] 2.2 使用正常客户端请求观察按场景汇总的输入/缓存命中，再选择最有把握的一项优化；不得为追求指标额外发起付费请求。现有记录为 5 次近期 `deepseek-flash` 请求：96,128 输入 token 中命中 44,160，token 加权命中率 45.9%；逐次命中率为 0.8%–99.1%。样本不足以代表长期整体表现，也没有服务端费用字段；按现有证据优先检查动态前缀和上下文拼装，不新增付费基线调用。
- [ ] 2.3 对实际优化添加针对性回归检查，并比较变更前后请求结构/usage 证据；完成后回到 R0 真实协作闭环续接，不把此专项优化误报为 R0 已完成。

## Workflow follow-up

- 归档前核对本地 usage 记录不含 prompt、response 或凭据；阶段结果回写 `docs/ROADMAP.md` 后再归档 change。
