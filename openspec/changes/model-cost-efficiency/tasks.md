# Tasks

## 1. 完成请求用量采集与本地持久化

- [x] 1.1 归一化 OpenAI-compatible usage 和 DeepSeek 缓存统计；针对 SSE 终止 usage chunk、缓冲响应、未知字段与非法数字补测试，运行 provider 测试。
- [x] 1.2 新增独立 SQLite 用量记录器，保留未知字段为 NULL 且绝不写入提示词正文；用内存数据库验证迁移、记录及汇总查询。
- [x] 1.3 给主聊、社交/群聊、项目执行和成员成长调用标注内部场景，并接入统一记录器；运行相关服务与 storage 测试，核对失败时记录错误不会中断原响应。
- [x] 1.4 更新 `docs/ROADMAP.md`、`docs/ARCHITECTURE.md` 与本变更说明，标明 `ModelUsageStore.getSummary()` 的本地汇总入口；运行 `openspec validate model-cost-efficiency --strict --no-interactive` 和 `npm run workspace:check`。

## 2. 从真实 usage 找到并实施最大成本杠杆

- [x] 2.1 对照官方 DeepSeek 缓存文档、OpenCode 与 Goose 当前源码，形成仅覆盖 Noema 请求路径的短对照记录；确认每类调用的稳定前缀与易变边界，不复制造成额外维护的外围机制。
- [ ] 2.2 使用正常客户端请求观察按场景汇总的输入/缓存命中，再选择最有把握的一项优化；不得为追求指标额外发起付费请求。当前 profile 数据库尚无 `model_usage_records` 表，说明正在运行的客户端还没加载埋点版本，故目前没有命中率证据；在正常客户端使用产生数据前，不把静态推断写成实测结论。
- [ ] 2.3 对实际优化添加针对性回归检查，并比较变更前后请求结构/usage 证据；完成后回到 R0 真实协作闭环续接，不把此专项优化误报为 R0 已完成。

## Workflow follow-up

- 归档前核对本地 usage 记录不含 prompt、response 或凭据；阶段结果回写 `docs/ROADMAP.md` 后再归档 change。
