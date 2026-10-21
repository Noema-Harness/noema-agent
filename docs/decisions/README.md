# 决策记录

此目录只记录影响多个模块或长期数据/权限边界的决定，不是功能愿望清单。每条记录标记状态（提议、已接受、被替代），写明依据、决定、主要替代项、后果与重审触发条件。

决策记录必须标明依据来自“用户明确确认”还是“用户委托范围内的助手决定”；用户未反对不等于确认。当前用户已将 Noema 的产品设计与交付生命周期委托给助手，因此助手可在此项目边界内自主采纳产品方案，并须说明事实来源、假设、后果和重审条件。被取代的记录保留为历史，不能继续作为现行要求引用。

- `0001-noema-owns-personal-agent.md`：产品 owner 与独立应用边界。
- `0002-desktop-runtime.md`：桌面技术基线。
- `0003-root-dialogue-and-background-workers.md`：根对话与外部执行状态所有权；其中本地模型选择已被 ADR 0005 取代。
- `0005-free-model-routing-through-freellmapi.md`：当前唯一模型网关、免费路由白名单与凭据边界。
- `0009-gateway-route-provenance.md`：将 FreeLLMAPI 报告的实际模型路由绑定到对应根对话回复，不把所选别名当作实际模型。
- `0010-evidence-backed-personal-methods.md`：提议将“用户的个人方法”作为区别于互动约定的能力候选；要求以同任务、同目标执行器的行动与结果验证，当前不增加任何持久技能系统。
- `0011-experience-memory-contract.md`：定义经历、当前理解、互动约定与个人方法的不同生命周期；先复用现有 SQLite 来源和快照，不因“像人一样记忆”预建通用记忆平台。
- `0012-local-capture-before-conversation.md`：允许用户先将念头保存在本机且不调用模型，再显式带入唯一 Noema 对话；捕获不是理解或学习。
- `0014-per-turn-interaction-use-gate.md`：记录逐轮忽略/辅助/主导门控候选及因模型路由/额度混杂而暂缓的证据；原型已移除，未改变产品默认行为。
- `0015-agent-friends-and-conversation-rooms.md`：在用户授权的生命周期范围内，采用持续好友与独立聊天房间作为第一轮产品架构，并定义真实可运行的验证切片；不宣称最终产品定位已验证。
- `0021-buffer-free-router-replies.md`：FreeLLMAPI 自动路由请求用完整响应模式，让网关在交付前完成上游回退；直连模型保留流式，并要求流式回复有完整结束标记。
- `0022-one-shot-practice-trial.md`：仅将已独立核验且经历过一次修复的工程任务转成有界候选，并在同好友/同 workspace 的另一个 room 做一次可撤回试用；不宣称已学会或自动晋升长期技能。
- `0023-review-practice-before-dispatch.md`：模型生成的跨房间候选必须在派发前向用户展示来源、触发、做法与边界；普通经验复用勾选不自动授权把某条隐藏候选注入任务。
- `0024-interaction-adjustments-in-social-chat.md`：复用 RootStore 的明确互动调整，让它能在 Noema 当前社交聊天与项目任务主路径保存、分范围应用和查看快照；不自动总结普通聊天，也不让专业好友继承 Noema 的对话约定。
- `0025-topic-continuation-threads.md`：以可回源的 Noema 子聊天承接确需跨日继续的主题；复用房间和消息作为唯一事实来源，不新增通用事项/任务层，不暗中加载源聊天或定时执行。

不要把未决问题伪装成已接受架构；新决定替代旧决定时保留历史并互相链接。
