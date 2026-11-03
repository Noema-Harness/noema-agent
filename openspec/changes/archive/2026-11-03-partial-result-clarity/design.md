# Design

## Context

E4 的恢复事实已由 SocialChatStore task/checkpoint/step records 持有，SocialWorkService 负责安全 admission；NoemaExecutor 在安全 model boundary 才可从原 task 续接。再次编辑并执行会创建独立 task，因此旧 task 卡与结果继续保留。停止、应用重启、进程异常和 shutdown timeout 都会有对应 task/error state；副作用未知时恢复入口不可用。

本次实际缺口在展示：`ProjectWorkCard` 对 `completed`、`failed`、`interrupted` 复用“执行结果”标题，且同一 `resultText` 在安全续接期间可能仍是前一段保存内容。它没有表达持久文本的时间/完成边界。

## Goals / Non-Goals

**Goals:**

- 已完成 task 的最终文本仍显示为执行结果；其它状态的文本显示为已保存阶段内容。
- interrupted、failed、active continuation 明确指出未完成，保留现有检查清单、错误说明和 safe resume control。
- 用可独立测试的呈现函数保证任何 phase 都不能覆盖 terminal status 和 unknown-effect recovery 文案。

**Non-Goals:**

- 不更改 checkpoint 格式、attempt/storage schema、retry semantics、stop behavior 或跨-room result publication。
- 不自动请求模型生成 handoff，不在用户停止后继续调用模型，也不声称每种进程故障都能恢复文本。
- 不将 unknown副作用提升为可续接，不做自动回滚。

## Decisions

1. **根据持久 task.status 选择结果标题。** completed 使用“执行结果”；interrupted 使用“停止前保存的部分内容”；failed/active 使用“已保存的阶段内容”。phase 只能辅助当前运行说明，不能把 failed/interrupted 变成成功。
2. **复用现有 recovery presentation。** 保留检查工作区、结果未知、可续接与新任务重试说明；阶段文本旁只增加一句完成边界，不复制/改写错误分类。
3. **不新增 attempt store。** 从源代码可见，安全 checkpoint resume 会续接同一 task 的持久消息与 step ledger；用户重新编辑并执行创建另一个 task，原 task/卡片仍在。增加另一份 attempt table 会复制当前历史 owner，超出本次发现的行为缺口。

## Risks / Trade-offs

- [恢复后的 task 卡仍可能只展示当前 `resultText`，而更早的助手输出在 checkpoint history] → 用“阶段内容”避免把它称为最终结果；原 checkpoint 和 execution-step 事实不删除。
- [failed task 的某些结果文字可能很完整] → 仍标为未完成任务内容，因为 verification/task status 才是完成事实来源。

## Migration Plan

无需数据库迁移或数据改写。旧 task 依据已有 status 呈现新标题。

## Open Questions

无。
