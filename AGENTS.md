# Noema 项目约定

## 产品与决定

Noema 是由用户拥有身份、连续性和长期状态的独立个人 agent 应用。自然交流、长期相处、行动与协作都属于整体构想；编程是一种情境，群聊和执行层是一组能力。具体构想仍需在实现和使用中完善，不把最近一条机制提升为全产品定位，也不把讨论追认为已实现规格。

产品边界见 `docs/PRODUCT_CHARTER.md`；工程职责见 `docs/ARCHITECTURE.md`；用户可读的逻辑流程见 `docs/design/noema-core-flows.md`；持久取舍见 `docs/decisions/`。用户当前方向优先，记录有冲突时核对依据并修订过时内容。

## 开发工作流

有实质范围的 Noema 工作先用 `.codex/skills/noema-project-work/SKILL.md` 核对代码现场与当前 GitHub 交付项。GitHub Issues / Project 管结果、阶段、依赖和验收状态；OpenSpec change 管该项的规格差异、技术设计、细任务与验证证据。二者互相链接，Issue 续接点只保留当前结论、提交和下一动作，不复制任务清单。

跨模块功能、行为变更和持续重构使用用户级 `openspec-workflow`；项目配置见 `openspec/config.yaml`。未安装该技能的环境可直接用 OpenSpec CLI 的 context、status 与 instructions 读取流程。小修直接处理；工具、文档维护可以使用不产生产品规格的 change。旧的独立执行计划格式已由 change 替代。

每次聚焦一个可交付片段，处理使其失效的必要依赖；达到条件后转场。新增行为用相称检查验证，文档修订检查格式和链接。产品与审美待评单独说明。阶段看板、协作隔离与源码发布操作见 `docs/PROJECT_OPERATIONS.md`。

## 工程边界

维持模块化单体，优先复用成熟实现。只有独立生命周期、隔离或扩展证据成立时才增加基础设施层。基础能力以完整使用契约校准；合并或删除入口前核对对象、范围与作用。

记忆、个人模型、经历、技能和权限是不同对象；不把完整历史逐轮注入上下文，外部材料不获得用户指令权限。持久状态、权限与失败恢复由实现保证。

重大职责、状态或依赖变更按需用 `.codex/skills/noema-architecture-review/SKILL.md`，结论进入 change 设计；长期跨变更取舍才写 ADR。界面设计用 `.codex/skills/noema-interface-quality/SKILL.md`，实际检查主要运行状态后再报告视觉交付。FreeLLMAPI 兼容路径排障用 `.codex/skills/freellmapi-operations/SKILL.md`。
