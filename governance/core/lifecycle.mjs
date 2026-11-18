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

export function isStage(value) {
  return STAGES.includes(value);
}

export function stageIndex(stage) {
  return STAGES.indexOf(stage);
}

export function isForward(from, to) {
  return FORWARD.get(from) === to;
}

export function isReopen(from, to) {
  return to === "决策中" && from !== "决策中";
}

/**
 * 判定一次阶段移动的语义：forward / reopen / null。
 *
 * 只有一条回溯边：回决策中（重开）。验收不过说明决策没做对（执行清单没覆盖决定），
 * 所以退回的是决策阶段；不存在「退回执行中」这类中间回退。
 */
export function transitionKind(from, to) {
  if (from === to) return null;
  if (isReopen(from, to)) return "reopen";
  if (isForward(from, to)) return "forward";
  return null;
}

export function nextStage(stage) {
  const at = stageIndex(stage);
  return at === -1 || at + 1 >= STAGES.length ? null : STAGES[at + 1];
}