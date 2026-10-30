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
