// Agent state CLI: the sessions the agent is running, the tasks in flight, the
// findings a reviewer raised, and the signature that closes a round. Adapter
// layer: owns paths, JSON IO and the npm printout; the rules live in
// governance/core/state.mjs.
import fs from "node:fs";
import path from "node:path";
import {
  STATES,
  PACK_BY_STATE,
  STATE_VERSION,
  activeThread,
  addFindings,
  addRound,
  addTask,
  addWait,
  archiveSession,
  archiveThread,
  briefLines,
  completeTask,
  disposeFinding,
  dropWait,
  emptyState,
  ensureThread,
  findTask,
  focusSession,
  listSessions,
  logOf,
  nextAction,
  openFindings,
  overallReady,
  parseFindingSpec,
  parseTaskSpec,
  phasesOf,
  planTasks,
  progressLines,
  recordReview,
  resumeThread,
  reviewBrief,
  segmentReady,
  setScope,
  setState,
  signScope,
  startSession,
  summaryLines,
  switchSession,
  taskFromFinding,
  tasksInPhase,
  threadById,
  upgradeState,
  validateState,
  workProgress,
} from "../governance/core/state.mjs";
import { missingGates } from "../governance/core/packs.mjs";
import { RULES } from "./governance.mjs";

function loadPack(root, file) {
  const full = path.join(root, "governance", "noema", "workflow", `${file}.md`);
  try {
    return { text: fs.readFileSync(full, "utf8") };
  } catch {
    return null;
  }
}

function checkPackGates(text) {
  return missingGates(
    text,
    RULES.map((rule) => rule.id),
  );
}

const STATE_PATH = "governance/data/state.json";
const HISTORY_PATH = "governance/data/history.json";

function historyFile(root) {
  return path.join(root, HISTORY_PATH);
}

function lockFile(root) {
  return path.join(root, ".work", "locks", "governance-state.lock");
}

// 同一时间只允许一个进程改状态：抢锁失败给出明确提示，而不是互相覆盖。
function withLock(root, run) {
  const file = lockFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const started = Date.now();
  let handle = null;
  while (handle === null) {
    try {
      handle = fs.openSync(file, "wx");
      fs.writeSync(handle, String(process.pid));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const age = Date.now() - fs.statSync(file).mtimeMs;
        const pid = Number(fs.readFileSync(file, "utf8"));
        let alive = true;
        try {
          process.kill(pid, 0);
        } catch {
          alive = false;
        }
        stale = age > 60000 || !alive;
      } catch {
        stale = true;
      }
      if (stale) {
        fs.rmSync(file, { force: true });
        continue;
      }
      if (Date.now() - started > 10000) {
        throw new Error("另一个进程正在写状态（.work/locks/governance-state.lock）");
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return run();
  } finally {
    fs.closeSync(handle);
    fs.rmSync(file, { force: true });
  }
}

function loadHistory(root) {
  const file = historyFile(root);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function appendHistory(root, entry) {
  const entries = loadHistory(root);
  entries.push(entry);
  const file = historyFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

const USAGE = [
  "用法：",
  "  npm run state                                  # 当前会话、下一步、最近变化与该状态的规则包",
  '  npm run state -- start "要交付什么" [--discuss]  # 开一个会话；默认直接执行',
  "  npm run state -- sessions                      # 所有会话（含已归档）",
  "  npm run state -- switch S2                     # 切到另一个会话，数据不动",
  "  npm run state -- close                         # 归档当前会话，写入 history.json",
  '  npm run state -- set <讨论|执行|验收> --reason "为什么换"',
  '  npm run state -- scope "这次交付什么" [--kind 里程碑|修复]',
  '  npm run state -- round --conclusion "这轮定了什么" [--change "+新增 / 已解除"]',
  '  npm run state -- wait add --item "要定什么"    # 或 wait drop --item …',
  "  npm run state -- tasks plan tasks.txt          # 按文本规范导入任务（阶段可选）",
  '  npm run state -- task add --text "做什么" --standard "做完的标准" [--phase 阶段名]',
  '  npm run state -- task done T1 --evidence "跑过的命令/文件名/看到的输出"',
  "  npm run state -- review brief [--scope 段 --phase 阶段名]   # 给审查者的任务书",
  '  npm run state -- review log --scope 段 --phase 阶段名 --from findings.txt [--extra "特别检查"]',
  "  npm run state -- review log --scope 总体 --from findings.txt",
  "  npm run state -- review list                   # 审查记录与发现",
  "  npm run state -- finding task F1               # 从发现派生一条修复任务",
  '  npm run state -- finding fix|defer|accept F1 --note "为什么" [--evidence "改在哪里"]',
  '  npm run state -- sign "用户原话"               # 只有验收态、且没有未处置发现时能签',
  "  npm run state -- work                          # 全部会话的任务、证据、发现",
  "  npm run state -- next | brief | json | verify | log",
];

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = value;
    index += 1;
  }
  return flags;
}

function stateFile(root) {
  return path.join(root, STATE_PATH);
}

export function loadState(root) {
  const file = stateFile(root);
  if (!fs.existsSync(file)) return emptyState();
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const doc = upgradeState(raw);
  const errors = validateState(doc);
  if (errors.length > 0) throw new Error(`状态数据不合规：${errors.join("；")}`);
  return doc;
}

export function saveState(root, doc) {
  const errors = validateState(doc);
  if (errors.length > 0) throw new Error(`状态数据不合规：${errors.join("；")}`);
  const file = stateFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const backupDir = path.join(root, ".work", "state-history");
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    fs.copyFileSync(file, path.join(backupDir, `state-${stamp}.json`));
    const backups = fs
      .readdirSync(backupDir)
      .filter((name) => name.startsWith("state-") && name.endsWith(".json"))
      .sort();
    for (const name of backups.slice(0, Math.max(0, backups.length - 20))) {
      fs.rmSync(path.join(backupDir, name), { force: true });
    }
  }
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function commit(root, next, { dryRun = false } = {}) {
  if (dryRun) return next;
  saveState(root, next);
  return next;
}

function packFor(state, root) {
  const pack = loadPack(root, PACK_BY_STATE[state]);
  if (!pack) throw new Error(`找不到「${state}」的规则包（${PACK_BY_STATE[state]}）`);
  return { text: pack.text, missing: checkPackGates(pack.text) };
}

function printSummary(doc, root) {
  console.log(summaryLines(doc).join("\n"));
  const focused = focusSession(doc);
  const others = listSessions(doc).filter(
    (session) => session.id !== focused?.id && session.status === "open",
  );
  if (others.length > 0) {
    console.log(
      `\n其它打开的会话：${others.map((one) => `${one.id}「${one.title}」（${one.state}）`).join("、")}`,
    );
  }
  const next = nextAction(doc);
  console.log(`\n现在该做：${next.label} · ${next.owner}\n  ${next.command}\n  ${next.detail}`);
  const recent = logOf(doc).slice(-3);
  if (recent.length > 0) {
    console.log("\n最近变化：");
    for (const entry of recent) {
      console.log(`- ${entry.date} ${entry.sessionId} ${entry.event}：${entry.detail}`);
    }
  }
  if (!focused) return;
  const { text, missing } = packFor(focused.state, root);
  if (missing.length > 0) {
    console.error(`\n规则包引用了没登记的门：${missing.join("、")}`);
    process.exitCode = 1;
  }
  console.log(`\n===== ${focused.state} 规则包 =====\n${text.trim()}`);
}

function printWork(doc) {
  const sessions = doc.sessions ?? [];
  if (sessions.length === 0) {
    console.log("还没有会话。");
    return;
  }
  for (const session of sessions) {
    const mark = session.id === doc.focus ? "← 当前" : "";
    console.log(`${session.id}「${session.title}」· ${session.state} · ${session.status} ${mark}`);
    console.log(
      `  范围：${session.scope ? `${session.scope.text}（${session.scope.kind}）` : "还没写"}`,
    );
    const phases = phasesOf(session);
    const ungrouped = tasksInPhase(session, null);
    if (phases.length === 0 && ungrouped.length === 0) console.log("  （还没有任务）");
    for (const task of ungrouped) {
      console.log(`  ${task.status === "已完成" ? "[x]" : "[ ]"} ${task.id} ${task.text}`);
      console.log(`      标准：${task.standard}`);
      if (task.evidence.length > 0) console.log(`      证据：${task.evidence.join("；")}`);
    }
    for (const phase of phases) {
      const tasks = tasksInPhase(session, phase);
      const done = tasks.filter((task) => task.status === "已完成").length;
      const reviewed = session.reviews.some((one) => one.scope === "段" && one.phase === phase);
      console.log(`  阶段「${phase}」 ${done}/${tasks.length}${reviewed ? " · 已审" : ""}`);
      for (const task of tasks) {
        console.log(`    ${task.status === "已完成" ? "[x]" : "[ ]"} ${task.id} ${task.text}`);
        console.log(`        标准：${task.standard}`);
        if (task.evidence.length > 0) console.log(`        证据：${task.evidence.join("；")}`);
      }
    }
    if (session.reviews.length > 0) {
      console.log(
        `  审查：${session.reviews.map((one) => `${one.id}(${one.scope}${one.phase ? ` ${one.phase}` : ""})`).join("、")}`,
      );
    }
    const findings = session.findings;
    for (const finding of findings) {
      const where = finding.scope === "段" ? `段 ${finding.phase}` : "总体";
      const tail = finding.status === "未处置" ? "" : ` → ${finding.status}：${finding.note}`;
      console.log(`  ${finding.id} [${where}] ${finding.text}${tail}`);
    }
    if (session.sign) console.log(`  已签收（${session.sign.date}）：${session.sign.text}`);
  }
  const open = openFindings(doc);
  if (open.length > 0) console.log(`\n未处置的审查发现：${open.map((one) => one.id).join("、")}`);
}

function requireState(argv) {
  const value = argv[1];
  if (!value || !STATES.includes(value)) {
    throw new Error(`要写状态：${STATES.join(" / ")}`);
  }
  return value;
}

function readInput(value) {
  if (typeof value !== "string") return "";
  if (fs.existsSync(value)) return fs.readFileSync(value, "utf8");
  if (/\.(md|txt)$/iu.test(value)) {
    throw new Error(
      `找不到文件「${value}」：空清单也要先建一个空文件，否则这串路径会被当成一条发现`,
    );
  }
  return value;
}

const READ_ONLY = new Set([
  "show",
  "work",
  "log",
  "thread",
  "json",
  "brief",
  "next",
  "verify",
  "sessions",
]);

export function main(argv, root = process.cwd()) {
  const [command = "show"] = argv;
  if (READ_ONLY.has(command)) return dispatch(argv, root);
  return withLock(root, () => dispatch(argv, root));
}

function dispatch(argv, root = process.cwd()) {
  const [command = "show", ...rest] = argv;
  const flags = parseFlags(rest);
  const dryRun = Boolean(flags["dry-run"]);
  let doc = loadState(root);
  const positional = rest.find(
    (token) =>
      !token.startsWith("--") &&
      ![
        "add",
        "drop",
        "plan",
        "brief",
        "list",
        "log",
        "task",
        "fix",
        "defer",
        "accept",
        "done",
      ].includes(token),
  );

  if (command === "show") {
    printSummary(doc, root);
    return;
  }

  if (command === "start") {
    const result = startSession(doc, {
      title: typeof flags.title === "string" ? flags.title : positional,
      discuss: Boolean(flags.discuss),
    });
    doc = commit(root, result.doc, { dryRun });
    console.log(
      `已开会话 ${result.session.id}「${result.session.title}」（${result.session.state}）`,
    );
    console.log(summaryLines(doc).join("\n"));
    return;
  }

  if (command === "switch" || command === "open") {
    const result = switchSession(doc, { id: typeof flags.id === "string" ? flags.id : positional });
    doc = commit(root, result.doc, { dryRun });
    console.log(
      `已切到 ${result.session.id}「${result.session.title}」（${result.session.state}）`,
    );
    console.log(summaryLines(doc).join("\n"));
    return;
  }

  if (command === "sessions") {
    const rows = listSessions(doc);
    if (rows.length === 0) {
      console.log('还没有会话：npm run state -- start "要交付什么"');
      return;
    }
    for (const row of rows) {
      const mark = row.focused ? "← 当前" : "";
      const state = row.status === "archived" ? "已归档" : row.state;
      const signed = row.signed ? " · 已签收" : "";
      console.log(
        `${row.id}「${row.title}」· ${state} · 任务 ${row.tasksDone}/${row.tasks} · 未处置 ${row.openFindings}${signed} ${mark}`,
      );
    }
    return;
  }

  if (command === "close" || command === "clean") {
    const session = focusSession(doc);
    if (!session) throw new Error("没有打开的会话可归档");
    const before = {
      sessionId: session.id,
      title: session.title,
      state: session.state,
      scope: session.scope?.text ?? null,
      signed: session.sign?.date ?? null,
      tasks: session.tasks.length,
      done: session.tasks.filter((task) => task.status === "已完成").length,
      findings: session.findings.length,
      open: session.findings.filter((one) => one.status === "未处置").length,
      closedAt: new Date().toISOString(),
    };
    const result = archiveSession(doc, {
      reason: typeof flags.reason === "string" ? flags.reason : "这个会话的交付已经结束",
    });
    appendHistory(root, before);
    doc = commit(root, result.doc, { dryRun });
    console.log(
      `已归档 ${before.sessionId}「${before.title}」${before.signed ? "（已签收）" : "（未签收）"}，写入 governance/data/history.json`,
    );
    console.log('焦点已清空；下一件事用 npm run state -- start "要交付什么"');
    return;
  }

  if (command === "sign") {
    const text = typeof flags.text === "string" ? flags.text : positional;
    const result = signScope(doc, { text });
    doc = commit(root, result.doc, { dryRun });
    console.log(`已签收（${result.session.sign.date}）：${result.session.sign.text}`);
    return;
  }

  if (command === "set") {
    const to = requireState([command, ...rest]);
    const result = setState(doc, {
      to,
      reason: flags.reason,
      obligation: typeof flags.obligation === "string" ? flags.obligation : null,
    });
    doc = commit(root, result.doc, { dryRun });
    const entry = result.session.log[result.session.log.length - 1];
    console.log(`状态：${entry.detail}（${entry.reason}，${entry.date}）`);
    console.log(summaryLines(doc).join("\n"));
    return;
  }

  if (command === "round") {
    const result = addRound(doc, {
      conclusion: flags.conclusion,
      change: typeof flags.change === "string" ? flags.change : null,
    });
    doc = commit(root, result.doc, { dryRun });
    console.log(
      `第 ${result.round.n} 轮已记录（${result.round.date}）：${result.round.conclusion}`,
    );
    return;
  }

  if (command === "wait") {
    const action = rest.find((token) => token === "add" || token === "drop");
    const item = flags.item ?? flags.text;
    if (action === "add") {
      doc = commit(root, addWait(doc, { item }).doc, { dryRun });
      const thread = activeThread(doc);
      console.log(`待裁：${thread.waits.join("；")}`);
      return;
    }
    if (action === "drop") {
      const result = dropWait(doc, { item });
      doc = commit(root, result.doc, { dryRun });
      console.log("已移除一条待裁。");
      return;
    }
    throw new Error("wait 后面要写 add 或 drop");
  }

  if (command === "archive") {
    const ending = typeof flags.ending === "string" ? flags.ending : "归档";
    const result = archiveThread(doc, {
      id: typeof flags.id === "string" ? flags.id : null,
      ending,
    });
    doc = commit(root, result.doc, { dryRun });
    console.log(`讨论线 ${result.thread.id} 已归档（${ending}）`);
    return;
  }

  if (command === "resume") {
    const result = resumeThread(doc, { id: typeof flags.id === "string" ? flags.id : null });
    doc = commit(root, result.doc, { dryRun });
    console.log(`讨论线 ${result.thread.id} 已恢复（第 ${result.thread.rounds.length} 轮）`);
    return;
  }

  if (command === "scope") {
    const kind = typeof flags.kind === "string" ? flags.kind : "里程碑";
    const result = setScope(doc, { text: positional, kind });
    doc = commit(root, result.doc, { dryRun });
    console.log(`范围（${result.scope.kind}）：${result.scope.text}`);
    return;
  }

  if (command === "tasks") {
    const action = rest[0];
    if (action === "plan") {
      const file = typeof flags.from === "string" ? flags.from : positional;
      const spec = readInput(file);
      const parsed = parseTaskSpec(spec);
      if (parsed.length === 0)
        throw new Error(
          "没有解析出任务：每条形如 - [ ] 任务名，缩进写 标准： 与 证据：，可选 阶段：",
        );
      for (const item of parsed) {
        if (item.standard.trim().length === 0)
          throw new Error(`任务「${item.text}」缺少标准：标准：这一条要写清楚`);
      }
      const result = planTasks(doc, { tasks: parsed });
      doc = commit(root, result.doc, { dryRun });
      console.log(
        `已导入 ${result.tasks.length} 条任务：${result.tasks.map((one) => one.id).join("、")}`,
      );
      return;
    }
    throw new Error("tasks 后面要写 plan");
  }

  if (command === "task") {
    const action = rest.find((token) => token === "add" || token === "done");
    if (action === "add") {
      const result = addTask(doc, {
        text: flags.text,
        standard: flags.standard,
        phase: typeof flags.phase === "string" ? flags.phase : null,
      });
      doc = commit(root, result.doc, { dryRun });
      console.log(
        `任务 ${result.task.id} 已追加：${result.task.text}（标准：${result.task.standard}）`,
      );
      return;
    }
    if (action === "done") {
      const id = (typeof flags.id === "string" ? flags.id : (positional ?? "")).replace(
        /^--id=/,
        "",
      );
      const evidence = typeof flags.evidence === "string" ? flags.evidence : null;
      const result = completeTask(doc, { id, evidence: evidence ? [evidence] : [] });
      doc = commit(root, result.doc, { dryRun });
      console.log(`任务 ${result.task.id} 已完成（证据：${result.task.evidence.join("；")}）`);
      console.log(progressLines(doc).join(" · "));
      return;
    }
    throw new Error("task 后面要写 add 或 done");
  }

  if (command === "review") {
    const action = rest.find((token) => token === "brief" || token === "log" || token === "list");
    if (action === "brief") {
      const scope = typeof flags.scope === "string" ? flags.scope : "总体";
      const phase = typeof flags.phase === "string" ? flags.phase : null;
      console.log(reviewBrief(doc, { scope, phase }));
      return;
    }
    if (action === "list") {
      const session = focusSession(doc);
      if (!session) {
        console.log("没有打开的会话。");
        return;
      }
      if (session.reviews.length === 0) console.log("还没有审查记录。");
      for (const review of session.reviews) {
        const where = review.scope === "段" ? `段 ${review.phase}` : "总体";
        console.log(`${review.id} ${where}（${review.at.slice(0, 10)}）`);
        for (const finding of session.findings.filter((one) => one.reviewId === review.id)) {
          const tail = finding.status === "未处置" ? "" : ` → ${finding.status}`;
          console.log(`  ${finding.id} ${finding.text}${tail}`);
        }
      }
      return;
    }
    if (action === "log") {
      const scope = typeof flags.scope === "string" ? flags.scope : "总体";
      const phase = typeof flags.phase === "string" ? flags.phase : null;
      const source = readInput(flags.from);
      const parsed = parseFindingSpec(source);
      const review = recordReview(doc, {
        scope,
        phase,
        extra: typeof flags.extra === "string" ? flags.extra : null,
      });
      doc = review.doc;
      let added = [];
      if (parsed.length > 0) {
        const result = addFindings(doc, {
          findings: parsed,
          reviewId: review.review.id,
        });
        doc = result.doc;
        added = result.findings;
      }
      doc = commit(root, doc, { dryRun });
      console.log(
        `审查 ${review.review.id}（${scope}${phase ? ` ${phase}` : ""}）已记录${added.length > 0 ? `，发现 ${added.map((one) => one.id).join("、")}` : "，没有发现"}`,
      );
      if (review.review.brief) {
        const lines = review.review.brief
          .split("\n")
          .filter((row) => row.startsWith("##") || row.startsWith("- "));
        console.log(`\n审的是（任务书摘要）：\n${lines.slice(0, 8).join("\n")}`);
      }
      if (added.length > 0) {
        console.log(
          `\n发现要逐条处置：npm run state -- finding fix|defer|accept ${added[0].id} --note "为什么"`,
        );
      }
      return;
    }
    throw new Error("review 后面要写 brief / log / list");
  }

  if (command === "finding") {
    const action = rest.find((token) => ["fix", "defer", "accept", "task"].includes(token));
    if (action === "task") {
      const id = typeof flags.id === "string" ? flags.id : positional;
      const result = taskFromFinding(doc, { id });
      doc = commit(root, result.doc, { dryRun });
      console.log(`已从发现 ${id} 派生任务 ${result.task.id}：${result.task.text}`);
      return;
    }
    const decision = { fix: "已修", defer: "延期", accept: "接受" }[action];
    if (!decision) throw new Error("finding 后面要写 task / fix / defer / accept");
    const id = typeof flags.id === "string" ? flags.id : positional;
    const result = disposeFinding(doc, {
      id,
      decision,
      note: typeof flags.note === "string" ? flags.note : null,
      evidence: typeof flags.evidence === "string" ? flags.evidence : null,
    });
    doc = commit(root, result.doc, { dryRun });
    console.log(`发现 ${result.finding.id}：${decision}（${result.finding.note}）`);
    return;
  }

  if (command === "next") {
    const next = nextAction(doc);
    console.log(`${next.label} · ${next.owner}\n  ${next.command}\n  ${next.detail}`);
    return;
  }

  if (command === "brief") {
    console.log(briefLines(doc).join("\n"));
    return;
  }

  if (command === "json") {
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  if (command === "verify") {
    const session = focusSession(doc);
    const findings = openFindings(doc);
    const where = session ? `${session.id}「${session.title}」· ${session.state}` : "无活动会话";
    const done = session ? session.tasks.filter((task) => task.status === "已完成").length : 0;
    console.log(
      `状态数据合规（版本 ${STATE_VERSION}）：${where}，任务 ${done}/${session?.tasks.length ?? 0}，未处置发现 ${findings.length} 条`,
    );
    return;
  }

  if (command === "work") {
    printWork(doc);
    return;
  }

  if (command === "log") {
    const limit = Number(flags.limit ?? 10);
    const entries = logOf(doc).slice(-(Number.isFinite(limit) && limit > 0 ? limit : 10));
    if (entries.length === 0) {
      console.log("还没有变化记录");
      return;
    }
    for (const entry of entries) {
      console.log(`${entry.date} ${entry.sessionId} ${entry.event}：${entry.detail}`);
    }
    return;
  }

  if (command === "title") {
    const text = positional;
    if (!text) throw new Error("要写会话名");
    const session = focusSession(doc);
    if (!session) throw new Error("没有打开的会话");
    session.title = text;
    doc = commit(root, doc, { dryRun });
    console.log(`会话 ${session.id}：${text}`);
    return;
  }

  if (command === "thread") {
    const id = flags.id;
    const thread = id ? threadById(doc, String(id)) : activeThread(doc);
    if (!thread) throw new Error("没有活动讨论线");
    console.log(`${thread.id}｜${thread.title}｜${thread.status}｜第 ${thread.rounds.length} 轮`);
    for (const round of thread.rounds.slice(-5)) console.log(`- ${round.n}. ${round.conclusion}`);
    console.log(`待裁：${thread.waits.length === 0 ? "无" : thread.waits.join("；")}`);
    return;
  }

  console.error(USAGE.join("\n"));
  process.exitCode = 2;
}

if (process.argv[1] && process.argv[1].endsWith("state.mjs")) {
  try {
    main(process.argv.slice(2), process.env.NOEMA_STATE_ROOT ?? process.cwd());
  } catch (error) {
    console.error(`state: ${error.message}`);
    process.exitCode = 1;
  }
}
