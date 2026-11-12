# Proposal

## Why

Noema 已经积累出对话、记忆、执行、诊断几套彼此耦合的实现，但缺少一个经过证据复核的系统边界。继续按局部功能叠加，会把“能跑”误当成“架构成立”，后续每次迁移都变成无规格的大改。现在需要先把总蓝图、模块边界、选型依据和分期门禁定下来，再按阶段迁移。

## What Changes

- 建立 Noema 的五平面总体蓝图：身份/关系、记忆/连续性、认知/对话、执行/成长、证据/评测。
- 明确当前与目标的映射：单条常驻时间线、检查点/分支、上下文编译、记忆生命周期、执行 broker、trace/eval。
- 形成技术选型矩阵 D1–D9，记录每个候选的许可证、维护、Windows/Electron 约束、失败模式和回退。
- 形成 ADR：模块边界、单条常驻时间线、原生执行边界、Agent 内核适配、自主性阶梯。
- 形成 OpenSpec Phase 0–5 的分期、迁移方式（bypass → shadow → small flow → default → cleanup）和每阶段门禁。
- 生成并维护 current/planned 分离的系统全景图、运行流程图、能力与开源参照图。
- 不修改产品行为、不迁移核心代码；0.6.9 保持可安装回退。

## Capabilities

### New Capabilities

无。此变更只建立设计与迁移依据，不产生可观察的产品行为变化。

### Modified Capabilities

无。

## Impact

- 文档：`docs/architecture/`、`docs/CURRENT_CONTEXT.md`、`AGENTS.md`、`.codex/workspace.json`。
- 规划：OpenSpec Phase 1–5 的变更名与门禁；不创建实现变更。
- 代码：无产品代码改动；0.6.9 安装包与 836/836 检查不变。
