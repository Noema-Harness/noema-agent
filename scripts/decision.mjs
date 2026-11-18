// 条目阶段与记录的写盘入口：round / settle / advance。
// 行为门在这里：写盘前校验原话长度、合法转移、批次指针与条目结构；失败不落盘。
// 条目文本模型在 governance/core/entries.mjs，阶段语义在 governance/core/lifecycle.mjs；
// 本文件只做 Noema 的路径、门与 CLI 接线。
import fs from "node:fs";
import path from "node:path";
import { checkDecisionEntries, localToday } from "./maintenance.mjs";
import {
  addUpdateNote,
  appendRound,
  editEntryFields,
  normaliseStageEvents,
  readEntry,
  setStage,
  settleDecision,
  withDecisionLine,
} from "../governance/core/entries.mjs";
import { transitionKind } from "../governance/core/lifecycle.mjs";
import { STATES } from "./lifecycle.mjs";

const DECISIONS = path.join("docs", "DECISIONS.md");
const MIN_APPROVAL = 10;
const MIN_REASON = 10;

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

function requireApproval(flags, purpose) {
  const approval = typeof flags.approval === "string" ? flags.approval.trim() : "";
  if (!approval) {
    throw new Error(`缺少 --approval「用户原话」：${purpose}必须有用户明确批准的原话\n先跑 npm run stage -- <当前阶段> 看这一阶段的规则`);
  }
  if ([...approval].length < MIN_APPROVAL) {
    throw new Error(
      `--approval 原话太短（${[...approval].length} 字，至少 ${MIN_APPROVAL} 字）：引用能说明「批准了什么」的那句`,
    );
  }
  return approval;
}

function requireReason(flags) {
  const reason = typeof flags.reason === "string" ? flags.reason.trim() : "";
  if (!reason) {
    throw new Error(`缺少 --reason「退回原因」：退回修复要留下原因，写进条目\n先跑 npm run stage -- 验收 看验收不过的规则`);
  }
  if ([...reason].length < MIN_REASON) {
    throw new Error(`--reason 太短（${[...reason].length} 字，至少 ${MIN_REASON} 字）：写清哪一处不过、要修什么`);
  }
  return reason;
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

export function advanceEntry({ root = process.cwd(), id, stage, decision, approval, reason, date, dryRun = false }) {
  const file = path.join(root, DECISIONS);
  const text = fs.readFileSync(file, "utf8");
  const entry = requireEntry(text, id);
  const target = stage;
  if (!STATES.includes(target)) throw new Error(`未知阶段：${target}；可用 ${STATES.join(" / ")}`);
  if (entry.stage === target) throw new Error(`${id} 已经在${target}`);
  const kind = transitionKind(entry.stage, target);
  if (!kind) {
    throw new Error(
      `${id} 不能从${entry.stage}直接到${target}；合法转移见 governance/core/lifecycle.mjs（向前一步、验收不过退回执行中、或重开）`,
    );
  }
  const today = date ?? localToday();
  let next = text;
  let transition = kind;
  if (kind === "reopen") {
    if (!/重开/u.test(entry.decisionText)) {
      throw new Error("重开条目时在决策层写一行「重开：<原因>」，再运行本命令");
    }
    next = setStage(text, id, target, `- 重开：${today}`);
  } else if (kind === "backward") {
    const why = requireReason({ reason });
    next = setStage(text, id, target, `- 退回：${why}（${today}）`);
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
  requireEntry(text, id);
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
  return { id, number, entry };
}


function ensureValid(next) {
  const problems = checkDecisionEntries(next);
  if (problems.length) {
    throw new Error(`写入前校验失败（条目没有改动）：\n- ${problems.join("\n- ")}`);
  }
}

export function editEntry({ root = process.cwd(), id, values = {}, normalise = false, note, dryRun = false }) {
  const file = path.join(root, DECISIONS);
  const text = fs.readFileSync(file, "utf8");
  requireEntry(text, id);
  let next = text;
  const report = [];
  if (normalise) {
    const result = normaliseStageEvents(next, id);
    next = result.text;
    report.push(`阶段事件整理：${result.order.length} 条（${result.order.join(" / ")}），去重 ${result.removed} 条`);
  }
  if (Object.keys(values).length > 0) {
    const result = editEntryFields(next, id, values);
    next = result.text;
    report.push(`字段改动：${result.changed.join("、")}`);
  }
  if (note) {
    next = addUpdateNote(next, id, note);
    report.push("追加一行说明");
  }
  if (next === text) {
    throw new Error("没有任何改动：给出 --blocker / --pending / --conclusion / --normalise-events / --note 之一");
  }
  ensureValid(next);
  commit(root, next, { dryRun });
  return { id, report };
}

export function pauseEntry({ root = process.cwd(), id, reason, date, dryRun = false }) {
  const why = requireReason({ reason });
  const today = date ?? localToday();
  const result = editEntry({
    root,
    id,
    values: { blocker: `暂停：${why}（${today}）` },
    note: `- 暂停：${why}（${today}）`,
    dryRun,
  });
  if (!dryRun) {
    recordRound({ root, id, conclusion: `暂停（${today}）：${why}`, changes: "无（暂停；未产生新的待裁项）", date: today });
  }
  return { id, report: result.report };
}

export function resumeEntry({ root = process.cwd(), id, date, dryRun = false }) {
  const today = date ?? localToday();
  const result = editEntry({
    root,
    id,
    values: { blocker: "无" },
    note: `- 恢复：${today}（继续本议题）`,
    dryRun,
  });
  if (!dryRun) {
    recordRound({ root, id, conclusion: `恢复（${today}）：继续讨论`, changes: "无（恢复；待裁清单不变）", date: today });
  }
  return { id, report: result.report };
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  try {
    if (command === "edit") {
      const values = {};
      if (typeof flags.blocker === "string") values.blocker = flags.blocker;
      if (typeof flags.pending === "string") values.pending = flags.pending;
      if (typeof flags.conclusion === "string") values.conclusion = flags.conclusion;
      const result = editEntry({
        root,
        id: flags.entry,
        values,
        normalise: flags["normalise-events"] === true,
        note: typeof flags.note === "string" ? flags.note : null,
        dryRun: flags["dry-run"] === true,
      });
      console.log(`${result.id}：${result.report.join("；")}`);
      return 0;
    }
    if (command === "pause" || command === "resume") {
      const result =
        command === "pause"
          ? pauseEntry({ root, id: flags.entry, reason: flags.reason, date: flags.date, dryRun: flags["dry-run"] === true })
          : resumeEntry({ root, id: flags.entry, date: flags.date, dryRun: flags["dry-run"] === true });
      console.log(`${result.id}：${result.report.join("；")}`);
      return 0;
    }
    if (command === "round") {
      const result = recordRound({
        root,
        id: flags.entry,
        conclusion: flags.conclusion,
        changes: flags.changes,
        date: flags.date,
        lines: flags.line ? (Array.isArray(flags.line) ? flags.line : [flags.line]) : [],
        dryRun: flags["dry-run"] === true,
      });
      console.log(`${result.id}：第 ${result.round} 轮已记录`);
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
        reason: flags.reason,
        date: flags.date,
        dryRun: flags["dry-run"] === true,
      });
      console.log(`${result.id}：${result.from} → ${result.to}（${result.transition}）`);
      return 0;
    }
    console.error("用法：npm run decision -- <round|settle|advance|edit|pause|resume> --entry <D-…> …");
    return 2;
  } catch (error) {
    console.error(`decision：${error.message}`);
    return 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith("decision.mjs")) {
  process.exitCode = main();
}