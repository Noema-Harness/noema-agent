// 条目阶段与记录的写盘入口：round / settle / advance。
// 行为门在这里：写盘前校验原话长度、合法转移、批次指针与条目结构；失败不落盘。
// 条目文本模型在 governance/core/entries.mjs，阶段语义在 governance/core/lifecycle.mjs；
// 本文件只做 Noema 的路径、门与 CLI 接线。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { resolveGitExecutable } from "./git-exec.mjs";
import { checkDecisionEntries, localToday } from "./maintenance.mjs";
import {
  addUpdateNote,
  addWaitingItem,
  dropWaitingItem,
  appendRound,
  appendExecutionLine,
  appendStageEvent,
  distributeStageEvents,
  editEntryFields,
  normaliseStageEvents,
  readEntry,
  setStage,
  settleDecision,
  withDecisionLine,
  replaceAcceptance,
  replaceBatch,
} from "../governance/core/entries.mjs";
import { transitionKind } from "../governance/core/lifecycle.mjs";
import { assembleAcceptance } from "../governance/core/acceptance.mjs";
import { checkTransition } from "./transition.mjs";
import { STATES } from "./lifecycle.mjs";

const DECISIONS = path.join("docs", "DECISIONS.md");
const MIN_APPROVAL = 2; // 明确的两字批准（如「可以」）算；单字仍拒
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
    throw new Error(
      `缺少 --approval「用户原话」：${purpose}必须有用户明确批准的原话\n先跑 npm run stage -- <当前阶段> 看这一阶段的规则`,
    );
  }
  if ([...approval].length < MIN_APPROVAL) {
    throw new Error(
      `--approval 原话太短（${[...approval].length} 字，至少 ${MIN_APPROVAL} 字）：引用能说明「批准了什么」的那句，如「可以通过」「按这个做」`,
    );
  }
  return approval;
}

function requireReason(flags, purpose) {
  const reason = typeof flags.reason === "string" ? flags.reason.trim() : "";
  if (!reason) {
    throw new Error(
      `缺少 --reason「重开原因」：${purpose}要写清哪一处不过、要改什么\n先跑 npm run stage -- 验收 看验收不过怎么退`,
    );
  }
  if ([...reason].length < MIN_REASON) {
    throw new Error(
      `--reason 太短（${[...reason].length} 字，至少 ${MIN_REASON} 字）：写清哪一处不过、要改什么`,
    );
  }
  return reason;
}

const WRITE_STAMP = path.join(".work", "decision-writes", "DECISIONS.json");

/** 写盘印记（M12）：记下命令写出的文件哈希，提交前据此发现「绕过命令改过」。 */
function stampWrite(root, text) {
  const sha256 = createHash("sha256").update(text).digest("hex");
  const file = path.join(root, WRITE_STAMP);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ path: DECISIONS.replaceAll("\\", "/"), sha256, at: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

function commit(root, next, { dryRun }) {
  if (dryRun) {
    console.log("dry-run：不写盘。生成后的条目如下：");
    console.log(next);
    return;
  }
  fs.writeFileSync(path.join(root, DECISIONS), next, "utf8");
  stampWrite(root, next);
  console.log(`已写入 ${DECISIONS}`);
}

export function advanceEntry({
  root = process.cwd(),
  id,
  stage,
  decision,
  approval,
  reason,
  design,
  newBatch,
  date,
  dryRun = false,
}) {
  const file = path.join(root, DECISIONS);
  const text = fs.readFileSync(file, "utf8");
  const entry = requireEntry(text, id);
  const target = stage;
  if (!STATES.includes(target)) throw new Error(`未知阶段：${target}；可用 ${STATES.join(" / ")}`);
  if (entry.stage === target) throw new Error(`${id} 已经在${target}`);
  const kind = transitionKind(entry.stage, target);
  if (!kind) {
    throw new Error(
      `${id} 不能从${entry.stage}直接到${target}；合法转移只有向前一步，或重开回决策中（见 governance/core/lifecycle.mjs）`,
    );
  }
  const today = date ?? localToday();
  let next = text;
  let transition = kind;
  if (kind === "reopen") {
    const why = requireReason({ reason }, "回决策中（重开）");
    const section = entry.stage === "待验收" ? "#### 3 验收" : "#### 2 执行";
    next = appendStageEvent(text, id, { kind: "重开", rest: why, date: today, section }).text;
    next = setStage(next, id, target);
  } else if (target === "执行中") {
    const quote = requireApproval({ approval }, "进入执行");
    const batch = typeof newBatch === "string" ? newBatch : entry.batch;
    if (!batch) {
      throw new Error(`${id} 的执行层没有「- 批次：changes/<name>」：先建档再进执行（E23）`);
    }
    if (!fs.existsSync(path.join(root, "openspec", "changes", batch.replace(/^changes\//u, "")))) {
      throw new Error(`${id} 的批次 ${batch} 在 openspec/changes/ 里不存在：先建档`);
    }
    if (typeof newBatch === "string") {
      const why = requireReason({ reason }, "另开批次");
      const old = entry.batch ? `（原 ${entry.batch}）` : "";
      next = replaceBatch(next, id, batch);
      next = appendExecutionLine(
        next,
        id,
        `- 批次历史：${batch}${old}（${today}；新批次原因：${why}）`,
      ).text;
    }
    entry.batch = batch;
    const changeName = batch.replace(/^changes\//u, "");
    const proposalFile = path.join(root, "openspec", "changes", changeName, "proposal.md");
    const proposal = fs.existsSync(proposalFile) ? fs.readFileSync(proposalFile, "utf8") : "";
    if (!proposal.trim()) {
      throw new Error(`${id} 的批次 ${batch} 没有 proposal.md：先建档再进执行（E23）`);
    }
    if (!proposal.includes(id)) {
      throw new Error(
        `proposal.md 没有引用条目 ${id}：计划的来源必须能追到决议，改 proposal 的「Plan」或来源后再进执行（E23）`,
      );
    }
    if (!decision || !String(decision).trim()) {
      throw new Error("缺少 --decision：写一句这次定下的方案（会写进「- 决定：」）");
    }
    let designLine = null;
    if (typeof design === "string") {
      const designFile = path.resolve(root, design);
      if (!fs.existsSync(designFile)) {
        throw new Error(`读不到 --design ${design}：进执行前必须有一份结构完整的设计方案（E21）`);
      }
      const designText = fs.readFileSync(designFile, "utf8");
      const { errors } = checkTransition(designText, "design");
      if (errors.length > 0) {
        throw new Error(
          `设计方案不合规：${errors.join("；")}（先跑 npm run transition -- design 看结构，待确认项必须是「- 无」）`,
        );
      }
      designLine = `- 设计：${design.replaceAll("\\", "/")}（${today}）`;
    }
    const decided = withDecisionLine(
      next,
      id,
      `- 决定：${String(decision).trim()}（用户原话：「${quote}」，${today}）`,
    );
    const withDesign = designLine ? appendExecutionLine(decided, id, designLine).text : decided;
    next = setStage(withDesign, id, target);
  } else if (target === "待验收") {
    const coverage = assembleAcceptance(entry);
    if (coverage.uncovered.length > 0) {
      throw new Error(
        `${id} 还有 ${coverage.uncovered.length} 个已定 E 没有验收项（${coverage.uncovered.join("、")}）：先跑 npm run acceptance -- --entry ${id} 看缺哪些，按 E 编号补齐再转待验收`,
      );
    }
    if (entry.acceptanceItems.length === 0) {
      throw new Error(`${id} 的验收层没有「- [ ] 项」：先写可勾选的验收项`);
    }
    next = appendStageEvent(text, id, { kind: "转待验收", date: today }).text;
    next = setStage(next, id, target);
  } else {
    const quote = requireApproval({ approval }, "收口");
    if (entry.acceptanceItems.length === 0) {
      throw new Error(`${id} 的验收层没有「- [ ] 项」：先写可勾选的验收项`);
    }
    if (entry.acceptanceItems.some((line) => /^- \[ \]/u.test(line))) {
      throw new Error(`${id} 还有未勾选的验收项：用户确认后才收口`);
    }
    next = appendStageEvent(text, id, {
      kind: "用户确认",
      rest: `${today}（用户原话「${quote}」）`,
      date: "",
    }).text;
    next = setStage(next, id, target);
  }
  const report = checkDecisionEntries(next, { today });
  if (report.errors.length) {
    throw new Error(`写入前校验失败（条目没有改动）：\n${report.errors.join("\n")}`);
  }
  commit(root, next, { dryRun });
  return { id, from: entry.stage, to: target, transition };
}

export function recordRound({
  root = process.cwd(),
  id,
  conclusion,
  changes,
  date,
  number,
  lines = [],
  dryRun = false,
}) {
  const file = path.join(root, DECISIONS);
  const text = fs.readFileSync(file, "utf8");
  requireEntry(text, id);
  if (!conclusion || !String(conclusion).trim())
    throw new Error("缺少 --conclusion：这一轮的结论是什么");
  if (changes === undefined) throw new Error("缺少 --changes：「+新增 / 已解除 / 继续」的待裁变化");
  const next = appendRound(text, id, {
    number: number === undefined || number === null ? undefined : Number(number),
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

export function editEntry({
  root = process.cwd(),
  id,
  values = {},
  normalise = false,
  relocate = false,
  batch = null,
  acceptanceFile = null,
  note,
  dryRun = false,
}) {
  const file = path.join(root, DECISIONS);
  const text = fs.readFileSync(file, "utf8");
  requireEntry(text, id);
  let next = text;
  const report = [];
  if (normalise) {
    const result = normaliseStageEvents(next, id);
    next = result.text;
    report.push(
      `阶段事件整理：${result.order.length} 条（${result.order.join(" / ")}），去重 ${result.removed} 条`,
    );
  }
  if (relocate) {
    const result = distributeStageEvents(next, id);
    next = result.text;
    report.push(`阶段事件按阶段归位：${result.placed.length} 条`);
  }
  if (Object.keys(values).length > 0) {
    const result = editEntryFields(next, id, values);
    next = result.text;
    report.push(`字段改动：${result.changed.join("、")}`);
  }
  if (batch) {
    next = replaceBatch(next, id, batch);
    report.push(`批次指针：${batch}`);
  }
  if (acceptanceFile) {
    const file = path.resolve(root, acceptanceFile);
    const source = fs.readFileSync(file, "utf8").split("\n");
    const items = source.map((line) => line.trim()).filter((line) => line.startsWith("- ["));
    if (items.length === 0)
      throw new Error(`${acceptanceFile} 里没有验收项：每行写成「- [ ] 验证什么，怎么验」`);
    const result = replaceAcceptance(next, id, items);
    next = result.text;
    report.push(`验收项：${result.replaced} 条替换为 ${result.written} 条`);
  }
  if (note) {
    next = addUpdateNote(next, id, note);
    report.push("追加一行说明");
  }
  if (next === text) {
    throw new Error(
      "没有任何改动：给出 --blocker / --ask / --conclusion / --batch / --acceptance-from / --normalise-events / --distribute-events / --note 之一",
    );
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
    recordRound({
      root,
      id,
      conclusion: `暂停（${today}）：${why}`,
      changes: "无（暂停；未产生新的待裁项）",
      date: today,
    });
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
    recordRound({
      root,
      id,
      conclusion: `恢复（${today}）：继续讨论`,
      changes: "无（恢复；待裁清单不变）",
      date: today,
    });
  }
  return { id, report: result.report };
}

export function restoreDecisions({ root = process.cwd(), from, dryRun = false }) {
  if (!from || !String(from).trim())
    throw new Error("缺少 --from <commit>：恢复要指明从哪个提交取条目");
  let text;
  try {
    text = execFileSync(resolveGitExecutable(), ["show", `${from}:docs/DECISIONS.md`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    throw new Error(`读不到 ${from}:docs/DECISIONS.md：确认这个提交里有条目文件`);
  }
  const current = fs.readFileSync(path.join(root, DECISIONS), "utf8");
  const report = checkDecisionEntries(text, { previous: current });
  if (report.errors.length > 0) {
    throw new Error(`恢复目标不合法（没有写盘）：${report.errors.join("；")}`);
  }
  commit(root, text, { dryRun });
  return { from };
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  try {
    if (command === "restore") {
      const result = restoreDecisions({
        root,
        from: flags.from,
        dryRun: flags["dry-run"] === true,
      });
      console.log(`已从 ${result.from} 恢复 docs/DECISIONS.md（经命令写入并留印记）`);
      return 0;
    }
    if (command === "edit") {
      const values = {};
      if (typeof flags.blocker === "string") values.blocker = flags.blocker;
      if (typeof flags.ask === "string") values.pending = flags.ask;
      else if (typeof flags.pending === "string") values.pending = flags.pending;
      if (typeof flags.conclusion === "string") values.conclusion = flags.conclusion;
      const result = editEntry({
        root,
        id: flags.entry,
        values,
        batch: typeof flags.batch === "string" ? flags.batch : null,
        acceptanceFile:
          typeof flags["acceptance-from"] === "string" ? flags["acceptance-from"] : null,
        normalise: flags["normalise-events"] === true,
        relocate: flags["distribute-events"] === true || flags["relocate-events"] === true,
        note: typeof flags.note === "string" ? flags.note : null,
        dryRun: flags["dry-run"] === true,
      });
      console.log(`${result.id}：${result.report.join("；")}`);
      return 0;
    }
    if (command === "acceptance") {
      const result = editEntry({
        root,
        id: flags.entry,
        acceptanceFile: flags.from,
        dryRun: flags["dry-run"] === true,
      });
      console.log(`${result.id}：${result.report.join("；")}`);
      return 0;
    }
    if (command === "pause" || command === "resume") {
      const result =
        command === "pause"
          ? pauseEntry({
              root,
              id: flags.entry,
              reason: flags.reason,
              date: flags.date,
              dryRun: flags["dry-run"] === true,
            })
          : resumeEntry({
              root,
              id: flags.entry,
              date: flags.date,
              dryRun: flags["dry-run"] === true,
            });
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
        number: flags.number,
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
    if (command === "wait") {
      const action = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
      const target = flags.entry;
      if (!target) throw new Error("缺少 --entry：待裁项挂在一条条目上");
      if (action !== "add" && action !== "drop")
        throw new Error('用法：decision -- wait add|drop --entry <D-…> --item "T…"');
      if (typeof flags.item !== "string") throw new Error("缺少 --item：写「T1 问题…」或编号 T1");
      const file = path.join(root, DECISIONS);
      const text = fs.readFileSync(file, "utf8");
      const result =
        action === "add"
          ? addWaitingItem(text, target, flags.item)
          : dropWaitingItem(text, target, flags.item);
      const next = result.text;
      const report = checkDecisionEntries(next);
      if (report.errors.length > 0) {
        throw new Error(`写入前校验失败（条目没有改动）：${report.errors.join("；")}`);
      }
      fs.writeFileSync(file, next, "utf8");
      stampWrite(root, next);
      console.log(
        action === "add"
          ? `${target}：已加待裁项 ${result.line}`
          : `${target}：已移除 ${result.removed}`,
      );
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
        design: flags.design,
        newBatch: flags["new-batch"],
        date: flags.date,
        dryRun: flags["dry-run"] === true,
      });
      console.log(`${result.id}：${result.from} → ${result.to}（${result.transition}）`);
      return 0;
    }
    console.error(
      "用法：npm run decision -- <round|settle|advance|edit|pause|resume> --entry <D-…> …",
    );
    return 2;
  } catch (error) {
    console.error(`decision：${error.message}`);
    return 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith("decision.mjs")) {
  process.exitCode = main();
}
