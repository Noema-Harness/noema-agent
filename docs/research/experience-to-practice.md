# 从经历到专业实践：研究记录与当前判断

日期：2026-10-18
状态：第一轮外部研究综合；是待检验的设计观点，不是 ADR 或实现规格。
关联：Issue #2 / M1；[持续型好友与聊天空间讨论基线](../design/persistent-agent-social-model.md)

## 研究问题

Noema 的专业好友不是为一次任务创建的工具，而是围绕一门可发展的实践长期存在。核心难题因此不是“怎样多存一点记忆”，而是：一次真实经历如何变成可迁移、不过度泛化的专业判断；它如何在多个聊天/工作空间中影响同一好友，同时不把彼此无关的上下文混在一起。

本记录区分三类证据：已公开的项目实现与文档、论文在其评测环境中的结果、Noema 的设计推论。论文结果不直接证明个人产品中的体验效果。

## 代表性实现与研究

### Hermes Agent：把一次工作提炼成按需加载的 procedure

Hermes 官方 skill 文档把 skills 称为 procedural memory；提示 agent 在形成可复用的多步流程、经历错误/死路并找到有效路径、或用户纠正做法后写入。其建议是记录可泛化规则及原因，而非保存事故流水账；USER/MEMORY 另用于较短的持久事实。实际后台实现是在每轮后派生一个 review fork，重放对话快照，按可用工具白名单判断是否写 memory/skill；默认写入审批关闭，可开启审批暂存。主会话的 memory 注入在 session 开始时冻结，所以同 session 写入的 memory 不会立即进入当前上下文；关闭/新建 session 是其记忆循环的重要边界。技能更新对当前会话则通过下一轮一次性变更提示和之后的 prompt compaction 生效。

Hermes 的内置持久状态仍是有字符上限的 `MEMORY.md` / `USER.md`，并配合 session search；同一 Hermes home 不应让多个 agent 进程共同写入，跨 profile 共享记忆需要外部 provider。这是一个明确的身份/写入隔离选择，而非对“多个社交房间属于同一个专业好友”问题的完整解答。另有独立的 [Hermes Agent Self-Evolution](https://github.com/NousResearch/hermes-agent-self-evolution)：它用 DSPy/GEPA 在离线评测中优化 skill；README 当前标记 skill 阶段实现、tool/system-prompt 阶段计划中，并要求测试门、语义保持和人工 PR review。它不是核心会话每轮自动学习机制；该仓库由 Hermes 维护者创建，但与主 agent runtime 分开，GitHub API 记录最近 push 为 2026-06-17。这里“内置日常 review”与“离线优化评测”是两条不同生命周期，不要混为一个“自我成长”功能。

这是一套现实可用的工作流复用机制：经历、稳定事实和程序文件被分开，长程序按需加载，变更可审批。但“每轮 review”生成/写入 memory 或 skill，不等于在同一当前会话里即时改变模型状态；写入成功也不证明它在新情境中有用、不会错误触发或已让 agent 形成稳定个体性。内置身份状态与 profile/session 绑定，也不是跨多个渠道共享的一位专业好友。[Hermes skills 文档](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md) · [Hermes memory 文档](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) · [后台 review 实现](https://github.com/NousResearch/hermes-agent/blob/main/agent/background_review.py) · [skill evolution 独立仓库](https://github.com/NousResearch/hermes-agent-self-evolution)

### Voyager：由环境反馈和 verifier 把游戏行为沉淀为可执行技能

Voyager 用 GPT-4 生成 Minecraft 控制代码，把运行环境观察、解释器错误和另一轮 GPT-4 自我核验重新带入迭代；任务经 verifier 判定完成后才把代码加入可检索的 skill library。技能可以被带到新世界，解决新任务。论文也记录自身边界：API 成本高、agent 会卡住、模型会虚构物品或调用不存在的函数，verifier 也会漏判（例如未识别正确的击杀信号）。

它比纯文本“我学到了……”强的地方，是经验能落成可运行行为、并由环境反馈筛选；但它有 Minecraft 可读状态、具体工具语义和可执行代码作为判据。此种闭环不能直接推广到“如何理解用户”或“怎样在跨房间关系里成长”。[Voyager 论文](https://arxiv.org/abs/2305.16291) · [Voyager 源码与运行方式](https://github.com/MineDojo/Voyager)

### MUSE：分层记忆、子任务反思与执行检查

MUSE 把状态分成 procedural、strategic、tool memory；每个子任务后由 Reflect Agent 沿运行轨迹追溯结果，并用工具再次检查事实、交付物与数据完整性。通过时将操作过程整理成 SOP，失败则写失败分析；整项工作结束后再跨层去重、归纳。其 ACL 2026 Findings 论文在 TheAgentCompany 的 175 项任务上评估，持续学习部分从 18 项中选样，按顺序运行 3 轮并做 5 次完整重复，报告了积累状态的提升。

这提供了“经验提炼需绑定行动轨迹与可检查结果”的正面证据。适用边界也由作者自己说明：框架仍难处理某些高层规划/多跳搜索问题；TAC 有含糊描述及对有效替代路径较僵硬的确定性评分。它证明的是受控生产力任务中的性能提升，不是跨私聊/群聊的个人关系连续性，也不证明摘要本身产生了人类意义上的专业判断。[ACL 2026 Findings 论文](https://aclanthology.org/2026.findings-acl.1522/) · [MUSE 源码](https://github.com/KnowledgeXLab/MUSE)

源码核对进一步说明它不是只在论文里写了“反思”：`MemoryManager` 实际读写 `tool_memory.json`、`procedural_memory.json`、`strategic_memory.json`，并把这些状态组装进 system prompt；Reflect prompt 要求对 Task Agent 轨迹做逐条来源引用，并能调用工具主动核查。经检查成功后才更新平台 SOP；失败时生成障碍分析；SOP 明确要求 step-level 操作、前置条件与已核实结果。工具/应用指南还会按实际使用结果给 `1 / 0 / -1` 反馈，允许后续纠正。这比“任务后让模型自由写总结”严谨得多。

但它的核心单元仍是企业软件操作任务中的指南/SOP，验证主轴是完成目标和工作流；研究实验是有限的顺序重复任务及 TAC。它没有给出同一专家好友横跨多种聊天关系时的上下文权限模型，也未解决不容易被机器验证的专业判断/用户口味如何学习。故它是 Noema 可能复用的成熟局部实现，不是 Noema 的整体架构或产品理由。

### OpenClaw 与 Hermes：同一 agent 身份可以有多房间，不必把 transcript 合并

OpenClaw 的 session 文档把 direct messages 默认路由到 agent 的 main session，而群聊/频道各有隔离 session；可选的跨会话 memory recall 默认只读取同一 agent 的私聊来源，排除群组/频道。因此“在私聊里问工作群里发生了什么”不会从这条 memory pathway 得到群聊历史；更宽的 session tools 默认 visibility 可跨 agent 读取，需要主动收窄权限。这个取舍一边避免群内容静默泄漏，一边造成无法回忆的“隐私式遗忘”。OpenClaw 也明确把每个 `agentId` 当成一条独立 persona/state 边界：工作区、session store、基础 memory 分开，跨 agent transcript 默认不互搜。不同会话是上下文/隐私边界，不自动意味着不同身份；不同 agentId 才是不同身份。

当前 OpenClaw 的 **Dreaming** 更进一步：聊天和 daily notes 先进入 episodic/short-term 区，长期 `MEMORY.md` 由定时 deep consolidation 晋升；阈值包含分数、召回次数、不同查询数量，排序还计入 relevance、recency 和多日复现。Light/REM 反思不直接写 curated memory；晋升时保留来源、限制旧条目丢失、先保存旧文件，失败时退回 append-only 写入，结果以 `DREAMS.md` 的可审查摘要呈现。底层源码也能看到实际 rank/apply 调用链与日志，而非只有概念文档。[Dreaming implementation](https://github.com/openclaw/openclaw/blob/main/extensions/memory-core/src/dreaming.ts)

这提供了一个新候选原则：**一条经历不必在发生当下就被判断为长期重要；它之后是否在不同提问中再次被找回，能作为“它确有用处”的证据。**但 recall 只度量内容被取回，不一定证明它改善了行动或判断；程序能力还要结合执行结果和负迁移信号。更重要的是，OpenClaw 的实际 bug 报告曾发现每日 cron 新闻摘要通过重复信号被晋升为长期记忆；项目最终在 transcript 源头识别并排除 cron session，而不是只改权重。这说明未来使用频率必须先在事件类型、来源与权限都正确的语料上计算。[误晋升问题与当前 main 修复说明](https://github.com/openclaw/openclaw/issues/79507)

Hermes 也能让桌面、TUI、终端、消息平台窗口附着同一 gateway session；同时 DMs/groups 可按配置共享或隔离 session。它的官方文档提醒，永不 reset 的长会话会让“保存—下一 session 注入—旧 session search”的学习循环很少触发，memory snapshot 也只有在新 session 才完整重载；持续数周的 transcript 会反复压缩并增高成本。OpenClaw 的 memory context 也明确区分 transcript 的长寿命与模型回合 context，要求在会话边界重新载入整理后的长期状态。

这两者给出一个成熟而不夸张的结论：**身份连续与上下文合并是两回事，而且上下文边界必须单独设计。**“持续好友”不应被误解为给模型一个无限运行的 transcript；聊天可以长期存在，而具体推理/工作 context 仍可分房间、重建或压缩。OpenClaw 还暴露了本项目需要区分的两种事件：用户临时询问工作群里的细节，是对一条既有房间事件的授权检索；将某经历提升为好友长期的专业判断，才是成长。前者不能自动污染后者，后者也不该靠把群聊 transcript 全塞进私聊实现。[OpenClaw session model](https://github.com/openclaw/openclaw/blob/main/docs/concepts/session.md) · [OpenClaw multi-agent isolation](https://github.com/openclaw/openclaw/blob/main/docs/concepts/multi-agent.md) · [Hermes session model](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/sessions.md) · [Hermes memory/session boundary](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md)

对 Noema 的直接含义：**“联系人 roster + 同一个 agent 出现在多个会话空间”本身不是新颖点，已有开源 gateway/agent 应用提供了相当接近的身份和 session 基础。**真正还未解决的是，Noema 的专业好友能否不只是一个被多房间调用的配置身份，而能将有证据的经历转成跨空间但有边界的实践变化，并让用户理解它为什么这样变化。OpenClaw 的不同 agentId 是彼此隔离的 persona/state；它还允许跨 agent session 工具，但其文档默认配置可给 Gateway agent 很宽的 session 可见性，必须显式考虑安全边界。不能只抄“共享上下文”而忽略不同聊天的隐私、权限和状态所有权。[OpenClaw session tools](https://github.com/openclaw/openclaw/blob/main/docs/concepts/session-tool.md) · [OpenClaw trust model](https://github.com/openclaw/openclaw/blob/main/docs/gateway/security/trust-model.md)

### MemArena：同一身份跨房间连续，不等于有权跨房间披露

MemArena（NeurIPS 2026 Datasets & Benchmarks）在由 50 个模拟 agent 组成的 15 天社交世界中，分开评估跨会话回忆、推理、校准拒答和 permission-aware access。访问权限题有 ALLOW 与 DENY 两类事实；必须同时做到该说时正确说、禁止时不泄漏才得分。其最尖锐的结果是：被测 backend/reader 组合没有稳定形成“证据取回且按权限闸控”的象限。Oracle 把证据直接给到模型时，较强模型仍会在 75–99% 的 DENY 请求上泄漏；其他检索方法的低泄漏很多只是没找回事实，并非真正守住了规则。

这使跨房间权限从“便利功能”升级为核心架构边界：好友身份应能连续，原始经历仍须保留房间、参与方和允许用途；事件检索的授权与模型是否遵从披露政策必须分开验证。该评测使用合成英语世界、15 天单世界和单轮权限问题，不能直接证明真实社交长期行为，但足以反驳“让模型自己看上下文决定这段话能否跨房间”作为安全方案。[MemArena 论文](https://arxiv.org/pdf/2608.02613) · [NeurIPS 2026 论文列表](https://neurips.cc/Downloads/2026)

### OpenClaw Dreaming：长期记忆不是“复盘时写入”，而是经后续使用获得资格

OpenClaw 当前的 Memory Core 提供一个已进入真实项目代码的多阶段路径：原始对话/每日记录先作为有来源的 episode 存放；Light 负责去重和暂存，REM 做主题反思，但都不写入 curated `MEMORY.md`；Deep 才按检索相关度、重复使用次数、不同查询覆盖、时间新鲜度、多日反复及概念信息等信号评分，并要求分数、召回次数、查询多样性同时过门。未信任或系统来源在进入模型整合之前就被结构性排除。然后模型只给“新增/合并/取代”等操作判断，代码写入器使用带来源的原文片段执行；还会限制旧条目的丢失比例、保留来源引用与预算，并在写入前备份。`DREAMS.md` 供人查看，不是长期记忆的晋升来源。

维护轨迹很有启发性：2026-05 有用户报告每日新闻/代码检查等 cron 送达内容因重复出现，误被晋升到 `MEMORY.md`；问题最后不是靠调低召回阈值，而是在 session 导入源头把 cron 类会话排除，并加回归测试。这暴露一个关键事实：频率、相关性等分数只能在**先正确分类了事件来源和用途之后**才有意义。

也不能照搬成 Noema 答案：重复召回只证明某条资料被取出，不必然证明 agent 的动作或结果变好；一个始终被问起但过时/错误的信息可能也有高频。Dreaming 管的是事实/摘要晋升，不是跨 task 验证某位专家的 procedure，更不证明“自然成长”。它是当前最成熟的“让记忆通过未来使用才晋升”的参照和可检验反例，不是专业实践成长的完成解法。[Dreaming architecture](https://github.com/openclaw/openclaw/blob/main/docs/concepts/dreaming.md) · [Memory architecture](https://github.com/openclaw/openclaw/blob/main/docs/concepts/memory-architecture.md) · [cron 误晋升事件及源头修复记录](https://github.com/openclaw/openclaw/issues/79507) · [当前实现](https://github.com/openclaw/openclaw/blob/main/extensions/memory-core/src/dreaming.ts)

### SkillLens：不能只评“写得像好 skill”，要测完整生命周期

Microsoft Research 的 SkillLens 研究把流程拆为经历生成 → skill 提取 → skill 使用，交叉比较提取模型与执行模型，并在五类 benchmark 中测量提取物在 held-out 任务上的实际效用。2026 年 arXiv 预印本报告：skill 平均有帮助，但负迁移并不罕见；模型提取能力与消费 skill 的能力并不等价，模型规模和原始基线分数也不能预测适用性。文本是否流畅/看起来合理，不足以预测真实效用。作者找到的较强 utility 线索是“指出具体失败机理、给出可执行步骤、列明高风险错误动作”；成功/失败经历的理想比例随任务领域变化。

这直接反驳“每次工作后自动总结一条更好的指令”这种默认路线。该研究为受控比较刻意把单一 skill 直接注入系统提示词，隔离 retrieval 和 harness 因素；它没有验证丰富的长期个人 agent、多房间上下文或自然对话。arXiv 当前标为预印本，不能把其指标当作已确立的通用规律。[论文](https://arxiv.org/abs/2605.23899) · [SkillLens 代码与实验协议](https://github.com/microsoft/SkillLens)

### MemSkill：还可以学习“如何记忆”，不只学习被记住的内容

MemSkill 把 memory skill 与 memory content 分开：controller 选择如何抽取/整合/修剪，executor 根据被选策略生成记忆，designer 从困难案例中提出策略修订。它显示“提取机制本身”也可以是学习对象，而不是把所有问题都归因于记忆库大小。论文在 LoCoMo、LongMemEval、HotpotQA、ALFWorld 上评估；NeurIPS 2026 官方论文目录列出了该论文。

这对 Noema 的启发是：一个新闻观察者或开发好友的专业成长，未必等于它记得更多内容；它也可能逐渐形成更好的判断方式——何时记录、何时忽略、如何检查来源、何时复用过去方法。不过 MemSkill 研究的是基准上的记忆管理策略，不等价于具有持续身份的专业 agent。[MemSkill 论文](https://arxiv.org/abs/2602.02474) · [NeurIPS 2026 论文目录](https://neurips.cc/Downloads/2026)

### Changing Preferences：记忆是否相关，应问“它能否改变当前判断”

2026 年另一篇偏好检索预印本批评仅凭 embedding 相似度取记忆：一段与“音乐”主题相似的旧偏好可能被取回，却已经被用户最近的选择更新。它用目标答案 likelihood 改变量化候选 memory 的证据价值，并将其用于 memory-on/off gating 与 turn selection；报告在偏好变化较多的 benchmark 上优于常见 embedding baselines。

这与“跨房间能否检索出资料”不同，重点是 retrieved memory 对当前回答到底增加了多少证据。然而该方法训练依赖已知参考答案和 SFT 控制器，评测主要是多项选择题，且只处理 user-side histories，不包括 assistant turns；它不是无需训练的通用 agent 功能，也没有测试专业实践/群聊权限。本轮只取其问题定义：**memory 的选取应按当前意图下的证据效用，而非主题相似性。**[论文](https://arxiv.org/abs/2606.02976)

RPEval（后被列入 NeurIPS 2026 论文目录）补上了一个不同的问题：用户偏好在当前任务里应该被 Ignore、Support，还是 Dominate。其数据构建覆盖约 100 个日常场景、约 800 个简短 query，再扩为约 15,000 条 preference/query/intent 组合；研究报告偏好无关时模型经常仍强行个性化，也明确承认主观 preference use 不存在完美客观 ground truth。作者声称在某个商业个性化助手的已知失败案例中解决约 80%，但完整业务数据和评测细节不公开，不能把这个数字泛化成真实用户的普遍改善。

这对“同一好友跨房间成长”有直接提醒：保存了一条用户偏好或 agent 经验，不代表每个相关话题都要用它；检索正确和应用合适仍是两个判断。它也不能解决专业成长——RPEval 刻意不测长上下文回忆、事实正确性或程序迁移——所以应作为一项必要的负例/门控视角，而不能充当 Noema 的学习框架。[论文与局限](https://arxiv.org/abs/2601.16621) · [官方论文目录](https://neurips.cc/Downloads/2026)

2026-10 最新预印本 MemCalib 将影响强度进一步拆成 `Ignore / Bound / Control`：无关记忆不应留下答案痕迹；相关记忆可有限支持；只有确实决定任务结果的事实才应主导结论。作者在 15,000 个合成/重组样本上发现，多种前沿模型普遍过度使用或不足使用 memory；常见训练改善一个方向时可能恶化另一个方向。它用 memory atom ablation 估计答案 token 对具体记忆的依赖度，再分别给过用/少用信号分配 credit。这为 Noema 提供了一个关键而未解决的中间层：即使读取权限没问题、记忆也确实相关，模型仍可能用得过头。

限制：MemCalib 是新预印本，指标由 atom-level rubric/LLM judge 构造，覆盖健康、一般助理和编码任务；它训练模型学会校准，不是桌面 agent 的零样本方案，也未验证长期关系或真实聊天中的用户感受。[MemCalib 论文](https://arxiv.org/abs/2609.24259)

### Credit assignment：最终成败不能告诉 agent 究竟该改哪一步

近年的论文已把经验学习的难点明确写成 credit assignment，而不是仅仅“有没有 memory”或“会不会反思”。AttriMem 指出 task-level reward 无法告诉记忆构造中哪些片段真正支持了答案；TreeMem 试图把最终分数分配给构建/摘要/检索等不同 memory agents；ICML 2026 的 TRUCE 则把多 agent 的总结果归因到更有信息量的子轨迹，再对局部 prompt rules 做单元级修订。

三者共同揭示一个根源：一次任务通过，不足以证明某个经验或规则造成了成功；任务失败也不说明全部过程无效。若模型在结尾自行总结“下次要这样做”，而没有定位导致结果的动作和适用情境，它可能把偶然相关当成原因并将错就错。该“credit assignment”是当前最可能统一解释“写了经验却不改变行为、抽象规则跨场景误用、agent 声称学会但无法复现”的工程研究切口。它不是 Noema 自己发现的新问题；Noema 的潜在贡献只能在把 attribution 机制嵌入持续专业身份和跨房间经验治理时成立。

适用范围需区分：AttriMem 是 2026 预印本，实验集中于长对话 QA 的 memory construction；TreeMem 是多 agent memory pipeline 的预印本；TRUCE 已发表于 ICML 2026，但优化目标是角色/协作结构固定的多 agent prompt rules。它们解决的是不同层级的归因，不等于已经解决用户感受、agent 个性或长期专业成长。[AttriMem](https://arxiv.org/abs/2607.21106) · [TreeMem](https://arxiv.org/abs/2605.04811) · [TRUCE, ICML 2026](https://proceedings.mlr.press/v306/wu26bp.html)

### Case-based reasoning：保留个案并适配，可能比立刻抽象成通则更合适

近期 CASCADE 将部署期学习形式化为 case-based contextual bandit：在新任务里选择过去案例，复用并修订，再根据任务反馈决定保留；它把“怎样取用经验”也当成一个可由结果调整的策略，并只保留成功的新案例。论文覆盖 16 类任务，包含多轮环境/工具任务，但反馈被简化成标量成功/失败。另一篇 real-world case-based learning 预印本把具体案例转为可跨任务重用的知识资产。它们都说明“成功案例的类比、适配、结果修订”不是 Noema 独创，但为“先留下带来源的个案，后归纳通用手艺”提供了成熟认知框架。

这条路径的关键风险仍是检索与适配：模型可能把表面相似误认成专业相关；只保留成功案例也可能使失败边界消失，且从零失败的场景很难靠在线反馈建立经验。CASCADE 作者自己把“只从成功案例学习、忽略失败信息”列作未来工作，并指出长时域内的案例库增长与遗忘仍未解决。它虽讨论人类参与修订，却模拟的仍是 ground-truth 标签，不等于用户与 agent 的自然协商。医疗/代码等有相对清楚的任务完成条件，新闻价值判断、用户偏好和聊天节奏却没有同等统一的 verifier。两篇目前均为 arXiv 预印本，报告的 benchmark 增益不证明个人长期 agent 已解决主观价值判断。[CASCADE](https://arxiv.org/abs/2605.06702) · [Transferable Expertise via Case-Based Learning](https://arxiv.org/abs/2604.12717)

### PAST-Bench：分数上升不够，还要证明是经历造成的

PAST-Bench 是 2026 年 8 月的 arXiv 预印本，针对 personal agents 设计 26 个场景、204 个有序 episode，跨新会话比较 persistence on/off，并同时检查持久产物和运行时证据，区分任务分数、机制证据和归因。研究报告整体进步存在但因能力、模型而异；不同系统即便最终增益类似，实际是否走过预期的保存、检索、更新路径也可能不同。部分程序复用条件出现负增益。其 LLM judge 与人工在 48 个盲样本上的一致性有用但并非完美，论文也明确机制证据不是因果证明。

它的核心方法论适用于 Noema：不能只看“记忆命中了”或“用户感觉像成长”，而要区分保存、实际调用、行为变化和后续结果；不过它仍是受控的任务族 benchmark，不能直接测主观关系质量。[PAST-Bench 论文](https://arxiv.org/abs/2608.04003) · [benchmark 源码](https://github.com/Gen-Verse/PAST-Bench)

### EvoMemBench 与跨任务经验复用研究：不存在普适的“最佳记忆”

EvoMemBench 以“同一 episode 内/跨 episode”和“知识/执行”两个轴比较 15 种方法。2026 年 arXiv 预印本的结论是：长上下文基线仍很强，显式记忆更常在上下文不足、任务困难时有帮助；没有单一记忆形式能在所有设置获胜。另一篇在 ALFWorld 与 BabyAI 上做的受控预印本发现，抽象程序经验更利于正向迁移，但硬任务更容易遭遇负迁移；更细的记忆组织可能提升前向迁移，同时造成遗忘。作者特别说明只测了两个环境、每个任务对每种条件两次运行，结论需更广评估。

这些研究支持按用途和场景选择经验表示，而不是把某种统一记忆格式当作人类记忆的仿真。[EvoMemBench](https://arxiv.org/abs/2605.18421) · [经验复用研究](https://arxiv.org/abs/2604.27003)

## 综合判断

现在较强的共识不是“agent 应该存更多”或“每次都总结成 skill”，而是：**从经历到未来行为之间存在一个尚未稳定解决的迁移问题。**

为避免把这些不同问题揉成一个“memory system”，当前最有用的概念切分是三个独立判断：①**可否读取**此来源/房间（权限与信任）；②读取后**该怎样影响当前回答**（忽略、有限支持、主导）；③本次结果是否有足够的 credit/transfer evidence，值得**改变好友以后的专业实践**。它们分别由 MemArena、MemCalib/RPEval、SkillLens、PAST-Bench 与 CASCADE 等研究部分触及；没有一个可直接替代另外两个。这里是对现有证据的综合假设，不是最终的数据表或三套独立子系统。

1. **经历本身不等于经验。** 一次成功或失败的轨迹，可能同时含有相关动作、偶然细节、工具噪声和错误自我解释。写入、提炼和未来调用是三段不同的工作，任何一段都可能失败。事件来源/权限分类要先于“重要度”打分；高频系统通知不能因此变成用户或好友的经历。
2. **文本说服力不等于行为效用。** SkillLens 发现，看起来清楚、完整、合理的 skill 未必能提高目标 agent 的真实表现；提示词式的自评尤其可能被流畅表达误导。至少要保留“下次具体改变哪一步”和“这条经验适用于什么情况”。
3. **学习要学边界，而不仅是动作。** 具体失败机理、步骤级补救和高风险反例，通常比泛化口号更能指导行为；但跨环境/跨目标的负迁移又说明“适用范围”本身必须是经验的一部分。专业手艺的一部分，是知道何时旧方法不适用。
4. **行为变化比档案增长更重要，归因又比变化更难。** OpenClaw 用未来召回/多日复现作为晋升信号，适合筛掉一次性信息；程序经验还须看它是否改变动作、目标结果是否变好及是否带来负迁移。PAST-Bench 的分解有价值：经历已保存、被取回、影响了动作、结果变好，是不同证据状态。哪怕四者同时出现，也不能单凭一次结果证明因果。
5. **现有项目证明了一些局部闭环，不证明个人 agent 的成长已经解决。** Voyager 有环境 verifier，Hermes 有 agent 写 skill 的生命周期，MUSE 与 SkillLens/PAST-Bench 有任务结果或机制评估；OpenClaw/Hermes 已证明同一身份与多会话/隐私隔离可并存。在本轮查阅的来源里，尚没有一个完整解法同时覆盖：专业好友跨私聊/Noema/群聊连续存在、按授权调取别的房间经历而不合并 transcript、经验跨房间转成有边界的专业实践、负迁移可被发现并撤回、用户能理解成长来自何处。

因此，社交聊天界面、agent roster、私聊/群聊、多个 profile/agentId 本身都不能作为 Noema 的差异化论据；OpenClaw 已有 agent roster/聊天入口、各 agent 独立 session 与可选择的会话范围。若现成 stack 能低成本组合出用户要的好友体验，Noema 单独成为 app 的理由仍可能不成立。未来方案必须把重心放在能否把专业实践成长与用户可感知的连续关系整合好，而不是重新实现这些已有组件。

## 当前候选观点：让“实践修订”成为成长单位

**助手提出的研究假设（不是用户最终确认或实现决策）：好友的成长单位不应是“新增一条 memory/skill”，而应是一次有证据的专业实践修订。**一次经历先是一条带原始来源的 episode；在推广成稳定方法之前，先要判断哪些动作/判断与结果有足够证据关联（credit assignment），并说明触发条件、机理、具体行为改变、适用与不适用边界。若现有证据不能识别“什么起了作用”，它仍是个案，不应包装为已学会的通用方法。之后在不同但相关的场景中复用，观察正迁移、负迁移和不该触发的场景，再决定保留、收窄或撤回。成功案例不能只看“最终任务成功”——需要机制解释来排除偶然；失败案例不能只看“任务失败”——需要可追踪的失败原因才可写成反例。失败轨迹本身并不自动等于一条有效反向规则。

更具体的候选循环是：**事件先留为可追溯案例；一条可能的做法先以候选方式影响下一次相似工作；只有未来复用确实改善结果、且没有明显负迁移，才提升为好友的稳定专业实践。**这会把“反思这次发生了什么”与“此经验真的改变未来表现了吗”拆开；一次任务通常只能产生证据，不足以证明已经学会。它不同于单纯的 post-task skill generation，但与 case-based learning、OpenClaw 的重复使用晋升信号和 SkillEvolBench 的 frozen transfer evaluation 有直接谱系关系，因此还不能自称新范式。用户明确纠正不应等待任务 verifier 才生效，但它的适用范围必须按用户原意限定；模型对用户或专业工作的推断则不能享有同等权威。

这项假设必须与“直接检索当时那间房里的原始经历”分开：如果用户问工作群里哪位同事提出了某个方案，合适的回答可能只是有权限地回看原群聊事件并带来源，不必把这段话变成 agent 的长期经验。若用户指出“你常把二手消息当一手来源”，才可能提出一项跨研究场景的实践修订。这里还须区分用户明确纠正和模型自行推断：明确纠正可以按用户说明的范围立即改变行为，不必等 benchmark 证明用户自己的偏好；模型推断则应保持候选，靠后续适用场景、用户反馈和可观察结果累积证据，不能单次自我反思直接晋升。事件检索解决“发生过什么”，实践修订解决“未来什么情境下怎么做”；一个连续 agent 可以同时拥有二者，而不混成一份全局聊天记录。

这不是鼓励把每个经验做成复杂记忆对象，也不是要求每轮都跑验证模型。它把“经验流”和“当前生效的实践”分开：完整聊天仍属于各自房间；跨房间共享的是被验证/用户明确采纳的实践变化，而不是整段 transcript。对客观结果可检查的工作，可用环境/验收证据；对对话风格等缺少独立 verifier 的软经验，只能依赖用户明确纠正、来源标注及后续谨慎观察，不能宣称客观验证或自动永久改变。

潜在价值：这能将事件历史变成可演化、可回退的专业判断，而不是一个更大的“记忆文档”或“skill 文件”目录。潜在风险：它仍可能变成传统规则工程；真实世界跨场景证据可能昂贵，严格提升门槛会让 agent 始终不成长；在主观体验领域难以定义无争议的成功准则。它必须通过研究与具体场景继续挑战，暂不立为产品架构决定。

## 架构审查结论（2026-10-18）

- **用户问题可识别，但单独应用价值仍未证明：**用户希望同一专业好友能在 Noema 私聊、专业工作与群聊中保持连续性，不要每换任务就变成新的提示词角色。这是用户明确的设计方向；是否必须由新独立应用承担，仍须和 OpenClaw/Hermes 加现成插件组合比较。
- **Noema 若必须拥有的候选责任：**它不能只做外部 agent 的路由器，而要持有用户可控制的好友身份及其有出处的专业实践演化，兼顾房间上下文与权限边界。若这层仅是挂载 `SOUL.md`、skills 和 memory 文件的 UI 包装，就过不了 standalone-app test。
- **当前不应新增系统子模块或 ADR：**外部项目已经分别实现 agent roster、多 session、skill 写入、记忆晋升与 task verifier；尚未证明它们的简单组合不能满足需求。当前文档只记录概念分界和假设，未决定事件表、记忆数据库、后台 scheduler 或自动提升机制。
- **尚缺的关键证据：**跨房间读取权限如何被系统而非模型口头判断所约束；专业经验归因和迁移如何被观察；对话关系/用户口味的变化缺少统一外部 verifier；以及 Noema 相比现成组合能降低哪项真实日常负担。

因此“把专业实践修订做成成长单位”目前只能作为候选，不符合接受为最终架构的标准。下一阶段应继续核对真实源代码、维护者的修复/回滚轨迹和负迁移案例，再判断是否存在足够的 Noema-owned responsibility。

## 研究边界与下一步

当前证据集中于有限 benchmark 和工程工作流；它们不证明“人性/陪伴感”由技能迁移充分解释，也没有解决 agent 对另一个房间经历的可见性、信任和共同记忆规则。下一轮应继续检查：

1. 真实 personal-agent 仓库的代码与 issue/PR 演变：它们如何决定写入、审核、去重、适用性、过期、回滚，用户实际遇到什么失效。
2. “实践修订”与现有 skill versioning/evolution/verification 方案的差别；如果没有实质差别，就不应包装成 Noema 创新。
3. 经验迁移的负例、旧偏好更新及用户纠正冲突；检验“专业实践”如何避免把一次任务或一次误解永久沉淀。
4. 对话型/关系型 agent 的多房间连续性是否有可复用实现或实证评估，而不只是在生产力 benchmark 上测试复用。

在这些工作完成前，不新增自动自我总结、自动 skill 提升或共享记忆功能；既有原型作为反例和可复用部件保留比较，不作为未来路线的既定基础。
