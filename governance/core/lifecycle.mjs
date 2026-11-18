// 治理内核：阶段模型。
//
// 这里只有「一个条目能在哪几个阶段、哪些转移合法」，不写任何项目路径或命令；
// 具体门的命令、规则包位置、条目文件位置由适配层（scripts/ 与治理适配目录）提供。
// 阶段标记与状态机必须与 governance/core/README.md 的表格一致。

export const STAGES = ["决策中", "执行中", "待验收", "已收口"];

export const STAGE_MARKS = {
  决策中: "⏳",
  执行中: "🔧",
  待验收: "🔍",
  已收口: "✅",
};

/** 阶段规则包的三个入口（与具体文件名解耦，适配层负责映射）。 */
export const PHASES = ["discussion", "execution", "acceptance"];

/** 允许的相位推进：相邻向前一步，或退回一步；重开单独判定。 */
const FORWARD = new Map([
  ["决策中", "执行中"],
  ["执行中", "待验收"],
  ["待验收", "已收口"],
]);

const BACKWARD = new Map([
  ["待验收", "执行中"],
]);

export function isStage(value) {
  return STAGES.includes(value);
}

export function stageIndex(stage) {
  return STAGES.indexOf(stage);
}

export function isForward(from, to) {
  return FORWARD.get(from) === to;
}

export function isBackward(from, to) {
  return BACKWARD.get(from) === to;
}

/** 判定一次阶段移动的语义：forward / backward / reopen / null。 */
export function transitionKind(from, to) {
  if (from === to) return null;
  if (to === "决策中") return "reopen";
  if (isForward(from, to)) return "forward";
  if (isBackward(from, to)) return "backward";
  return null;
}

export function nextStage(stage) {
  const at = stageIndex(stage);
  return at === -1 || at + 1 >= STAGES.length ? null : STAGES[at + 1];
}