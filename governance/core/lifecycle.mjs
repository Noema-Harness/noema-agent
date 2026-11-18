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

/** 唯一的向前推进链：相邻一步。 */
const FORWARD = new Map([
  ["决策中", "执行中"],
  ["执行中", "待验收"],
  ["待验收", "已收口"],
]);

/** 偏差修复：验收发现实现不对、但已定决定没变时，回执行段修（不改决定）。 */
const BACKWARD = new Map([["待验收", "执行中"]]);

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

export function isReopen(from, to) {
  return to === "决策中" && from !== "决策中";
}

/**
 * 判定一次阶段移动的语义：forward / backward / reopen / null。
 *
 * - backward（偏差修复）：验收发现实现不对、决定没变；回执行段修，不得改已定决定。
 * - reopen（重开）：决定本身错了；回决策阶段重新定。
 */
export function transitionKind(from, to) {
  if (from === to) return null;
  if (isReopen(from, to)) return "reopen";
  if (isBackward(from, to)) return "backward";
  if (isForward(from, to)) return "forward";
  return null;
}

export function nextStage(stage) {
  const at = stageIndex(stage);
  return at === -1 || at + 1 >= STAGES.length ? null : STAGES[at + 1];
}