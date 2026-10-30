# 研究来源与论文阅读路径

更新：2026-10-30

这份清单服务于 Noema 的“AI 味”长期研究。先从原始论文、官方实验记录和可检查的代码入手；新闻与社交平台用于发现线索，不用来替代研究原文。论文页内的数量、准确率和结论必须连同数据来源、比较对象和任务边界一起记录。

## 稳定的信息入口

| 来源 | 最适合发现/阅读什么 | 进入原文的办法 |
|---|---|---|
| [arXiv](https://arxiv.org/) | 新预印本、更新版本、相关领域新工作 | 先看 abstract 与版本日期；有 HTML 时用 `https://arxiv.org/html/<id>`，再查同作者论文与代码仓库。 |
| [ACL Anthology](https://aclanthology.org/) | NLP、对话、写作、语言特征与评测 | 页面提供摘要、引用和 PDF；检查会议年份/论文类型，PDF 交给本地提取工具。 |
| [OpenReview](https://openreview.net/) | ICLR/NeurIPS/ICML 等会议投稿、评审往返和补充材料 | 从 Forum 页面核对最终接受状态、作者回复、PDF 和附件；不要把评审中的稿件说成已发表共识。 |
| [PubMed Central](https://pmc.ncbi.nlm.nih.gov/) / [Europe PMC](https://europepmc.org/) | 生物、心理、社会科学及跨学科开放全文 | 优先使用 JATS/HTML 全文；按标题层级和图表读取，PDF 只用于视觉核对。 |
| 出版方页面（Nature、PNAS、ACM、Cell Press 等） | 正式出版版本、补充材料、源数据和同行评审信息 | 先用 DOI 定位正式版本；若全文开放，直接使用出版方 HTML、附录和 source data。 |
| [Crossref](https://search.crossref.org/) / [OpenAlex](https://openalex.org/) | DOI、作者、出版状态与开放获取版本的发现 | 用元数据确认标题、作者、年份、venue、DOI；再转到论文或作者公开仓库读全文。 |
| 官方研究博客与模型公司研究页 | 模型公司公开的训练、产品、评估与故障复盘 | 把公司自己的结论和研究数据分开；记录模型版本、发布日期、任务及有无可下载材料。 |
| GitHub / Hugging Face | 运行脚本、评测配置、数据卡、模型卡、issue 和复现线索 | 只把实际检查到的代码行为写成事实；README 的宣传描述不等于实验已经如此运行。 |

## 本地阅读

1. 先找论文的 HTML 或 JATS 版本。它们通常保留标题、链接和表格结构，适合直接检索。
2. PDF 全文需要进入本地笔记时，使用仓库现有的 [`scripts/research/pdf_to_markdown.py`](../../scripts/research/pdf_to_markdown.py)。它基于 PyMuPDF，按页输出 Markdown、保留页码与 SHA-256，并且默认拒绝覆盖已有文件：

   ```powershell
   python -m pip install PyMuPDF
   python scripts/research/pdf_to_markdown.py "C:\path\paper.pdf" -o "$env:TEMP\paper.md"
   ```

3. 转换后核对标题、页数、摘要、方法、结果和局限所在页。图表、公式、脚注及双栏顺序要回到 PDF 抽查。Markdown 是快速检索副本，不是权威版本。

4. MarkItDown 适合长篇办公文档和结构化附件；在 2025 CCL 双栏论文试跑中，其 PDF 输出产生了字符错序和列混排，故本研究不把它作为论文 PDF 的默认转换器。仓库现有 PyMuPDF 脚本提供更可读的逐页文本；数字与图表仍回原 PDF 核对，不再另建一条相同转换路径。
5. 阅读时只把当前问题需要的段落和页码带入上下文；不要把一整本论文转成更长的 Markdown 后再全文塞入对话。

## 每篇材料留什么

只记录能改变判断的内容：研究实际想回答什么；样本/模型/任务从哪来；主要比较和测量是什么；最重要的结果；作者承认的范围；公开代码或源数据能否核对；这项工作给 Noema 带来哪条可试的产品判断。对于 AI 味研究，还要明确它测的是来源识别、文字风格、判断行为、用户结果、持久状态、群体趋同或系统执行中的哪一层。

## 本轮加入：关系支持与实际结果

- [Effectiveness of AI and rule-based conversational agents for depression, anxiety and stress](https://www.nature.com/articles/s41746-026-02820-1)：广义 RCT 元分析。读摘要时同时看系统构成表：48 项研究中明确的生成式系统很少，因此它主要说明结构化对话干预，而非开放式 LLM 伙伴。
- [Generative AI Mental Health Chatbots as Therapeutic Tools](https://pmc.ncbi.nlm.nih.gov/articles/PMC12707440/)：生成式系统专项综述及元分析。需并读总体效应、各结局、预测区间、异质性和风险偏倚；正文对 14 项与 12 项的数量表述不一致。
- [People readily follow personal advice from AI but it does not improve their well-being](https://arxiv.org/abs/2511.15352)：单次个人建议对话的随访 RCT，主要用于区分“采纳建议”和“之后的福祉变化”。
- [JAMA Network Open：Kai 12 周情绪支持平台 RCT](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2847751)：将长期互动、日常练习、个性化与临床升级作为一整套系统评估；不能从组合干预的结果反推出某一组件是原因。
- [AI Companions Reduce Loneliness](https://doi.org/10.1093/jcr/ucaf040)：五项研究，把“当下孤独感下降”和“使用结束后的持久改善”分开；特别读 GPT‑4 陪伴/通用助理对比中的感知被听见测量，以及七日研究为何未见长久效果。
- [How Does Turning to AI for Companionship Predict Loneliness and Vice Versa?](https://journals.sagepub.com/doi/10.1177/09567976261427747)：2,149 人、四波十二个月的前瞻性追踪；对照“情感隔离”和“社会连接”两个不同构念。研究未预注册、日常社交用途稀少，结论是探索性纵向关联。
- [Living with AI Companions](https://arxiv.org/html/2609.07243)：Character.AI 用户一年两波跟踪；留存率 37.1%，对照作者的流失处理和仅两波的路径分析再阅读，不把关联写成因果。
- [OpenAI/MIT：Affective use of ChatGPT](https://openai.com/index/affective-use-study/) 与 [MIT 研究摘要](https://www.media.mit.edu/publications/how-ai-and-human-behaviors-shape-psychosocial-effects-of-chatbot-use-a-longitudinal-controlled-study/)：将约 4,000 万次对话的匿名自动分类与近千人四周随机试验结合；观察研究描述真实使用，随机实验测试指定模式，需分开看。
- [Interaction with AI Companions and Psychological Well-being](https://doi.org/10.1038/s41562-026-02516-2)：交叉读强迫单选用途、自述关系和捐赠聊天记录；注意 11.8% 与 80.3% 的分母不同（用户 vs. 会话），且聊天记录来自自愿捐赠者。使用[预印本 PDF](https://arxiv.org/pdf/2506.12605)核对完整方法，用[公开分析仓库](https://github.com/SALT-NLP/AI-companionship-well-being)确认会话分类路径及原始聊天为何不可下载。
- [The Collective Turing Test](https://www.nature.com/articles/s41598-026-62286-9)：真实 Reddit 多人讨论与 AI 替换文本的并排盲测。重点看 61% 识别率的任务构造，以及较强识别者提到的线索；注意 AI 对话固定了原文回复树/字数，开放回答仅分析准确率较高的 58 人，不能据此教模型照搬论坛脏话或戏剧性冲突。
- [AI-generated language remains systematically distinguishable from human communication](https://doi.org/10.1073/pnas.2531748123)：与上项研究对照；CHAT 同时测来源可辨性、语义相似、风格及话题差异，报告降低可检测度有时会牺牲语义忠实。避免把“读者认不出 AI”当成 Noema 的自然度或关系质量目标。

## 本轮加入：偏好代理、表达差异与奖励模型

- [Flattery, Fluff, and Fog](https://arxiv.org/abs/2506.05339)（ICLR 2026）：五种表面/行为特征的反事实偏好审计。全文与方法按 arXiv v3 核对；同时查 ICLR 正式页面。重点看人工与 reward/LLM evaluator 的偏好差距、训练语料中的共现，以及反事实数据增强结果。它只测英文单轮任务，不把它当真实陪伴对话的直接证据。
- [An Information-Theoretic Study of RLHF-Induced Uniformity](https://aclanthology.org/2026.conll-main.43/)（CoNLL 2026）：官方会议全文。细读模型家族、语料、surprisal 指标及跨文档方差；区分单篇文本均匀度、文本间分布收缩和人类偏好。它没有直接测读者偏好，且只含英文旧代模型。
- [One Bias After Another](https://proceedings.mlr.press/v306/fein26a.html)（ICML 2026）：正式论文页报告五种奖励模型偏差；对应[公开实验仓库](https://github.com/drfein/OneBiasAfterAnother)展示探针、配置、hidden-state 投影和准确性评估。代码方法是奖励模型的内部干预，不等于产品提示词可直接套用。

## 本轮加入：真实对话行为与可控多轮评测

- [How people ask Claude for personal guidance](https://www.anthropic.com/research/claude-personal-guidance)：从百万级真实对话定位个人建议，再用用户反馈中的迎合失败前史预填新模型，检验它能否在维持上下文连贯时修正立场。公开页面和[方法附录](https://www-cdn.anthropic.com/files/4zrzovbb/website/0a540acdf3e1678274f0fe04b3a70ea7fd99ed36.pdf)应配合阅读；真实前史不等于有代表性的样本，模型代际对比也无法归因于单项训练改动。
- [Disempowerment patterns in real-world AI usage](https://arxiv.org/abs/2601.19062)：Anthropic 对约 150 万段真实对话分析潜在现实判断、价值判断和行动影响，并对照当下评价与用户似乎已采取行动后的评价。它只从转录推测影响，不能确认因果；它的重要贡献是证明即时满意度和后续行动评价可能分离。
- [Petri / Inspect Petri](https://github.com/meridianlabs-ai/inspect_petri)：开源多轮审计实现。直接核对 [`auditor/agent.py`](https://github.com/meridianlabs-ai/inspect_petri/blob/main/src/inspect_petri/_auditor/agent.py)、[`auditor/tools.py`](https://github.com/meridianlabs-ai/inspect_petri/blob/main/src/inspect_petri/_auditor/tools.py)、[`judge.py`](https://github.com/meridianlabs-ai/inspect_petri/blob/main/src/inspect_petri/_judge/judge.py) 与 [`dimensions.py`](https://github.com/meridianlabs-ai/inspect_petri/blob/main/src/inspect_petri/_judge/dimensions.py)：审计者可交互、回滚和模拟工具；判分由另一个模型按可配置维度完成，提供完整转录、分支和消息引用。它适于探索触发路径，不是自然用户行为样本。
- [Bloom](https://alignment.anthropic.com/2025/bloom-auto-evals/)：围绕单一行为自动生成场景并批量测量。细读其[技术报告](https://alignment.anthropic.com/2025/bloom-auto-evals/)中的 seed 配置、场景多样性、评判重复采样和人工校准：Bloom 报告明确指出裁判模型会改变绝对得分，40 段手标校准中不同裁判与人工的一致性差别较大。同行评测时应保留行为定义和 seed，而非单独引用一个排名或数字。

检索与复核日期：2026-10-30。前面的陪伴研究用于校准“陪伴是否有效”的研究对象，结论不可直接移植到一般个人 agent。

## 本轮加入：真实交互体验与投诉后的恢复

- [UXBench: Benchmarking User Experience in AI Assistants (EMNLP 2026)](https://aclanthology.org/2026.emnlp-main.1683/) / [全文](https://arxiv.org/html/2606.09570) / [实现](https://github.com/mengze-hong/UXBench)：论文从腾讯元宝的 7 万多段交互中抽取反馈判断、失败请求续答、投诉恢复三类评测。投诉策略分布、不同模型的恢复率和 LLM judge 正向偏差值得留意；公开恢复分由其 GRM 判定。源码中 QA 失败/解析缺失会 fail-open 标成 keep，实际发布样本受影响的数量未知。仓库许可对数据、代码、协议和衍生物作严格的非商业研究限制；Noema 不复用这些资产或协议，只记录论文观察。

## 本轮加入：人机共创中的群体趋同

- [Does generative AI make us think alike?](https://doi.org/10.1080/0144929X.2026.2726451)（Behaviour & Information Technology, 2026）：作者按 Web of Science、ACM Digital Library、Google Scholar 前 200 项及 arXiv/PsyArXiv/SSRN/ProQuest 检索，再做前向与后向引文追踪；出版稿纳入 18 篇文章、19 项研究、61 个效应量，用三层元分析处理同研究的多重测量。总体趋同效应 d=.334；去掉一项影响较大的研究后 d=.247（95% CI [.065,.429]）。
- 任务差异比总效应更有产品含义：语义框架较强的 idea generation 平均 d=.70（5 项研究、14 个效应量），divergent thinking d=.12，写作 d=.27，视觉艺术/设计 d=.27；后三类置信区间跨零。研究报告任务间调节显著，但剩余异质性仍大。分类按任务/效应量，不应把四类研究数当成互斥样本计数。
- 对 Noema 的可用判断：单份答案更好，与用户群体获得的内容更相似，可以同时成立。此研究不测一件作品的“AI 味”、个人长期创作或界面审美；不能由此推出每次都要打散默认、随机化或强行制造独特。公开索引显示全文标注 CC BY，但作者门户 PDF 直链在本次抓取中被 Cloudflare 拦截，PDF 下载所得实际是验证页，故没有伪称已完成全文本地转换；以上数值由正式出版索引与作者所属大学的记录交叉核对。后续可取得全文时优先核对任务分组、单项高影响研究及真实情境子组。

## 本轮加入：灵感、共同创作与输入时机

- [How AI Ideas Affect the Creativity, Diversity, and Evolution of Human Ideas](https://arxiv.org/abs/2401.13481)（Ashkinaze et al., 2025，动态实验）：844 人、3,414 次回答，围绕五种物品的替代用途任务展开；前序回答构成连续想法池，每 20 次重置。高 AI 曝光提升的是群体想法差异及其随轮次变化的速度，未提升单条想法创造性。AI 在这里是供人参考的示例，参与者自己提交答案；这与直接让人和模型共同完成同一篇作品不是同一种干预。
- [Using Generative AI Personas Increases Collective Diversity in Human Ideation](https://arxiv.org/abs/2504.13868) 是 2025 预印本：10 种 persona 生成 300 个故事梗概，100 名参与者被分到无 AI、可取用 1 个梗概、可取用最多 5 个梗概三组；排除 3 名自报外用 AI 者后分析 97 篇故事。正文的相似度差异未显著。尽管标题说“增加”，实际结果只能支持“未观察到前一实验中的显著多样性下降”；不能将它当作已证实的解决方案。
- IJCAI 2025 [Creative Momentum Transfer](https://ijcai.org/proceedings/2025/1142) 在城市塑料污染方案任务中随机安排 GPT‑4 建议在第一轮或第二轮出现，并操纵是否标明 AI 来源（N=247）。早期建议提高最终专家评分，但回答与建议更接近；晚期建议在第二轮带来更明显的创造性跃升与方向转移。场景是两轮短时构思，不足以直接决定聊天默认行为；它值得我们把“模型何时先表态”视作研究变量。
- 2026 年 [Artificial intelligence and its impact on creativity and diversity](https://journals.sagepub.com/doi/10.1177/10591478261474243) 在大学生产品点子竞赛中发现，多个较新模型的单模型候选池仍不及人类多样；从四家模型混合抽样可接近人类池的多样性，温度也能提升多样性但可能牺牲质量。研究者自己提醒只研究一个产品创意竞赛，且没有让参与者实际经历 AI 协作过程。它更像低成本扩大候选覆盖的工程线索，不是个人 agent 对话设计的直接答案。
- 这几项对照把问题从“AI 会不会带来趋同”改成更具体的工作假设：**AI 的作用取决于它是先替用户定中心，还是给用户一个多来源、可选择、可改写的材料池；而且建议进入的时机也会改变用户是锚定还是转向。**先把它保留为设计判断，后续要用 Noema 的真实互动检验；不先把 persona、多模型投票或延迟建议做成产品功能。

## 本轮加入：像人、受欢迎与真正理解

- ACL 2026 [Is Human-Like Text Liked by Humans?](https://aclanthology.org/2026.acl-long.639/) 比较 9 种语言、16 个数据集和 11 个模型。19 名母语专家在约 9,000 个文本样本上的平均识别准确率为 87.6%；但五位中文、三位俄语、两位阿拉伯语等小组的偏好并不一致，文本来源辨认准确时更常选人类文本，辨认困难时机器文本常被选中。按识别差异改提示后，人工识别平均降到 72.5%；提示能改写一部分可见特征，文化细节和长度、结构、情绪变化仍难。该研究中的专家样本不是普通用户总体，若干文本集由单人标注；它最有价值的区别是“能识别”不等于“偏好”。
- Kleinberg 等人的[关系建议五项实验](https://pmc.ncbi.nlm.nih.gov/articles/PMC13635098/)分别操纵是否显得像人、是否使用同理表达，并检验 GPT‑4/GPT‑4o。模型可以在不增加同理表达的情况下提高人类感评分；语言分析发现它主要转向更非正式、口语化和常见词汇。反过来，显得同理也不必然提高人类感。它测短篇关系建议及读者判断，不等于长期互动里的理解能力，但能直接说明“看起来更有人味”与“确实接住了对方”不是同一指标。
- 与 [CHAT](https://doi.org/10.1073/pnas.2531748123) 的语义忠实—人类感取舍并读，当前可建立的工作区分是：**来源识别、读者偏好、表层人类感、同理感、语义贴合和互动中的真实理解是六件相关但不能互相代替的事。**产品评估需要看用户说了什么、模型据此做了什么，以及这件事的结果；只问“像不像人”或只优化盲测无法回答 Noema 是否令人愿意靠近。
