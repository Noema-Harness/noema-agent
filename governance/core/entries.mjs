// 治理内核：条目文本模型。
//
// 只按行切分与拼接，不读环境、不写盘；格式契约见 governance/core/README.md
// （四字段 + 决策层四块：要定 / 待裁 / 已定 / 轮次记录）。
// 适配层（scripts/decision.mjs 等）负责参数、门、文件路径与落盘。

import { STAGE_MARKS } from "./lifecycle.mjs";

export { STAGE_MARKS };

export const ENTRY_HEADING =
  /^## (?:([⏳🔧🔍✅])\s+)?(?:\[#(\d+)\]\(([^)]+)\)\s+)?(D-(?:\d{3}|\d{8}-[a-z0-9-]+))(?:\s+(.+))?$/u;

const DECISION_SECTION = "#### 1 决策";
const EXECUTION_SECTION = "#### 2 执行";
const ACCEPTANCE_SECTION = "#### 3 验收";
const WAIT_HEADING = /^######\s*待裁/u;
const DECIDED_HEADING = /^######\s*(已定|已定细则)/u;
const ROUND_HEADING = /^######\s*第\s*(\d+)\s*轮/u;

export function findEntryRange(text, id) {
  const lines = String(text).split("\n");
  let start = -1;
  for (const [index, line] of lines.entries()) {
    const match = ENTRY_HEADING.exec(line);
    if (match && match[4] === id) {
      start = index;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^## /.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function blockRange(lines, start, end, matcher) {
  for (let index = start; index < end; index += 1) {
    if (matcher.test(lines[index])) return index;
  }
  return -1;
}

/** 取 `#### n` 小节（到下一个一级到四级标题为止），返回行区间。 */
function sectionRange(lines, start, end, heading) {
  const index = lines.findIndex((line, at) => at >= start && at < end && line.trim() === heading);
  if (index === -1) return null;
  let stop = end;
  for (let at = index + 1; at < end; at += 1) {
    if (/^#{1,4} /u.test(lines[at])) {
      stop = at;
      break;
    }
  }
  return { start: index, end: stop };
}

function listItems(block) {
  return block
    .split("\n")
    .filter((line) => /^- (?!未开始[:：])/.test(line))
    .filter((line) => !/^- 待裁：无\s*$/u.test(line.trim()))
    .map((line) => line.trim());
}

export function readEntry(text, id) {
  const range = findEntryRange(text, id);
  if (!range) return null;
  const lines = String(text).split("\n");
  const head = ENTRY_HEADING.exec(lines[range.start]);
  const entryText = lines.slice(range.start, range.end).join("\n");
  const decision = sectionRange(lines, range.start, range.end, DECISION_SECTION);
  const execution = sectionRange(lines, range.start, range.end, EXECUTION_SECTION);
  const acceptance = sectionRange(lines, range.start, range.end, ACCEPTANCE_SECTION);
  const decisionText = decision ? lines.slice(decision.start + 1, decision.end).join("\n") : "";
  const executionText = execution ? lines.slice(execution.start + 1, execution.end).join("\n") : "";
  const acceptanceText = acceptance ? lines.slice(acceptance.start + 1, acceptance.end).join("\n") : "";
  const waitHeading = blockRange(
    lines,
    decision?.start ?? range.start,
    decision?.end ?? range.end,
    WAIT_HEADING,
  );
  const decidedHeading = blockRange(
    lines,
    decision?.start ?? range.start,
    decision?.end ?? range.end,
    DECIDED_HEADING,
  );
  let waits = [];
  if (waitHeading !== -1) {
    const stop = decidedHeading === -1 ? (decision?.end ?? range.end) : decidedHeading;
    waits = listItems(lines.slice(waitHeading + 1, stop).join("\n"));
  }
  let decided = [];
  if (decidedHeading !== -1) {
    let stop = decision?.end ?? range.end;
    for (let at = decidedHeading + 1; at < stop; at += 1) {
      if (/^######\s/u.test(lines[at])) {
        stop = at;
        break;
      }
    }
    decided = listItems(lines.slice(decidedHeading + 1, stop).join("\n"));
  }
  const rounds = lines
    .slice(range.start, range.end)
    .map((line) => ROUND_HEADING.exec(line))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const stage = /- \*\*阶段\*\*：\s*(\S+)/u.exec(entryText)?.[1] ?? null;
  const blocker = /- \*\*阻塞\*\*：\s*(.+)/u.exec(entryText)?.[1]?.trim() ?? null;
  const batch = /^- 批次：\s*(\S+)/mu.exec(executionText)?.[1] ?? null;
  const acceptanceItems = acceptanceText
    .split("\n")
    .filter((line) => /^- \[[ xX]\]/u.test(line))
    .map((line) => line.trim());
  return {
    id: head[4],
    title: (head[5] ?? "").trim(),
    emoji: head[1] ?? null,
    stage,
    blocker,
    batch,
    waits,
    decided,
    rounds,
    decisionText,
    executionText,
    acceptanceText,
    acceptanceItems,
    range,
    lines,
  };
}

export function setStage(text, id, stage, note) {
  if (!STAGE_MARKS[stage]) throw new Error(`未知阶段：${stage}`);
  const entry = readEntry(text, id);
  if (!entry) throw new Error(`找不到条目 ${id}`);
  const lines = [...entry.lines];
  const stageIndex = lines.findIndex(
    (line, at) => at >= entry.range.start && at < entry.range.end && /^- \*\*阶段\*\*：/u.test(line),
  );
  if (stageIndex === -1) throw new Error(`${id} 头部缺少「阶段」字段`);
  lines[stageIndex] = `- **阶段**：${stage}`;
  const headIndex = entry.range.start;
  const head = ENTRY_HEADING.exec(lines[headIndex]);
  const prefix = [];
  if (head[2]) prefix.push(`[#${head[2]}](${head[3]})`);
  lines[headIndex] = `## ${STAGE_MARKS[stage]} ${prefix.length ? `${prefix.join(" ")} ` : ""}${id} ${entry.title}`.trim();
  if (note) {
    const decision = entry.range;
    const insertAt = (() => {
      for (let at = decision.start; at < decision.end; at += 1) {
        if (/^- 决定：/u.test(lines[at])) return at + 1;
      }
      for (let at = decision.start; at < decision.end; at += 1) {
        if (/^- 要定：/u.test(lines[at])) return at + 1;
      }
      return decision.start + 1;
    })();
    lines.splice(insertAt, 0, note);
  }
  return lines.join("\n");
}

/** 追加一轮记录；没有轮次块时先建一个「###### 讨论记录」标题。 */
export function appendRound(text, id, { number, conclusion, changes, lines: body = [] }) {
  const entry = readEntry(text, id);
  if (!entry) throw new Error(`找不到条目 ${id}`);
  const lines = [...entry.lines];
  const next = number ?? (entry.rounds.length ? Math.max(...entry.rounds) + 1 : 1);
  const block = [
    "",
    `###### 第 ${next} 轮（${body.date ?? ""}）`.replace(/（\s*）$/u, ""),
    "",
    ...body.record.map((line) => `  ${line}`),
    `  - 结论：${conclusion}`,
    `  - 待裁变化：${changes}`,
    "",
  ];
  let roundIndex = -1;
  for (let at = entry.range.start; at < entry.range.end; at += 1) {
    if (ROUND_HEADING.test(lines[at])) roundIndex = at;
  }
  let insertAt;
  if (roundIndex === -1) {
    insertAt = entry.range.end;
    for (let at = entry.range.end - 1; at > entry.range.start; at -= 1) {
      if (lines[at].trim() !== "") {
        insertAt = at + 1;
        break;
      }
    }
    lines.splice(insertAt, 0, "", "###### 讨论记录（每轮追加；结论与待裁变化写在这里）", ...block.slice(1));
  } else {
    let stop = entry.range.end;
    for (let at = roundIndex + 1; at < entry.range.end; at += 1) {
      if (/^#{1,6} /u.test(lines[at]) && !ROUND_HEADING.test(lines[at])) {
        stop = at;
        break;
      }
    }
    insertAt = stop;
    while (insertAt > roundIndex + 1 && lines[insertAt - 1].trim() === "") insertAt -= 1;
    lines.splice(insertAt, 0, "", ...block.slice(1));
  }
  return lines.join("\n");
}

/** 把一条待裁并入已定（E 编号 + 原话 + 日期），并从待裁块移除对应行。 */
export function settleDecision(text, id, { number, title, detail, approval, date, item }) {
  const entry = readEntry(text, id);
  if (!entry) throw new Error(`找不到条目 ${id}`);
  if (!entry.waits.length) throw new Error(`${id} 没有待裁项，无法并入已定`);
  const waiting = item ? entry.waits.find((line) => line.includes(item)) : entry.waits[0];
  if (!waiting) throw new Error(`待裁块里找不到「${item}」`);
  const lines = [...entry.lines];
  const waitHeading = lines.findIndex(
    (line, at) => at >= entry.range.start && at < entry.range.end && WAIT_HEADING.test(line),
  );
  const decidedHeading = lines.findIndex(
    (line, at) => at >= entry.range.start && at < entry.range.end && DECIDED_HEADING.test(line),
  );
  if (decidedHeading === -1) throw new Error(`${id} 缺少「###### 已定」块`);
  const waitLine = lines.findIndex(
    (line, at) => at > waitHeading && at < entry.range.end && line.trim() === waiting,
  );
  if (waitLine === -1) throw new Error(`待裁行定位失败：${waiting}`);
  lines.splice(waitLine, 1);
  // 移除待裁行后索引会前移一格：每次插入前都重新定位已定块，避免把 E 行插进待裁块。
  let decidedStart = lines.findIndex(
    (line, at) => at >= entry.range.start && at < entry.range.end && DECIDED_HEADING.test(line),
  );
  if (lines.slice(waitHeading + 1, decidedStart).every((line) => line.trim() === "")) {
    lines.splice(waitHeading + 1, decidedStart - waitHeading - 1, "", "- 待裁：无");
    decidedStart = lines.findIndex(
      (line, at) => at >= entry.range.start && at < entry.range.end && DECIDED_HEADING.test(line),
    );
  }
  const decidedStop = (() => {
    for (let at = decidedStart + 1; at < entry.range.end; at += 1) {
      if (/^######\s/u.test(lines[at])) return at;
    }
    return entry.range.end;
  })();
  lines.splice(
    decidedStop,
    0,
    `- **E${number} ${title}**：${detail}（${date}，原话「${approval}」）`,
  );
  return lines.join("\n");
}

/** 在决策层「- 要定：」之后插入「- 决定：」——决定与阶段推进必须在同一次写盘里完成，
 *  否则决策中就不能有决定行，两步写会互相拒绝。 */
export function withDecisionLine(text, id, line) {
  const entry = readEntry(text, id);
  const lines = [...entry.lines];
  let at = -1;
  for (let index = entry.range.start; index < entry.range.end; index += 1) {
    if (/^- 要定：/u.test(lines[index])) {
      at = index + 1;
      break;
    }
  }
  if (at === -1) throw new Error(`${id} 的决策层没有「- 要定：」：先写清要用户定什么`);
  lines.splice(at, 0, line);
  return lines.join("\n");
}