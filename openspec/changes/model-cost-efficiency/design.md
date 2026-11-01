# Design

## Context

见 [proposal.md - Why](proposal.md#why)。Noema 有两条模型调用路径：主进程内的 OpenAI-compatible Chat Completions，以及 DSH headless worker。前者之前丢弃 SSE usage chunk；后者的 `--json` `step_end` usage 之前被适配器丢弃；应用尚无完整的持久用量记录。DeepSeek 的上下文缓存依赖精确重复的输入前缀，并在响应 usage 中报告命中/未命中 token；其他兼容端点的字段并不完全一致。

## Goals / Non-Goals

**Goals:**

- 让直连模型请求与 DSH 后台 worker 的每次模型步骤留下可按模型、调用场景和日期汇总的状态与 token/cache 用量。
- 保留“服务端没提供”的未知状态，不把缺失字段记成零。
- 不让诊断存储故障中断用户回复；不保存请求正文或 API 凭据。
- 先以调用量、上下文与缓存数据定位成本，再逐项优化，保留真实使用行为。

**Non-Goals:**

- 本变更不新增费用估算/账单 UI，不根据公共价格表推测用户实际付款。
- 不在所有服务端点强塞供应商专用缓存标记；不新增模型调用来“预热”缓存。
- 不仅凭字符数或本地估算宣称缓存命中、token 费用或余额变化。

## Decisions

1. **直连 API 与 DSH worker 都把用量写入同一个 provider 回调边界。** 直连请求读取 OpenAI-compatible 响应 usage；DSH headless JSON 的 `step_end` 聚合 usage 经薄适配器回调。DSH 同一 step 的重试已由上游聚合；缺失任一尝试用量时，上游不输出 usage，Noema 将其保留为未知。场景标签和提示词均不发送给服务端。DeepSeek 的流式接口默认在最后一块返回 usage，因此不发送 `stream_options.include_usage`。
2. **在现有 Noema SQLite 数据库内用独立 `ModelUsageStore` 持久化。** 与对话正文分开；字段仅含日期、服务端主机名、模型、调用场景、请求状态、输入/输出/缓存命中/未命中/写入/推理 token、可选服务端成本、请求字符数及消息/工具数。现有 profile 通过幂等 `ALTER TABLE` 补入 cache-write 列，不回填历史数据。替代方案是临时日志，但它难以可靠汇总且容易丢失；不在 root 对话表或社交消息表中加入成本字段，避免绑死单一对话域。
3. **字段缺失用 NULL，非负整数才接收。** 兼容 DeepSeek `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 与 OpenAI `prompt_tokens_details.cached_tokens` 等常见结构；输入/输出 token 与缓存 token 保持独立。服务端费用原样保存为受限 JSON，若语义或币种未知不在本地换算。
4. **流式与缓冲响应都在完成边界记录一次。** SSE usage 常在终止块出现且没有 choices；解析该块但不改变流出的文字/工具顺序。工具参数纠错产生的新请求单独计量。记录失败被捕获为诊断写入失败，不可改写模型结果。
5. **缓存优化遵循前缀稳定性，而非通用模板改写。** OpenCode 的缓存策略显式按 provider 区分隐式缓存与显式 cache-control；Goose 的上下文压缩/缓存实践也有明确阈值和成本边界。Noema 先用账本确认哪些调用的提示前缀重复、动态字段在哪开始变化，再调整消息顺序或上下文；不直接移植其他 agent 的压缩策略。

6. **DSH usage 按 step 记录，不按工具调用或整个 worker 任务记账。** 已安装的 DSH headless 投影在完成 step 时提供跨 attempt 聚合用量；这最接近真实模型请求边界。Noema 只保存规范化 token 桶，不保存 DSH session 内容、推理文本、工具输入或结果。provider 没有报告的 usage 记为未知；不通过读取 DSH 私有投影缓存或直接解析其内部持久化文件来补账。

7. **缓存优化先稳定输入前缀，再用真实 usage 确认收益。** DeepSeek 文档说明后续请求只能复用已持久化且完整匹配的输入前缀，缓存为 best-effort；因此根对话中仅当前一轮才需要的网页引用和历史检索说明不应抢在此前的对话记录之前。现已把它们放到历史之后、当前用户消息之前。该改动只提高可复用前缀的机会，不保证服务端命中率，也尚未在付费请求后验证实际收益。
8. **把工具定义体积作为成本维度单独观测。** 原用量表只记录 message JSON 字符数和工具数量，未记录工具 schema 本身。现在增加 `tool_definition_characters`，只保存序列化 schema 长度，不保存名称、描述、参数、提示词或回复。现有五条账本样本均为社交/项目协作调用，缺少工具定义长度，不能据此归因低命中。源码样例中 `manage_project_plan` 约 9.6K 字符，但这是合成项目数据下的本地结构测量，不是服务端实发 token 数。后续按正常请求观察 schema 长度和缓存字段，不为验证而额外消费余额。
9. **把频繁变化的工具选项移出 schema，保持项目工具定义稳定。** 项目、成员、工作项、评审资格和来源 URL 仍需告诉模型，但把这些值放进单条请求上下文；schema 只声明字符串字段及其稳定含义。所有 ID、URL、成员能力和状态仍由原服务端执行路径校验，schema 不再承担权限边界。初次请求把对象名单放在已存对话历史之后；项目状态变化后刷新，避免模型沿用过期名单。不同项目、成员、工作项和 URL 的 fixture 对照中，工具 schema 序列化结果一致；该逻辑提升可复用前缀的机会，但没有减少静态 `manage_project_plan` 定义的体积，也未取得新的服务端 cache usage，因此实际费用收益待自然请求验证。
10. **用不含正文的交互 ID 把一次用户结果中的请求归组。** 直连 API 接受可选 `usageInteractionId`，SQLite 只存内部 turn/message/task ID；主聊工具续答共用 root turn ID，Noema 社交回复及其专家私聊/工具续答共用 assistant message ID，项目执行与 DSH step 共用执行 task ID，后台执行和 Noema 整理回复共用 background task ID。按 interaction 汇总各 provider request 的状态和 token/cache 字段；旧行保持 `NULL`，没有 ID 的调用不混成一个虚假的“结果”。查询会读取现存 root turn、社交消息、项目任务或后台任务的当前状态；项目文件核验状态和后台 Noema 回复状态分开显示，因此 completed worker 或请求不冒充已验收。该汇总不从缺失 usage 推算费用。
11. **根对话网页读取工具保持稳定 schema。** 工具仍只在用户本轮明确提供 URL 且有可用来源槽位时加入；URL 不再写进 `enum`，避免同一工具定义随用户链接变化。执行端继续从当前 turn 原文提取 URL 并逐条核验，未授权地址仍在任何网络请求前拒绝。这样只稳定工具定义，不扩大可读取地址，也不改变工具何时出现。
12. **DeepSeek 项目工具续答只在状态变化时追加最新对象快照。** 原实现每步移除并重插动态名单到本轮用户消息之前，改写了已发送请求的历史前缀。DeepSeek Chat Completions 支持在历史中加入 system 消息；现在若项目/成员/工作项/来源名单有变化，只把一条明确标为“最新”的状态快照追加在工具结果之后，相同快照不重复发送。这样保留前一请求的完整消息前缀，并让模型看到最新可选对象；当名单为空时也追加空状态，避免沿用先前对象。仅对 `api.deepseek.com` 的 Chat Completions 请求启用，其他 OpenAI-compatible 服务维持原有替换逻辑。源码级依据见 DeepSeek [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/) 对 Chat Completions 历史中插入 system 消息的说明，以及 [Context Caching](https://api-docs.deepseek.com/guides/kv_cache/) 对完整匹配前缀的缓存规则。离线服务用例确认成员增补和计划更新后，前一请求消息数组逐项保持不变，新快照位于续答末尾；未发送付费请求，真实命中与费用收益仍待自然 usage。

### 源码级校准

- DeepSeek [Context Caching](https://api-docs.deepseek.com/guides/kv_cache/) 说明缓存默认开启，但只有完整复用已落盘的前缀单元才算命中；API 返回 hit/miss token。缓存不是“对话开了就有”的开关，提示前缀稳定性才是可优化变量。
- DeepSeek [官方价格表](https://api-docs.deepseek.com/quick_start/pricing/)（2026-11-01 查阅）对 `deepseek-flash` 标示 cache-hit 输入约为 miss 输入的 1/50（非高峰 `$0.003` 对 `$0.15` / 百万 token）；这是当前上游价格快照，不在 Noema 中硬编码，实际账户以服务端 usage/扣费为准。
- OpenCode 在快照 `7ce35879b8569263f14b37cff6d84394e635b00f` 的 [`cache-policy.ts`](https://github.com/anomalyco/opencode/blob/7ce35879b8569263f14b37cff6d84394e635b00f/packages/ai/src/cache-policy.ts) 把默认断点放在工具定义尾、系统内容首尾和消息尾，并限制为四处；它会跳过使用隐式前缀缓存的 OpenAI/Gemini 路径，不对所有提供方发送 cache 标记。其 [`session/usage.ts`](https://github.com/anomalyco/opencode/blob/7ce35879b8569263f14b37cff6d84394e635b00f/packages/core/src/session/usage.ts) 将普通输入、cache read/write、输出和推理 token 分开，并优先采用提供方上报费用，价格目录仅作缺省估算。
- Anthropic 官方 [`prompt-caching.md`](https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/prompt-caching.md) 把缓存优化落实为提示构造顺序：全局固定内容在前、会话级内容其次、每轮变化的内容放在尾部；它还特别指出并行成员若只改变少量任务文本，仍会各自写入不同缓存。这里复用的是“按稳定性排布、测量前缀断点”的方法；Claude 的 cache-control 标记、TTL 与 DeepSeek 自动缓存规则不同，不直接移植。
- Goose 在快照 `b23d21cabd9b4de0c045dcdd731821a3a15c2bfc` 的 [`context_mgmt/mod.rs`](https://github.com/aaif-goose/goose/blob/b23d21cabd9b4de0c045dcdd731821a3a15c2bfc/crates/goose/src/context_mgmt/mod.rs) 用占上下文比例和绝对 token 上限共同触发压缩，并分批总结较早的工具调用。压缩调用本身也计费用；这适合其长工具会话治理，不证明对 Noema 的所有短聊天更省钱。
- Noema 当前主聊的稳定 ROOT prompt 已单独位于消息首部；专业成员则将稳定人格 prompt 与初识、项目成长、评审等动态文本拼成一个 system message。执行工具集合也随请求变化。第一批账本数据应验证这些动态边界实际消耗的缓存份额，再决定是否拆分/重排；在数据出来前不做 prompt 内容改写。
- 成本专项的首批现有样本只有 5 次 `deepseek-flash` 协作请求：两次同一社交工具轮次的连续记录、两次同一项目工具续答、另一次社交轮次；对应缓存命中率分别为 1.9%、93.6%、16.4%、99.1%、0.8%。高低值可与请求场景切换相伴，但样本没有工具 schema 字符数、精确前缀指纹或费用，不能断言工具变化就是低命中的因果。后续采集只增加长度元数据，不采集正文。

### 下一段：降低每个有效结果的成本

- 2026-11-01 本机只读账本已有 14 条成功 DeepSeek 请求、1 条失败且无 usage：共 279,820 输入 token（缓存命中 140,288、未命中 139,532）、5,822 输出 token，加权命中率 50.1%。按操作分别为：7 次 `social_project_tool_continuation` 命中率 65.9%；2 次 `social_turn:noema_main:project_tools` 为 23.9%；1 次 `social_turn:project_group` 为 3.6%；4 次旧标签 `social_turn` 为 23.8%。范围只覆盖社交/项目，且最新请求时间是本地 11:38，早于本轮 12:18 与 12:38 的前缀改动，因此仅更新基线，不能证明改动收益。
- 2026 年 10 月的 [TokenEconomizer 研究](https://arxiv.org/abs/2610.22732)把成本下降放在完整任务轨迹上处理：按任务选择短操作知识、移除长期未用工具、及时拦截无效循环；其跨 Claude Code、Codex 和 Copilot CLI 的基准报告平均任务成本下降 18.4%–30.9%，但结果来自特定软件工程基准，不能直接当作 Noema 的节省承诺。它最可借鉴的是“成本按最终成功任务计算、工具 schema 按使用证据裁剪、失败循环在花费扩大前止损”的方向。
- OpenCode 的 [SessionCompaction 源码](https://github.com/anomalyco/opencode/blob/7ce35879b8569263f14b37cff6d84394e635b00f/packages/opencode/src/session/compaction.ts)提供了另一种已落地的做法：对已完成且较旧的工具输出做无模型调用的裁剪，保留最近交互与受保护工具；压缩由上下文窗口/阈值触发，摘要调用本身也有成本。Noema 当前已有按消息数/字符限制的历史裁切，但一次项目委托内连续工具结果是另一条输入路径；不能直接复制固定 20K/40K token 常量，应先测本地同一交互中的重复工具输出与模型窗口占比。
- Codex 源码为每轮复用 session-derived cache affinity，并在同一 turn 复用 Responses websocket、sticky turn state 和增量请求；这些依赖 Responses/服务端会话协议。Noema 当前用 DeepSeek Chat Completions，不能假装加一个 `prompt_cache_key` 就能复刻该路径；可借鉴的是保持会话身份和稳定请求前缀的边界。
- 源码路径审计发现 `SocialChatService.projectTools()` 会在 Noema 主聊拥有可访问项目时，给普通回合附带项目计划与群组工具；社交消息还按路由注入项目/成员选择上下文。该设计让主聊能主动处理项目，但会把项目能力描述带入无关日常交流。它是下一轮优先量化的实际候选，不预先决定用关键词门控、显式路由还是缩短 schema，因为漏掉用户真实委托会损害核心体验。
- 一项目离线请求构造样本确认上述负载值得处理：没有项目时普通主聊发送 2 个团队/私聊工具定义，共 3,254 字符；存在一个项目但用户在闲聊时，旧路径发送 6 个工具定义，共 11,712 字符，并额外包含项目选择上下文。主聊现在仅在当前文字或最近 8 条可见消息出现项目标题、项目/交付术语或明确软件执行意图时附带既有项目工具与名单；项目群、成员项目会话、复盘报告和显式评审上下文无条件保留。普通闲聊仍保留新团队/专家委托能力，因此新委托不会被隐藏。改后相同的闲聊 fixture 发送 2 个工具、3,254 字符 schema，没有项目对象列表；与旧路径相比少发 8,458 schema 字符（72.2%）。这些是本地 fixture 的请求结构差异，不是 provider token 或美元降幅。
- 下一步不再继续扩展字符计数器，而是在保留项目路由能力的边界上检查漏判与最近上下文续接；然后等待自然使用记录回报实际 cache/token 变化。不得为了证明节省而发起额外付费请求。
- 衡量目标以“每个完成且可用的用户结果”为单位：请求次数、输入/cache hit/cache miss、输出、工具 schema、外部 credits 与任务最终状态分开看。只有原始字段覆盖充分时才比较成本；不把缓存字符数换算成 token 或美元，不把减少请求次数当作质量等价。

### 常驻行动提示按本轮能力裁剪

- `noemaActionGuidance` 原本每轮都附带计算器、既有项目续接和本机文件执行说明；普通聊天回合虽已隐藏既有项目工具，这些对应指令仍会重复进入请求。
- 现在按本轮实际的 `actionTools` 和 `exposeProjectActions` 组装提示：只有计算器实际可用时才讲算术工具；只有既有项目动作已暴露时才讲项目续接与文件执行边界。交流原则、联系人委托、创建新团队和搜索能力说明仍保留，因为相应能力在普通主聊仍可使用。
- 同一成员列表和可用能力 fixture 下，完整行动上下文由 1,682 字符降至 1,487 字符，少 195 字符；服务测试确认普通闲聊仍保留委托/组队指导，项目问题重新带回项目及文件执行指导。字符差异不是 tokenizer 或实际账单测量，提示改变对自然回复质量仍需由后续正常使用观察。

### 2026-11-01 成本专项续接证据

- 截至本机 2026-11-01 11:38 的只读账本有 14 条成功记录和 1 条失败且无 usage 的记录。成功调用共 279,820 输入 token（cache hit 140,288、miss 139,532）、5,822 输出 token，加权 cache hit 为 50.1%。`social_project_tool_continuation` 7 次平均每请求 25,969 输入 token、命中率 65.9%；`social_turn:noema_main:project_tools` 2 次命中率 23.9%；`social_turn:project_group` 1 次命中率 3.6%；旧标签 `social_turn` 4 次命中率 23.8%。没有 `root_chat`、成长或足量主聊闲聊样本，不能据此推断这些路径或长期平均。
- 其中 3 个带 `interaction_id` 的完整交互组分别用了 4、3、1 次模型请求；输入量为 101,792、53,258、14,151 token。前两个多请求交互说明应继续按“一个用户结果”的成本看待项目委托；旧的 6 条请求没有交互 ID，不能事后可靠归组。
- 最大单次成功输入为 31,715 token、请求 JSON 58,900 字符；最差命中率是项目群 1/14,151 token 命中。工具定义记录里，优化前 `social_turn` 曾有 17,551 schema 字符；后续项目成员续答为 8,116，Noema 主聊项目模式仍为 13,703。字段缺失的旧行不补值。schema 字符不是 token，不能单独归因账单变化。
- 官方价格页在 2026-11-01 显示 `deepseek-flash` 非高峰输入命中 `$0.003/M`、未命中 `$0.15/M`、输出 `$0.60/M`；上述 14 条成功样本时间都落在周末非高峰时段，按公示价估算模型 API 费用约 `$0.02484`（未命中输入 `$0.02093`、命中输入 `$0.00042`、输出 `$0.00349`）。这不是账户账单，不含无 usage 的失败请求、Tavily 或其他供应商费用，也不能外推用户剩余余额。详见 [DeepSeek 官方价格表](https://api-docs.deepseek.com/quick_start/pricing/)；页面也注明实际价格可能调整。
- 最新账本时间早于 12:18/12:38 的前缀改动，后续自然 usage 尚未出现。故此处只校正基线；不把已有请求误称为改动后的数据，不额外付费造样本。
- 外部实现分别解决不同层次：OpenCode 只对尊重 inline cache hint 的协议放置断点，并跳过隐式缓存端点；Codex 为其 Responses 会话保持 prompt-cache affinity 与可增量请求状态；Goose 用显式阈值与摘要管理长上下文，同时文档也说明压缩本身有开销。Noema 当前使用兼容 Chat Completions 与 DeepSeek 自动前缀缓存，没有可移植的 session key 或 inline cache control。可复用的是“稳定前缀、明确上下文边界、记录整条结果成本”的原则，不是直接复制其它协议的缓存参数。
- 初步候选杠杆按证据排序为：①将同一委托的多次模型请求按最终用户结果归集，识别工具续答的上下文放大；②实测是否因群消息、工具结果或系统上下文不断追加而重复输入长前缀；③确定仅在有使用价值时才缩短上下文/工具说明。暂不先做泛化压缩或改写提示词，避免以推测换取质量回退。
- 首个增量为请求归组：新增可空 `interaction_id` 和索引，保持旧数据兼容；新汇总返回同一交互内的 request/status/token/cache 合计及 cache breakdown 覆盖数，并从权威对话/任务表读取当前结果状态。项目验收与后台回复状态分列；接下来还需把搜索等非模型按次费用接上，才能称为完整的“每个成功结果成本”。

### 2026-11-01 项目计划工具载荷优化

- 方案排序优先选择工具 schema：历史调用样本中 8 个工具定义共 17,551 字符，`manage_project_plan` 占 9,667 字符；这段定义随每次项目续答重复发送。对比 Goose 的按阈值压缩与 OpenCode 的协议专属缓存处理，Noema 这一路径能直接控制的是发送给模型的能力描述，且不需要增加模型调用或改动供应商协议。
- 生成 schema 时按真实会话角色裁剪：协调者保留完整计划操作；普通成员只看到读取、证据检查、提交/阻塞本人工作项和受指派评审操作。项目绑定会话不再携带重复的 `project_id` 字段。服务端既有授权和状态校验不变。
- 可复现的本地序列化测量：协调者工具由 9,667 降至 5,819 字符（减少 39.8%）；成员工具降至 2,708 字符（减少 72.0%）。既有样例的总工具定义为 17,551 字符，因此在其余 7 个工具完全不变的估算下，协调者整组定义减少约 21.9%，成员整组减少约 39.7%。这些是 schema 字符数，不等于 token、provider usage 或费用；实际模型调用效果需由更新后自然流量验证。
- 行为边界：不因减少 token 而在服务端削弱角色授权。成员无法通过模型可见 schema 修改计划结构；即使构造未经 schema 声明的工具参数，服务端既有检查仍是最终约束。
- Tavily `/search` 在请求中打开 `include_usage`，读取响应中的 `usage.credits` 与 `request_id`；写入独立的 `external_usage_records`，按交互 ID 查询成功、失败和 usage 覆盖数。模型 token 账本不伪装为搜索账单；Tavily 不同账户计划的 credit 价格不在本机统一折算，直连读取公开网页也不记录为第三方计费。查询文本和 key 不持久化。搜索失败但尚未返回 usage 时保持 unknown，因为请求是否已经计费无法由客户端推定。

### 2026-11-01 动态上下文的缓存边界

- 请求构造审计发现，按本轮工具能力变化的行动指导、用户转发说明和历史检索结果都曾放在聊天历史之前。DeepSeek 自动前缀缓存按请求前缀复用；这些片段变化时，后面的旧对话无法继续成为相同前缀。
- 已把这些按轮变化的片段移到既有聊天历史之后、当前用户消息之前。指令仍在当前问题前提供；工具选择与服务端授权没有改变。
- 定向用例验证普通历史、动态行动指导、历史检索结果和当前用户消息的顺序。此证据证明请求结构保持连续，不证明实际 cache hit、token 或账单已经改善；继续用自然 provider usage 验证。
- 重试边界也属于每个有效结果的成本：provider 层一次 `streamChat` 只发送一次请求，但 RootAgent 过去会在 `provider_error` 后自动新建一个 attempt，甚至首轮已输出文本时也会重放。显式 provider 错误可能已经经过计费处理，客户端无法证明重放免费；因此现在只对无输出的 `provider_unavailable` 保留一次恢复，其它错误由用户看到失败与保留内容后显式重试。单次失败请求是否计费仍以 provider usage 为准；缺失时记为未知。
- 社交账本最初把主聊、成员私聊和群聊共用一个 `social_turn` 操作名。源码显示这些路径可能带有不同系统提示、历史窗口和工具集合，因此原先 23.8% 的聚合命中率只描述混合样本，不能用于定位某个会话的缓存表现。现只记录固定路由类别（如 `social_turn:noema_main`、`social_turn:project_group`），不记录会话 ID 或文本；以后按同一路径比较 hit/miss，避免把不同前缀结构混成一个平均数。

### 工具裁剪与缓存的取舍

- DeepSeek [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) 只提供 `tools` 与 `tool_choice` 的 `none` / `auto` / `required` / 单个指定函数；没有 OpenAI Responses API 的 `allowed_tools` 子集接口。OpenAI [Prompt caching diagnostics](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics) 展示了固定工具清单配合 `allowed_tools` 的做法，可以保持工具前缀并按轮限制可调用工具，但不能直接移植到 Noema 当前的 DeepSeek Chat Completions 路径。DeepSeek `tool_choice: "none"` 只能关闭全部工具，不能隐藏部分工具的可调用权。
- CacheRouter（[2026-08 论文](https://arxiv.org/abs/2608.22708)及[原型源码](https://github.com/qingyiwanchen/CacheRouter)）把稳定的小型核心工具集留给主模型，另加一条路由模型链寻找长尾工具。论文报告来自 55 个功能查询与 30 轮对话的原型结果；这是可行性信号，不能当作 Noema 收益基线。源码显示该路径会再调用路由模型来筛选和执行工具；Noema 现在的工具集合较小，已有按角色缩减 schema 和按情境隐藏无关工具的实现，复制此架构可能用更多模型调用换缓存稳定。
- 目前不改为“永远发送完整工具清单”：DeepSeek 缓存命中输入单价显著低于未命中，但未命中时大 schema 仍要付费；正确比较应是每个成功用户结果的真实 provider 输入成本与质量，而不是单看命中率。新增的主聊用量标签将“普通主聊”和“暴露既有项目工具的主聊”分开，以免把两种工具前缀结构混作一类；工具定义字符数仍作为解释变量一并记录。

## Risks / Trade-offs

- [兼容端点忽略或拒绝 `stream_options`] → 仅对 DeepSeek 请求 `include_usage`；其他端点被动读取 usage，故字段缺失时指标覆盖率会显式下降。
- [新记录可能被误读为账单] → 字段与导出/诊断命名明确为 provider usage；不汇率转换、不推算本地货币。
- [新表持续增长] → 每次记录极小且不含正文；先保持逐请求粒度，后续按实际使用规模决定保留/聚合，不引入预设清理期限。
- [回调或本地数据库异常影响回复] → 记录操作独立 try/catch，仅写受控诊断日志；模型响应原有完成/失败状态不变。
- [断流请求被计为失败但实际上游可能已经计费] → 单独统计失败/中断请求；没有服务端 usage 时显示未知，不按 0 计费。

## Migration Plan

创建独立用量表和索引，不变更已有数据、不回填旧请求。新版本第一次打开数据库时 `CREATE TABLE IF NOT EXISTS`；已有表以幂等 `ALTER TABLE` 增加 `cache_write_tokens`，旧记录保持 `NULL`。若实现回滚，保留用量表即可；应用旧版本忽略新增列。

## 实施记录：2026-11-02 项目请求前缀

源码追踪发现 `SocialChatService` 曾在历史之前注入动态 `noema_project_session`、成员资产快照和项目经历简报；评审状态、资产管理指导及部分项目指引还会改变首个 system 消息。计划或资产变化、调用场景切换都可能让请求在对话历史之前分叉，削短 DeepSeek 可以复用的共同前缀。现已将这些按轮内容与条件指令放到既有历史之后、当前用户消息之前；稳定人格提示留在开头，消息内容、系统角色和服务端授权不变。

定向用例检查请求消息顺序：历史先于项目与成员资产快照，当前用户消息仍保持在动态上下文之后。`social-chat-service.test.mjs` 的 26 项用例全部通过。此改动没有额外模型成本，但本地结构测试不能证明 provider 实际命中率提高；后续只从自然请求的 cache hit/miss usage 确认。

## 实施记录：2026-11-02 项目计划写入回执

源码追踪确认，`manage_project_plan` 的 `replace`、`update_item` 和 `update_phase` 在写入成功后，原先都会把整份计划快照作为工具结果加入同一轮后续请求。计划的规范状态仍由 SQLite 保存，后续需要完整内容时可以按 ID 使用 `read`，因此写操作回执只保留修订号、整体进度和受影响阶段/工作项的状态摘要；读取、历史、证据检查及错误路径保持原样。

对照 [OpenCode 的会话压缩源码](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/compaction.ts)与 [Goose 的上下文管理说明](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/sessions/smart-context-management.md)，成熟实现会按新旧程度裁剪或摘要工具输出，并保留近期细节。Noema 这次只处理可由持久化计划重读的成功写回执，不引入摘要模型调用，也不裁剪证据读取结果。定向 fixture 中回执由 1,203 降至 498 字符（−58.6%）；这是单项结构指标，不代表实际 token 或账单节省，真实效果继续等待自然 usage。
