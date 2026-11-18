// 条目阶段与记录的写盘入口：round / settle / advance。
// 行为门在这里：写盘前校验原话长度、合法转移、批次指针与条目结构；失败不落盘。
import fs from "node:fs";
import path from "node:path";
import { checkDecisionEntries, localToday } from "./maintenance.mjs";
import { appendRound, readEntry, setStage, settleDecision } from "./decision-kernel.mjs";
import { STATES, nextStage, stageIndex } from "./lifecycle.mjs";

const DECISIONS = path.join("docs", "DECISIONS.md");
const MIN_APPROVAL = 10;

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
    flags[key] = value;
  }
  return flags;
}

function requireEntry(text, id) {
  if (!id) throw new Error("缺少 --entry <D-…>：先指明要改的条目");
  const entry = readEntry(text, id);
  if (!entry) throw new Error(`找不到条目 ${id}`);
  return entry;
}

/** 在决策层「- 要定：」之后插入「- 决定：」——决策与阶段推进必须在同一次写盘里完成，
 *  否则决策中就不能有决定行，两步写会互相拒绝。 */
function withDecisionLine(text, id, line) {
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

function requireApproval(flags, purpose) {
  const approval = typeof flags.approval === "string" ? flags.approval.trim() : "";
  if (!approval) {
    throw new Error(`缺少 --approval「用户原话」：${purpose}必须有用户明确批准的原话`);
  }
  if ([...approval].length < MIN_APPROVAL) {
    throw new Error(
      `--approval 原话太短（${[...approval].length} 字，至少 ${MIN_APPROVAL} 字）：引用能说明「批准了什么」的那句`,
    );
  }
  return approval;
}

function commit(root, next, { dryRun }) {
  if (dryRun) {
    console.log("dry-run：不写盘。生成后的条目如下：");
    console.log(next);
    return;
  }
  fs.writeFileSync(path.join(root, DECISIONS), next, "utf8");
  console.log(`已写入 ${DECISIONS}`);
}

export function advanceEntry({ root = process.cwd(), id, stage, decision, approval, date, dryRun = false }) {
  const file = path.join(root, DECISIONS);
  const text = fs.readFileSync(file, "utf8");
  const entry = requireEntry(text, id);
  const target = stage;
  if (!STATES.includes(target)) throw new Error(`未知阶段：${target}；可用 ${STATES.join(" / ")}`);
  if (entry.stage === target) throw new Error(`${id} 已经在${target}`);
  let transition = null;
  if (target === "决策中") {
    transition = "重开";
  } else if (stageIndex(target) === stageIndex(entry.stage) + 1) {
    transition = `${entry.stage} → ${target}`;
  } else {
    throw new Error(
      `${id} 不能从${entry.stage}直接到${target}；合法转移见 scripts/lifecycle.mjs，退回用 --stage 上一个阶段并写原因`,
    );
  }
  const today = date ?? localToday();
  let next = text;
  if (target === "决策中") {
    if (!/重开/u.test(entry.decisionText)) {
      throw new Error("重开条目时在决策层写一行「重开：<原因>」，再运行本命令");
    }
    next = setStage(text, id, target, `- 重开：${today}`);
  } else if (target === "执行中") {
    const quote = requireApproval({ approval }, "进入执行");
    if (!entry.batch) {
      throw new Error(`${id} 的执行层没有「- 批次：changes/<name>」：先建档再进执行（E23）`);
    }
    if (!fs.existsSync(path.join(root, "openspec", "changes", entry.batch.replace(/^changes\//u, "")))) {
      throw new Error(`${id} 的批次 ${entry.batch} 在 openspec/changes/ 里不存在：先建档`);
    }
    if (!decision || !String(decision).trim()) {
      throw new Error("缺少 --decision：写一句这次定下的方案（会写进「- 决定：」）");
    }
    const decided = withDecisionLine(
      text,
      id,
      `- 决定：${String(decision).trim()}（用户原话：「${quote}」，${today}）`,
    );
    next = setStage(decided, id, target, `- 进入执行：${today}`);
  } else if (target === "待验收") {
    next = setStage(text, id, target, `- 转待验收：${today}`);
  } else {
    const quote = requireApproval({ approval }, "收口");
    if (entry.acceptanceItems.length === 0) {
      throw new Error(`${id} 的验收层没有「- [ ] 项」：先写可勾选的验收项`);
    }
    if (entry.acceptanceItems.some((line) => /^- \[ \]/u.test(line))) {
      throw new Error(`${id} 还有未勾选的验收项：用户确认后才收口`);
    }
    next = setStage(text, id, target, `- 用户确认：${today}（用户原话「${quote}」）`);
  }
  const report = checkDecisionEntries(next, { today });
  if (report.errors.length) {
    throw new Error(`写入前校验失败（条目没有改动）：\n${report.errors.join("\n")}`);
  }
  commit(root, next, { dryRun });
  return { id, from: entry.stage, to: target, transition };
}

export function recordRound({ root = process.cwd(), id, conclusion, changes, date, lines = [], dryRun = false }) {
  const file = path.join(root, DECISIONS);
  const text = fs.readFileSync(file, "utf8");
  const entry = requireEntry(text, id);
  if (!conclusion || !String(conclusion).trim()) throw new Error("缺少 --conclusion：这一轮的结论是什么");
  if (changes === undefined) throw new Error("缺少 --changes：「+新增 / 已解除 / 继续」的待裁变化");
  const next = appendRound(text, id, {
    conclusion: String(conclusion).trim(),
    changes: String(changes).trim(),
    lines: { record: lines.map((line) => `- ${line}`), date: date ?? localToday() },
  });
  const report = checkDecisionEntries(next);
  if (report.errors.length) {
    throw new Error(`写入前校验失败（条目没有改动）：\n${report.errors.join("\n")}`);
  }
  commit(root, next, { dryRun });
  return { id, round: Math.max(...readEntry(next, id).rounds) };
}

export function settleDecisionItem({
  root = process.cwd(),
  id,
  number,
  title,
  detail,
  item,
  approval,
  date,
  dryRun = false,
}) {
  const file = path.join(root, DECISIONS);
  const text = fs.readFileSync(file, "utf8");
  const entry = requireEntry(text, id);
  const quote = requireApproval({ approval }, "把待裁并入已定");
  if (!number || !title || !detail) throw new Error("缺少 --number / --title / --detail");
  const next = settleDecision(text, id, {
    number,
    title,
    detail,
    approval: quote,
    date: date ?? localToday(),
    item,
  });
  const report = checkDecisionEntries(next);
  if (report.errors.length) {
    throw new Error(`写入前校验失败（条目没有改动）：\n${report.errors.join("\n")}`);
  }
  commit(root, next, { dryRun });
  return { id, number };
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  try {
    if (command === "round") {
      recordRound({
        root,
        id: flags.entry,
        conclusion: flags.conclusion,
        changes: flags.changes,
        date: flags.date,
        lines: flags.line ? (Array.isArray(flags.line) ? flags.line : [flags.line]) : [],
        dryRun: flags["dry-run"] === true,
      });
      return 0;
    }
    if (command === "settle") {
      settleDecisionItem({
        root,
        id: flags.entry,
        number: flags.number,
        title: flags.title,
        detail: flags.detail,
        item: flags.item,
        approval: flags.approval,
        date: flags.date,
        dryRun: flags["dry-run"] === true,
      });
      return 0;
    }
    if (command === "advance") {
      const result = advanceEntry({
        root,
        id: flags.entry,
        stage: flags.stage,
        decision: flags.decision,
        approval: flags.approval,
        date: flags.date,
        dryRun: flags["dry-run"] === true,
      });
      console.log(`${result.id}：${result.from} → ${result.to}`);
      return 0;
    }
    console.error("用法：npm run decision -- <round|settle|advance> --entry <D-…> …");
    return 2;
  } catch (error) {
    console.error(`decision：${error.message}`);
    return 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith("decision.mjs")) {
  process.exitCode = main();
}