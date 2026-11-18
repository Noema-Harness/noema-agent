// 阶段模型的 Noema 适配层：阶段本身在 governance/core/lifecycle.mjs，
// 这里只补每道转移对应的仓库命令（门）与全局门清单。
//
// 资产所有权：阶段枚举与合法转移由内核拥有；这里的 TRANSITIONS 是给人和文档看的
// 「哪一步要过哪道门」，改动时必须与内核的 forward/backward 表同步。

import { STAGES, isStage, nextStage, stageIndex, transitionKind } from "../governance/core/lifecycle.mjs";

export { STAGES as STATES, isStage, nextStage, stageIndex, transitionKind };

// Transitions are ordered; `from: null` is how a work item is born.
export const TRANSITIONS = [
  {
    from: null,
    to: "决策中",
    event: "用户消息、收件箱或看板卡产生议题",
    gate: "npm run inbox",
    writes: "docs/DECISIONS.md 新条目",
  },
  {
    from: "决策中",
    to: "执行中",
    event: "用户确认方案",
    gate: "npm run decision -- advance",
    writes: "openspec/changes/<name>/ 与条目决定行",
  },
  {
    from: "执行中",
    to: "待验收",
    event: "实现与自验证完成",
    gate: "npm run milestone:check",
    writes: "归档变更、合并 specs",
  },
  {
    from: "待验收",
    to: "已收口",
    event: "用户勾选验收项",
    gate: "npm run decisions:sync",
    writes: "- 用户确认：YYYY-MM-DD",
  },
  {
    from: "待验收",
    to: "执行中",
    event: "验收不过，退回修复",
    gate: "npm run decision -- advance --reason",
    writes: "- 退回：<原因>（YYYY-MM-DD）",
  },
];

export const REOPEN = {
  to: "决策中",
  event: "用户重开",
  gate: null,
  writes: "条目里写一行「重开」和原因",
};

// Gates that run on every commit or push, whatever the stage.
export const ALWAYS_GATES = [
  { name: "commit", command: "npm run precommit:check", where: "本机钩子" },
  { name: "verify", command: "npm run check", where: "PR 与 main" },
  { name: "platform", command: "npm run platform:check", where: "PR 与 main" },
  { name: "collaboration", command: "npm run guard", where: "PR" },
];

export function nextTransition(stage) {
  return TRANSITIONS.find((transition) => transition.from === stage && transition.to === nextStage(stage)) ?? null;
}

// Uniform wording for gate failures: what is wrong, why the rule exists, and
// which command or file unblocks it.
export function gateFailure(problem, reason, next) {
  return `${problem}。${reason}。下一步：${next}`;
}

export { STAGES };