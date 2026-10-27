# ADR 0037：按需网页来源发现

- 日期：2026-10-27
- 状态：首个提供方已实现；未配置真实密钥，线上搜索链路尚未实测
- 关联：#112、ADR 0036、ADR 0005

## 问题

用户询问近期事实或明确要求找来源时，单独的 URL 阅读器不知道去哪里找材料。无来源能力时，Noema 可能把模型已有知识误作当前查证结果。

## 决定

1. 首个提供方使用 Tavily Search 的基础搜索端点；不使用其生成式 Answers 接口。适配器保持为一个窄函数，不引入搜索框架、多提供方路由或缓存层。若未来出现更合适的来源，只替换这一边界。
2. 只有用户本轮表达近期/当前信息或明确找来源的意图，且用户已在设置中配置独立搜索密钥时，才向模型开放 `search_web`。不把普通生活交流中的“最近”误判为检索请求；搜索词必须是当前用户消息中的连续短语，不能补入历史对话或记忆中的信息。
3. 用户自行提供的搜索 API Key 单独加密存于本机凭据目录；密钥不会返回渲染进程的状态数据。配置搜索意味着同意将模型整理的最短搜索词发送到 Tavily；对话全文不发送给搜索服务。密钥可在连接设置中移除。
4. 每轮最多一次基础搜索，请求词限 500 字符、最多取 3 个 HTTPS 候选地址；不自动重试、不带生成答案或原始页面全文。对候选地址再使用 ADR 0036 的安全读取器。搜索结果只在当前工具响应中暂存；搜索候选不会写入聊天数据库。只有成功读取的网页正文快照才随助手答复保存。
5. 所有外部正文都是不可信资料。每个成功读取来源会获得本轮内的 `S1` 编号；模型可用 `[[S1]]` 标注依赖来源的具体事实，界面只将标记映射到系统实际读取的 URL，未知编号保留为普通文本。搜索候选不能引用。该链接只证明页面正文被读入本轮，不表示声明已得到该来源支持或完成独立事实核验。读不到候选时如实提示回答未基于这些网页内容。
6. API Key 由用户配置，Noema 不代办账户、付款或升级。额度、速率与费用取决于用户在服务商的账户方案；收到额度/频率限制时立即失败关闭，不做自动重试或购买。

## 依据与限制

- Tavily Search API 官方接口采用 `POST /search`，以 Bearer API Key 认证；单独返回排名结果，不必使用生成式 Answers。接口与参数见[官方搜索 API 说明](https://docs.tavily.com/documentation/api-reference/endpoint/search)及[官方搜索 API 概览](https://help.tavily.com/articles/4840311948-tavily-search-api)。
- Open WebUI 的当前 agentic search 设计把搜索结果作为候选而非可引用来源，只有实际通过 `fetch_url` 打开的页面才进入引用面板；其文档指出旧版搜索结果 ID 曾造成错配。这支持 Noema 只为已读页面分配引用 ID。Noema 用确定性的 `citationId → URL` 映射避免模型自行填写目标 URL，但仍不保证模型把事实正确归因到页面。[Open WebUI agentic search](https://github.com/open-webui/docs/blob/main/docs/features/chat-conversations/web-search/agentic-search.mdx)
- OpenAI Web Search 的 Responses 输出通过 `url_citation` 结构返回准确 URL/title 与文本起止位置，再由界面展示可点击引用；Noema 当前是 OpenAI-compatible Chat Completions 风格的流式工具循环，没有这份 annotation contract，因此只复用“引用应关联准确 URL 并在界面可点”的结果，不假装模型文本标记等价于 API 级证据对齐。[OpenAI Web Search citations](https://developers.openai.com/api/docs/guides/tools-web-search#output-and-citations)
- Tavily 官方定价页当前说明免费层每月 1,000 credits 且不需要信用卡；具体方案可能变化，应以账户页为准：[官方定价](https://www.tavily.com/pricing)。
- 提供方使用搜索词处理请求。设置明确展示该外发边界；不上传完整会话，也不把搜索服务的候选/摘要存档。服务条款和定价可能变化，重用该提供方前应重新核对。
- 这条能力增加一次模型工具续接、一次搜索 API 请求和最多三次网页读取。只在显式当前信息/找来源意图下启用；目前没有真实密钥，真实服务可用性与结果质量尚未确认。

## 重审条件

若设置体验、隐私条款、费用/限额或来源展示需要多提供方支持，先比较真实用户结果和退出成本，再决定是否扩展；不得因首个提供方上线就默认长期绑定。若无法在目标网络安全读取搜索候选，更新代理/来源边界而非绕过公开地址校验。
