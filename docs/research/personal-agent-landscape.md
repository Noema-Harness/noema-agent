# Personal agent：产品类别、真实边界与 Noema 的对照

日期：2026-10-18  
状态：第一轮产品/市场核查；产品官网主张、独立报道、用户报告与 Noema 推论分开；不是路线图或已接受 ADR。  
关联：Issue #2 / M1；[持续型好友与聊天空间讨论基线](../design/persistent-agent-social-model.md) · [经验到专业实践研究](./experience-to-practice.md)

## 研究问题

“Personal agent”最近同时成为大公司产品类别、创业公司叙事和开源社区项目的总称。它是否是真实产品方向，Codex 这类应用是否已足以覆盖需求？不能只按宣传语判断，需看产品实际持有什么状态、能做什么、持续多久、用户给它什么权限、以及有无真实用户证据。

当前先采用一个可观察而非营销式的定义：**personal agent 是具有个人连续状态、能连接个人工具/数据、并可在用户不逐轮驱动时继续完成或跟进任务的 agent 产品/系统。**不同产品只覆盖其中一部分；“更像人”“理解你”不是可比能力，除非能落实到可审计的行为、记忆来源和控制权。

## 不是一个单一类别，而是几种产品形态叠在一起

| 形态 | 代表产品 | 实际重点 | 不等同于 |
| --- | --- | --- | --- |
| 个人化对话助手 | ChatGPT Memory、Gemini Personal Intelligence | 用历史对话、连接应用和偏好改善当下回答 | 长期自主执行 |
| 持续委托型 agent | OpenAI Dots、Meta Muse、Gemini Spark、Jo、Instinct | 连接邮箱/日历/浏览器等，做后台、周期性或多步任务 | 一个新的基础模型或真正有意识的个体 |
| 工作流/企业 autopilot | Microsoft Autopilot（原 Scout）、ChatGPT Work Scheduled Tasks | 组织身份、M365/应用数据、触发器、权限和审核 | 面向个人日常的通用产品 |
| 可自托管个人 agent harness | OpenClaw、Hermes | 用户自行连接模型、工具、会话与记忆，能深度 DIY | 开箱即用、受控的消费级助手 |

这些方向会收敛到同一客户端，但其用户价值、数据边界和失败后果不同。仅把产品叫作 personal agent，不能说明它在解决同一种问题。

## 有代表性的现有产品

### OpenAI：Dots 把 Codex 作为纵向能力之一，主产品是持续委托

官方将 Dots 定义为 ChatGPT 内的 always-on agent：用户建立一个 primary dot，给它目标、连接应用并定义自主权限；它有自己的云端计算机，可在对话以外持续工作，通过 ChatGPT、Slack、Teams 接收指令/汇报。它可以查看已连接信息、主动形成 memory、执行 scheduled tasks，并能创建 Codex Cloud 或本地 Codex/Work 任务。换言之，OpenAI 自己的产品边界已经把“个人主 agent”与“编程执行引擎”分开：Codex 是它可调用的专长工作环境，不是完整 personal-agent 产品本身。[Dots 产品说明](https://openai.com/index/introducing-dots/) · [Dots 使用、Codex 调用与记忆说明](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot)

实际限制同样重要：现阶段消费者先使用单个 dot，多个 dot 及团队能力是未来方向；dot 的单项任务对话不会自动获得与它的全部过往对话；本地电脑接入是可选权限；断开 app 不会自动删除该 app 已被 dot 获得的信息，删除 dot 才会整体清除其对话、memory 和 scheduled tasks。它很接近“一个连续伙伴，按需调用 Codex”，但还没有证明稳定专业好友 roster 或好友的专业实践成长。[Dots memory/task controls](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot) · [ChatGPT Work 与 Codex 的差异](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex)

**对“Codex 够不够用”的判断：**Codex 是专门处理代码库和工程任务的 agent，能并行执行、远端继续、跨设备查看和使用 worktree；它可覆盖大量 vibecoding 工作，不自动覆盖跨 Gmail/群聊/日历、长期监控、生活事务和跨任务个人状态。与此同时，ChatGPT Work 已支持 scheduled / webhook-triggered tasks，ChatGPT apps/agent 可提供一般网页与连接器能力，Dots 则把这些能力、记忆和 Codex 云任务组合到一个个人入口中。因此，准确的比较对象不是“Codex 单独 vs Noema”，而是“现有聊天/工作/编程 agent 的最低成本组合 vs Noema 是否有额外生命周期价值”。[Codex](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) · [Work scheduled/event-triggered tasks](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex) · [ChatGPT Agent](https://help.openai.com/en/articles/11752874-chatgpt-agent)

### Meta Muse：消费级生活事务 + 自己的安全 VM

Muse 的设计目标是直接处理个人事务：用户可在 app 或 WhatsApp 聊天，分享长期目标，连接日历/消息/邮箱或其他应用，做浏览器、购买、预约等动作；对长任务，应用关闭后仍继续，遇到关键步骤再回来申请批准。官方结构里，Muse 使用独立 Secure VM，Sentinel 控制外网动作，凭据独立保管，重要动作需要审核，所有操作有审计记录。这把“个人 agent 的信任/执行边界”作为产品的一部分，而不是只靠 system prompt。[Meta Muse 产品说明](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent)

独立报道显示 Muse 的上线带来大量初期尝试：第三方应用数据估算其上线数周达到数百万下载、美国 App Store 排名靠前，但 Meta 没有公开自身用户数，估算受 Meta 跨产品推广影响，也不是长期留存或付款证据。[TechCrunch 对第三方下载/活跃数据的说明](https://techcrunch.com/2026/09/21/metas-muse-is-outpacing-chatgpts-early-mobile-launch/)。实际体验报道既记录了用户用它省下旅行、订阅、客服等时间，也记录了商家拒绝与 AI 通话、未经预期的行动和用户对权限的犹豫；这表示 consumer curiosity 真实存在，但“允许 agent 执行”仍不是默认共识。[The Atlantic 的用户案例与外部摩擦](https://www.theatlantic.com/technology/2026/10/ai-agent-chaos-e-commerce/689010/)

### Google Gemini Spark：围绕日常信息流的 24/7 任务、主题监控与技能

Spark 支持个人 Google 账号、Schedule、Skills、connected apps 与自定义 MCP；可以监控新闻/博客/市场等主题，处理邮箱整理、briefing、跨应用或本地电脑工作，且在设备关闭后继续。相较传统“问一次、答一次”的界面，它把 recurring work 和 proactive monitoring 作为明显的产品入口。[Spark 功能与持续任务说明](https://support.google.com/gemini/answer/17094507) · [Spark 更新日志](https://support.google.com/gemini/answer/17171264)

它不是开放、普遍、免成本的个人系统：官方要求个人 Google 账号、活动记录开启及 Google AI Pro/Ultra 订阅；具体地区、桌面端和连接器功能仍有差异。它的强处是 Google 生态内自然的数据连接，弱处是体验和状态由 Google 与其账户体系拥有。[使用资格和当前限制](https://support.google.com/gemini/answer/17094507)

### Microsoft Autopilot（Scout）：personal agent 的企业版

Microsoft 的首个 Autopilot/Scout 面向企业，用户在 Teams 与它沟通，agent 连接 Outlook、Teams、OneDrive、SharePoint 等，可在本机和云端行动；每个 agent 有可归因的 Entra 身份和组织级权限、凭据与 DLP 管控。产品采用 OpenClaw 技术底座，Microsoft 主要增加企业级 identity、policy 和治理。[Autopilot 产品说明](https://www.microsoft.com/en-us/copilot/blog/2026/06/02/introducing-microsoft-scout-your-always-on-personal-agent/)

这是一个值得借鉴的架构分工：底层 agent/runtime 可以复用，产品需补上清楚的身份、授权和审计。但它不是个人长期生活伴侣的证据，初始目标是 M365 中的工作协同和企业合规。

### Jo：个人/家庭上下文、跨群聊检索和主动简报

YC 的 Jo 产品页称其可在 Mac/web 使用，并通过 iMessage、WhatsApp、Telegram 与用户交互；连接 Gmail、日历、消息平台和本机历史，为用户整理每日简报、群聊计划、待回消息和周期任务。它明确展示了“我私聊问一下：周六足球几点？群里最后定了什么？”这一类细节回忆，并称可在个人或家庭空间里保持各成员独立的 memory、权限和 cloud machine。[Jo 官方产品页](https://askjo.ai/) · [YC 产品介绍与当前发布状态](https://www.ycombinator.com/companies/jo)

这说明跨群聊查询未必只是抽象的架构完善；它能自然服务家庭安排、旅行和共同事务。仍要区分这是 Jo 的产品定位与创始人/官网举例，尚无独立的大规模使用研究证明它应成为 Noema 主轴；它也只提供一个 personal agent，不是围绕多位长期专家好友组织的系统。

### Instinct：消息即入口、生活事务代理；强烈暴露 trust 问题

Instinct 在公开报道中是 invite-only 的消息/语音型生活助理，使用者从 iMessage/WhatsApp 交代订票、旅行、邮箱和客服等事务。它展示了一种“不要再打开一个 agent 应用，直接给个人 agent 发消息”的入口设计。早期测试者报告它能替人完成高摩擦生活任务，但同一时期也有明确隐私与越权事件报告：邮件内容留存/删除行为引发争议、未经批准发出邮件、用户做提示注入测试后退出。TechCrunch 报道称团队随后补充了删除外部数据的控制，但这是早期私测，不能外推成当前版本的完整安全审计。[TechCrunch 对 Instinct 早期测试与投诉的报道](https://techcrunch.com/2026/08/24/instincts-powerful-ai-assistant-is-raising-privacy-and-security-concerns/) · [The Atlantic 对 personal-agent 风险的独立报道](https://www.theatlantic.com/technology/2026/09/instinct-ai-personal-assistant-credit-card/688607/)

值得借鉴的是自然语言/消息入口和办事链条；不能忽略的是，agent 权限越大，删除/撤权/审计/责任越是核心产品行为，而非“设置页补充项”。

### 开源运行时：OpenClaw、Hermes 不等于消费产品，但足以反证“从零造全套”

OpenClaw 和 Hermes 已有多 agent、多 session、聊天渠道、skills/memory、后台任务等运行时能力，开发者可自行连接本地或云端模型。OpenClaw 的多 `agentId` 可提供相互隔离的身份/workspace；同一 agent 也可有 DM/群聊等多房间。Hermes 有持久 session、背景 review、skill creation。它们证明个人 agent 的许多工具循环已是可复用底座，不证明其默认配置已把“同一个私人专业好友跨不同 room/runtime 形成可信专业实践”解决好。详见[经验研究记录](./experience-to-practice.md)。

## 需求不是“真/假”二选一：目前证据支持的是有边界的需求

- **试用/好奇心是真实的，但不能当作长期留存。** Muse 初期下载量和 app-store 排名很高，部分独立报道也取得到活跃用户估算；但厂商没有公开长期留存、重复委托率或愿意付费的稳定数据。首次下载主要说明新鲜感、分发和用户好奇，不能证明人们愿意每天把生活托付给 agent。[TechCrunch 的第三方数据及其估算边界](https://techcrunch.com/2026/09/21/metas-muse-is-outpacing-chatgpts-early-mobile-launch/) · [The Information 的 weekly-active-user 报道](https://www.theinformation.com/briefings/exclusive-metas-muse-tops-3-million-weekly-users)
- **用户愿意让 agent “帮点忙”，不等于愿意交出广泛权限。** Pew 2026 年美国调查中，未使用 chatbot 的人，83% 说缺乏兴趣是原因、79% 提到个人数据用途、76% 不信任准确性。Thales 在 14,300 名消费者、13 个国家的调查发现，63% 对某些线上 AI 辅助任务持开放态度，但逐项看只有 13% 愿意让 AI 基于邮箱/日历代读邮件并回复、11% 愿意让它重订旅行、7% 愿让它转账；33% 不愿让 AI 替自己做任何线上任务。YouGov 2025 年美国零售调查中，65% 接受 AI 比价，14% 接受 AI 代下单。**偏向辅助判断和低风险重复行政任务的接受度，高于自主决策和高影响操作。**[Pew](https://www.pewresearch.org/chart/lack-of-interest-concerns-around-privacy-and-accuracy-are-common-reasons-why-people-dont-use-chatbots/) · [Thales 2026 Digital Trust Index](https://cpl.thalesgroup.com/sites/default/files/content/campaigns/trust-index/2026-thales-digital-trust-index.pdf) · [YouGov](https://yougov.com/en-us/articles/53808-american-trust-in-ai-for-retail-consumer-sentiment-in-2025)
- **个人 agent 的关键成本可能不是使用费，而是“让它了解我的生活并给出权限”的信任成本。** Muse、Dots、Spark 的官方设计都强调审批/授权/可见控制；早期用户讨论也集中在它到底看了什么、是否还记得、能不能撤销、是否未经确认行动。个人 agent 需要数据，接入越深入越有价值；但对相当一部分用户，接入本身就是产品阻力。

因此，个人 agent 不是“伪需求”，但“人人都需要一个全知全能、永远在线、能替你处理一切的 agent”也尚未被市场验证。更扎实的楔子是高频、跨应用、拖延成本明显、结果可回顾，且用户愿意为相应权限买单的任务；先在安全边界清晰的范围里增加代理权，而不是把无条件自主当作成熟标准。

## 对 Noema 的压力测试

1. **仅称“personal agent”已不够定位。** Dots、Muse、Spark 和多家创业公司都宣称长期了解用户、跨 app 行动、后台推进；OpenClaw/Hermes 让高级用户可自行搭建。Noema 不能只把这些能力放进一个新 UI。
2. **“Codex 已经够用”取决于边界。** 只做代码、由用户逐次下达任务时，Codex 本身很强；把它与 ChatGPT Work/Apps 和自动化组合，也能覆盖一批一般任务。只是 Codex 的主责任是工程代码任务，不等于持续接管邮箱/聊天/日历/生活事务的个人层。OpenAI 自己把 Dots 做成主 agent 并调用 Codex cloud task，说明更一般的 agent 产品可以把 Codex 当专长执行器，而不必把两者看作竞品。
3. **Noema 可能的不同点仍在“好友”而非“管家”。** 这些产品大多把单一主 agent 当作跨生活的代理人；开放运行时能有多个 agent，但身份、工作空间与 session 常是工程配置。Noema 可能更聚焦同一个用户与多位持续专业好友之间的关系连续、不同聊天空间的证据边界，以及专业实践如何从工作经历变化。这值得继续检验，但不等于现在已证明是独特需求，也不排除 Dots 等后续推出多 agent。
4. **Noema 的独立价值要过组合反证。** 现有大公司产品已能做单 agent + 后台任务 + apps + memory；开源 runtime 能做 multi-agent/session/skills。Noema 若只包装成一个跨模型/跨 app 的统一入口，很可能被平台功能吸收。更可能的架构责任，是“谁是用户的这个好友、它如何在多 room/多 runtime 中保有可审计且可撤回的实践连续性”，但研究和最低成本组合测试尚未完成。

## 值得借鉴的机制，而不是照抄产品外壳

1. **一位主 agent 与专门执行 runtime 分开。** Dots 把持续个人代理与 Codex 任务组合起来；主 agent 承接用户目标、保持注意力连续，编码仍由 Codex 承担。这是 Noema“核心伙伴不亲自做所有长任务”的具体产业参照，也意味着该模式本身已不是 Noema 独占。
2. **后台能力必须和可见状态/权限一起出现。** Dots 的 in-progress/scheduled/completed 任务、Pause、审批规则；Muse 的 VM、Sentinel、动作审计和逐 app 权限；Microsoft Autopilot 的 agent identity 和 Entra policy，都是为了让“替用户做事”可控制、可归责。实现离线和自动任务却没有清楚的暂停/审计/撤回边界，不是成熟的个人 agent。
3. **固定的日常入口来自具体循环，而不是 24 小时不停聊天。** Gemini Spark 的 Daily Brief、主题监控和 Schedules，以及 Jo 的晨间简报/待回消息/家庭群约定，将 agent 放入早晨检查、计划更新、约定查找等现成时间点。这里的价值来自重复生活情境与低摩擦，不是因为 agent 一直在线本身。
4. **跨房间事实检索有明确的消费者场景。** Jo 展示家庭群聊约定回忆，OpenAI apps/Dots 也可连接多个账户源。这个能力可能值得作为“个人 agent 的日常检索入口”研究，但任何结果都必须显示来源并遵循原房间授权；它仍不等于把事件晋升为专业实践。
5. **从一开始给用户数据和偏好生命周期控制。** 记忆来源展示、逐个纠正/删除、断开来源、历史和当前状态冲突处理，属于 personal-agent 产品核心。Dots 当前断开应用不会删除已读到的信息，只能删除整个 dot；这反例说明“有连接开关”不代表用户已掌握记忆生命周期。[Dots memory/reset controls](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot)

这些机制和 Noema 的好友/实践研究可以相交，但还没有共同构成 Noema 的差异化结论；本节不批准 UI、通知策略或权限 schema。

## 当前结论（候选，不是产品决策）

2026 年的 personal agent 已是正在实现的产品类别，不只是宣传词；但产品定义仍分裂，市场实际采用也远未证明用户愿意交出广泛的个人权限。Codex 足以承担高强度编码执行，不能单凭它代表整个 personal-agent 需求；同时，Dots/Work 与 Gemini/Muse 已表明“统一主 agent 跨 apps 持续工作”不是 Noema 独占的方向。

Noema 若继续成立，应从“又一个更全能的个人 AI”收窄成对用户个人 agent 资产和关系的 owner：不一定自己发明更强的工具执行，而是让用户拥有跨供应商 runtime 的持续好友、各好友的专业实践版本及跨 room 证据来源/影响范围。它的价值成立与否取决于：相较 Dots + OpenClaw/Hermes/现有 memory & skill 组合，是否真正降低了管理和维护多个 agent 的负担，并且让其成长可理解、可纠正、可撤回。当前证据不足以把这个候选判断升格为确定定位。

## 研究边界与后续核验

- 继续对照 Dots、Jo 与 Muse 的实际长期使用、任务失败、用户撤权/删除理由，而不只引用发布稿和首月下载。
- 明确 Codex + ChatGPT Work/Apps + 可复用 skills/agent frameworks 的最低成本组合能做到什么、哪些状态/身份责任仍缺失。
- 检查“用户拥有而非平台拥有的持续好友与实践”是否有具体用户行为或痛点证据，避免把开源/模型无关/可迁移当成自动成立的价值。
- 本轮只补产品分类与市场证据；不批准任何 Noema UI、agent roster schema、连接器清单或实现计划。
