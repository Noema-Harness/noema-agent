// Agent state CLI: the sessions the agent is running, what each one delivers
// and what the next move is. Adapter layer: owns paths, JSON IO and the npm
// printout; the rules live in governance/core/state.mjs.
import fs from "node:fs";
import path from "node:path";
import {
  STATES,
  PACK_BY_STATE,
  STATE_VERSION,
  activeThread,
  addAcceptance,
  addRound,
  addSegment,
  addTask,
  addWait,
  archiveSession,
  archiveThread,
  briefLines,
  completeSegment,
  completeTask,
  currentSegment,
  dropWait,
  emptyState,
  ensureThread,
  findSegment,
  focusSession,
  listSessions,
  logOf,
  nextAction,
  openFindings,
  passHumanAcceptance,
  progressLines,
  resolveFinding,
  reviewPhase,
  resumeThread,
  setAcceptance,
  setAcceptanceText,
  setScope,
  setState,
  signScope,
  startSession,
  startSegment,
  summaryLines,
  switchSession,
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
  "  npm run state                                  # 当前会话、下一步、最近切换与该状态的规则包",
  '  npm run state -- start "要交付什么" [--discuss]  # 开一个会话；直接执行，或先讨论',
  "  npm run state -- sessions                      # 所有会话（含已归档）",
  "  npm run state -- switch S2                     # 切到另一个会话，数据不动",
  "  npm run state -- close                         # 归档当前会话（签收与否都行）",
  '  npm run state -- set <讨论|执行|验收> --reason "为什么换段"',
  '  npm run state -- scope "这次交付什么" [--kind 里程碑|修复]',
  '  npm run state -- segment add --name "这一段交付什么"',
  "  npm run state -- segment start --id P2",
  "  npm run state -- segment done [--id P2]",
  "  npm run state -- segment list                  # 当前会话的所有段与任务",
  '  npm run state -- task add --text "做什么" [--segment P2]',
  '  npm run state -- task done --id P1-T1 --evidence "跑过什么/看到什么"',
  '  npm run state -- accept add --text "怎么算过" [--layer D|C|R|H] [--segment P2]',
  '  npm run state -- accept set --id P1-A1 --status 通过|不通过 --evidence "…"',
  '  npm run state -- accept text --id P1-A1 --text "把判据写准"',
  '  npm run state -- accept human --id P1-A3 --text "用户原话"   # H 层只能这样判',
  '  npm run state -- accept resolve --id P1-A2 --decision 已修|延期|接受 [--note "为什么"]',
  '  npm run state -- round --conclusion "这一轮的结论" [--change "+新增 / 已解除"]',
  '  npm run state -- wait add --item "要定什么"',
  "  npm run state -- wait drop --item T1",
  '  npm run state -- title "会话名"                # 改当前会话的名字',
  '  npm run state -- sign "用户原话"               # 只有验收态能签收',
  "  npm run state -- work                          # 进度：段 / 任务 / 验收",
  "  npm run state -- next                          # 只打印下一步该做什么",
  "  npm run state -- brief                         # 交接卡",
  "  npm run state -- json                          # 原始状态数据",
  "  npm run state -- verify                        # 机器校验状态数据，出错退 1",
  "  npm run state -- log [--limit N]",
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
  if (doc.version !== raw.version) saveState(root, doc);
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
  const others = listSessions(doc).filter(
    (session) => !session.focused && session.status === "open",
  );
  if (others.length > 0) {
    console.log(
      `\n其它打开的会话：${others.map((one) => `${one.id}「${one.title}」（${one.state}）`).join("、")}`,
    );
  }
  const next = nextAction(doc);
  console.log(`\n现在该做：${next.label}\n  ${next.command}\n  ${next.detail}`);
  const recent = logOf(doc).slice(-3);
  if (recent.length > 0) {
    console.log("\n最近变化：");
    for (const entry of recent) {
      const from = entry.from ?? "起始";
      console.log(
        `- ${entry.date} ${entry.from ? `${entry.sessionId} ` : ""}${from} → ${entry.to}：${entry.reason}`,
      );
    }
  }
  const session = focusSession(doc);
  if (!session) return;
  const { text, missing } = packFor(session.state, root);
  if (missing.length > 0) {
    console.error(`\n规则包引用了没登记的门：${missing.join("、")}`);
    process.exitCode = 1;
  }
  console.log(`\n===== ${session.state} 规则包 =====\n${text.trim()}`);
}

function printWork(doc) {
  const session = focusSession(doc);
  if (!session) {
    console.log("没有打开的会话。");
    return;
  }
  console.log(progressLines(doc).join("\n"));
  const segment = currentSegment(doc);
  console.log("");
  for (const one of session.segments) {
    const live = segment?.id === one.id;
    const label = one.name ?? "日常段";
    console.log(`${one.id} ${label}（${one.status}）${live ? " ← 当前" : ""}`);
    for (const task of one.tasks) {
      console.log(`  ${task.status === "已完成" ? "[x]" : "[ ]"} ${task.id} ${task.text}`);
      if (task.status === "已完成" && task.evidence.length > 0)
        console.log(`      证据：${task.evidence.join("；")}`);
    }
    if (one.tasks.length === 0) console.log("  （还没有任务）");
    if (one.review) {
      if (one.review.what) console.log(`  重审·验什么：${one.review.what}`);
      if (one.review.gap) console.log(`  重审·可能漏：${one.review.gap}`);
      if (one.review.split) console.log(`  重审·划分：${one.review.split}`);
    }
    if (one.acceptance.length > 0) {
      for (const item of one.acceptance) {
        const resolution = item.resolution ? ` → ${item.resolution.decision}` : "";
        console.log(`  ${item.id} [${item.layer ?? "D"}] ${item.status}${resolution} ${item.text}`);
      }
    }
  }
  const open = openFindings(doc);
  if (open.length > 0) console.log(`\n未处置的审查发现：${open.map((item) => item.id).join("、")}`);
}

function requireState(argv) {
  const value = argv[1];
  if (!value || !STATES.includes(value)) {
    throw new Error(`要写状态：${STATES.join(" / ")}`);
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
  "segment",
]);

export function main(argv, root = process.cwd()) {
  const [command = "show"] = argv;
  if (READ_ONLY.has(command) && command !== "segment") return dispatch(argv, root);
  if (command === "segment" && argv[1] !== "add" && argv[1] !== "start" && argv[1] !== "done") {
    return dispatch(argv, root);
  }
  return withLock(root, () => dispatch(argv, root));
}

function dispatch(argv, root = process.cwd()) {
  const [command = "show", ...rest] = argv;
  const flags = parseFlags(rest);
  const dryRun = Boolean(flags["dry-run"]);
  let doc = loadState(root);
  const positional = rest.find((token) => !token.startsWith("--"));

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
    const left = result.previous ? `；${result.previous.id} 原样留在后台` : "";
    console.log(
      `已切到 ${result.session.id}「${result.session.title}」（${result.session.state}）${left}`,
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
      console.log(`${row.id}「${row.title}」· ${state} · ${row.done}/${row.total} 段完成 ${mark}`);
      if (row.scope) console.log(`   ${row.scope}`);
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
      signed: session.scope?.signed ?? null,
      segments: session.segments.map((segment) => ({
        id: segment.id,
        name: segment.name,
        status: segment.status,
        tasks: segment.tasks.length,
        done: segment.tasks.filter((task) => task.status === "已完成").length,
      })),
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
    console.log("焦点已清空；下件事用 npm run state -- start「要交付什么」，或 switch 回其它会话");
    return;
  }

  if (command === "sign") {
    const text = typeof flags.text === "string" ? flags.text : positional;
    const result = signScope(doc, { text });
    doc = commit(root, result.doc, { dryRun });
    console.log(`已签收（${result.scope.signed.date}）：${result.scope.signed.text}`);
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
    console.log(
      `状态：${result.log.from} → ${result.log.to}（${result.log.obligation}，${result.log.date}）`,
    );
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
    const action = rest[0];
    const item = flags.item;
    if (action === "add") {
      doc = commit(root, addWait(doc, { item }).doc, { dryRun });
      const thread = activeThread(doc);
      console.log(`待裁：${thread.waits.join("；")}`);
      return;
    }
    if (action === "drop") {
      const result = dropWait(doc, { item });
      doc = commit(root, result.doc, { dryRun });
      const thread = activeThread(doc);
      console.log(`已移除：${result.removed}`);
      console.log(`待裁：${thread.waits.length === 0 ? "无" : thread.waits.join("；")}`);
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

  if (command === "next") {
    const next = nextAction(doc);
    console.log(`${next.label}\n  ${next.command}\n  ${next.detail}`);
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
    console.log(
      `状态数据合规（版本 ${STATE_VERSION}）：${where}，段 ${session?.segments.length ?? 0} 个，未处置发现 ${findings.length} 条`,
    );
    return;
  }

  if (command === "segment" || command === "phase") {
    const action = rest[0];
    if (action === "add") {
      const result = addSegment(doc, {
        name: flags.name,
        goal: typeof flags.goal === "string" ? flags.goal : null,
      });
      doc = commit(root, result.doc, { dryRun });
      console.log(`段 ${result.segment.id} 已建立：${result.segment.name}`);
      return;
    }
    if (action === "check") {
      const result = reviewPhase(doc, {
        id: flags.id,
        what: typeof flags.what === "string" ? flags.what : null,
        gap: typeof flags.gap === "string" ? flags.gap : null,
        split: typeof flags.split === "string" ? flags.split : null,
      });
      doc = commit(root, result.doc, { dryRun });
      console.log(`段 ${result.segment.id} 已记重审（验什么 / 可能漏什么 / 要不要拆并）`);
      return;
    }
    if (action === "start") {
      const result = startSegment(doc, { id: flags.id });
      doc = commit(root, result.doc, { dryRun });
      console.log(`段 ${result.segment.id} 已开始`);
      return;
    }
    if (action === "done") {
      const result = completeSegment(doc, { id: flags.id });
      doc = commit(root, result.doc, { dryRun });
      console.log(`段 ${result.segment.id} 已完成`);
      return;
    }
    if (action === "list" || action === undefined || action === "work") {
      printWork(doc);
      return;
    }
    throw new Error("segment 后面要写 add / start / done / list");
  }

  if (command === "task") {
    const action = rest[0];
    if (action === "add") {
      const result = addTask(doc, {
        text: flags.text,
        segmentId: typeof flags.segment === "string" ? flags.segment : null,
      });
      doc = commit(root, result.doc, { dryRun });
      console.log(`任务 ${result.task.id} 已追加：${result.task.text}`);
      return;
    }
    if (action === "done") {
      const result = completeTask(doc, {
        id: flags.id,
        evidence: typeof flags.evidence === "string" ? flags.evidence : null,
      });
      doc = commit(root, result.doc, { dryRun });
      console.log(`任务 ${result.task.id} 已完成`);
      printWork(doc);
      return;
    }
    throw new Error("task 后面要写 add 或 done");
  }

  if (command === "accept") {
    const action = rest[0];
    if (action === "add") {
      const result = addAcceptance(doc, {
        segmentId: typeof flags.segment === "string" ? flags.segment : null,
        text: flags.text,
        layer: typeof flags.layer === "string" ? flags.layer : "D",
      });
      doc = commit(root, result.doc, { dryRun });
      console.log(`验收项 ${result.item.id}（${result.item.layer} 层）已追加：${result.item.text}`);
      return;
    }
    if (action === "set") {
      const result = setAcceptance(doc, {
        id: flags.id,
        status: flags.status,
        evidence: typeof flags.evidence === "string" ? flags.evidence : null,
      });
      doc = commit(root, result.doc, { dryRun });
      console.log(`验收项 ${result.item.id}：${result.item.status}`);
      return;
    }
    if (action === "text") {
      const result = setAcceptanceText(doc, {
        id: flags.id,
        text: typeof flags.text === "string" ? flags.text : null,
      });
      doc = commit(root, result.doc, { dryRun });
      console.log(`验收项 ${result.item.id} 的判据已改：${result.item.text}`);
      return;
    }
    if (action === "human") {
      const result = passHumanAcceptance(doc, {
        id: flags.id,
        text: typeof flags.text === "string" ? flags.text : null,
      });
      doc = commit(root, result.doc, { dryRun });
      console.log(`验收项 ${result.item.id}：用户签收（H 层）`);
      return;
    }
    if (action === "resolve") {
      const result = resolveFinding(doc, {
        id: flags.id,
        decision: flags.decision,
        note: typeof flags.note === "string" ? flags.note : null,
      });
      doc = commit(root, result.doc, { dryRun });
      console.log(`发现 ${result.item.id} 已处置：${result.item.resolution.decision}`);
      return;
    }
    throw new Error("accept 后面要写 add / set / text / human / resolve");
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
      const from = entry.from ?? "起始";
      console.log(`${entry.date} ${entry.sessionId} ${from} → ${entry.to}：${entry.reason}`);
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
