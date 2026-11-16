// One work item = one review entry in docs/DECISIONS.md.
//
// Ownership: the four stages below are the only states a work item can be in,
// and every stage change is bound to a gate command. This module is the
// single source for that table; AGENTS.md renders it as a short timeline, the
// review view and the entry checks read the same states.

export const STATES = ["决策中", "执行中", "待验收", "已收口"];

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
    gate: "npm run plan:check",
    writes: "openspec/changes/<name>/",
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

export function isStage(value) {
  return STATES.includes(value);
}

export function stageIndex(stage) {
  return STATES.indexOf(stage);
}

export function nextTransition(stage) {
  return TRANSITIONS.find((transition) => transition.from === stage) ?? null;
}

export function nextStage(stage) {
  return nextTransition(stage)?.to ?? null;
}

// Uniform wording for gate failures: what is wrong, why the rule exists, and
// which command or file unblocks it.
export function gateFailure(problem, reason, next) {
  return `${problem}。${reason}。下一步：${next}`;
}
