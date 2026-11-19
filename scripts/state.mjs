// Agent state CLI: what the agent is doing right now, and the discussion
// session that belongs to it. Adapter layer: owns paths, JSON IO and the npm
// printout; the rules live in governance/core/state.mjs.
import fs from "node:fs";
import path from "node:path";
import {
  STATES,
  PACK_BY_STATE,
  STATE_VERSION,
  activeThread,
  archiveWork,
  briefLines,
  nextAction,
  openFindings,
  startPhase,
  addAcceptance,
  addPhase,
  addRound,
  addTask,
  addWait,
  archiveThread,
  completePhase,
  completeTask,
  dropWait,
  emptyState,
  emptyWork,
  ensureThread,
  findPhase,
  logOf,
  progressLines,
  resolveFinding,
  reviewPhase,
  resumeThread,
  setAcceptance,
  setScope,
  setState,
  signScope,
  summaryLines,
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
  "  npm run state                              # 当前状态、会话、待裁、最近切换与规则包",
  '  npm run state -- set <讨论|执行|验收> --reason "为什么切换" [--scope changes/<name>] [--obligation 关闭|挂起]',
  '  npm run state -- round --conclusion "这一轮的结论" [--change "+新增 / 已解除"]',
  '  npm run state -- title "会话主题"',
  '  npm run state -- wait add --item "T1 要定什么"',
  "  npm run state -- wait drop --item T1",
  "  npm run state -- archive [--ending 定案|归档]",
  "  npm run state -- resume [--id thread-…]",
  "  npm run state -- log [--limit N]",
  '  npm run state -- scope "这次做什么（范围）"',
  '  npm run state -- phase add --name "阶段交付什么" [--goal "目标"]',
  '  npm run state -- phase check --id P1 [--what "这一阶段验什么"] [--gap "可能漏什么"] [--split "要不要拆/并"]',
  "  npm run state -- phase done --id P1",
  "  npm run state -- phase list",
  '  npm run state -- task add --phase P1 --text "一句话交付物"',
  '  npm run state -- task done --id P1-T1 [--evidence "命令+结果"]',
  '  npm run state -- accept add --phase P1 --text "这一条怎么算过" [--layer D|C|R|H]',
  '  npm run state -- accept set --id P1-A1 --status 通过|不通过 [--evidence "证据"]',
  "  npm run state -- work                      # 范围 / 阶段 / 任务 / 阶段验收的进度",
  "  npm run state -- next                      # 只打印下一步该做什么",
  "  npm run state -- brief                     # 交接卡：给下一个会话的最小上下文",
  "  npm run state -- json                      # 原始状态数据",
  "  npm run state -- verify                    # 机器校验状态数据，出错退 1",
  "  npm run state -- phase start --id P1       # 显式开始一个阶段",
  '  npm run state -- scope "范围" --kind 修复 # 范围类型：里程碑 / 修复',
  "  npm run state -- clean                     # 签收后归档并重置工作区",
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
  const next = nextAction(doc);
  console.log(`\n现在该做：${next.label}\n  ${next.command}`);
  const recent = logOf(doc, { limit: 3 });
  if (recent.length > 0) {
    console.log("\n最近切换：");
    for (const entry of recent) {
      const from = entry.from ?? "起始";
      console.log(
        `- ${entry.date} ${from} → ${entry.to}（${entry.obligation}）：${entry.reason}${entry.threadId ? ` · ${entry.threadId}` : ""}`,
      );
    }
  }
  const { text, missing } = packFor(doc.current.state, root);
  if (missing.length > 0) {
    console.error(`\n规则包引用了没登记的门：${missing.join("、")}`);
    process.exitCode = 1;
  }
  console.log(`\n===== ${doc.current.state} 规则包 =====\n${text.trim()}`);
}

function printWork(doc) {
  const progress = workProgress(doc);
  console.log(progressLines(doc).join("\n"));
  const phases = doc.work?.phases ?? [];
  if (phases.length === 0) {
    console.log('\n还没有阶段：npm run state -- phase add --name "…"');
    return;
  }
  for (const phase of phases) {
    console.log(
      `\n${phase.id} ${phase.name}（${phase.status}）${phase.goal ? ` — ${phase.goal}` : ""}`,
    );
    for (const task of phase.tasks) {
      console.log(`  ${task.status === "已完成" ? "[x]" : "[ ]"} ${task.id} ${task.text}`);
    }
    if (phase.tasks.length === 0) console.log("  （还没有任务）");
    if (phase.review) {
      const review = phase.review;
      if (review.what) console.log(`  重审·验什么：${review.what}`);
      if (review.gap) console.log(`  重审·可能漏：${review.gap}`);
      if (review.split) console.log(`  重审·划分：${review.split}`);
    }
    if (phase.acceptance.length > 0) {
      const layers = ["D", "C", "H", "R"];
      for (const layer of layers) {
        const items = phase.acceptance.filter((item) => (item.layer ?? "D") === layer);
        if (items.length === 0) continue;
        const label = layer === "R" ? "审查发现（不判通过）" : `${layer} 层`;
        console.log(`  ${label}：${items.map((item) => `${item.id}=${item.status}`).join("、")}`);
      }
    }
  }
  const failed = progress.acceptance.failed;
  if (failed > 0) console.log(`\n不通过 ${failed} 项：回执行修，修完重判`);
}

function requireState(argv) {
  const value = argv[1];
  if (!value || !STATES.includes(value)) {
    throw new Error(`要写状态：${STATES.join(" / ")}`);
  }
  return value;
}

const READ_ONLY = new Set(["show", "work", "log", "thread", "json", "brief", "next", "verify"]);

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

  if (command === "show") {
    if (!doc.threads.length && doc.current.state === "讨论") {
      const seed = ensureThread(doc, { title: flags.title ?? null });
      doc = seed.doc;
      commit(root, doc, { dryRun });
    }
    printSummary(doc, root);
    return;
  }

  if (command === "sign") {
    const text = flags.text ?? rest.find((token) => !token.startsWith("--"));
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
    console.log(`会话 ${result.thread.id} 已归档（${ending}）`);
    return;
  }

  if (command === "resume") {
    const result = resumeThread(doc, { id: typeof flags.id === "string" ? flags.id : null });
    doc = commit(root, result.doc, { dryRun });
    console.log(`会话 ${result.thread.id} 已恢复（第 ${result.thread.rounds.length} 轮）`);
    return;
  }

  if (command === "scope") {
    const text = rest.find((token) => !token.startsWith("--"));
    const kind = typeof flags.kind === "string" ? flags.kind : "里程碑";
    const result = setScope(doc, { text, kind });
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
    const findings = openFindings(doc);
    console.log(
      `状态数据合规（版本 ${STATE_VERSION}）：${doc.current.state}，阶段 ${doc.work.phases.length} 个，未处置发现 ${findings.length} 条`,
    );
    return;
  }

  if (command === "clean") {
    const result = archiveWork(doc);
    appendHistory(root, result.entry);
    doc = commit(root, result.doc, { dryRun });
    console.log(`已归档：${result.entry.scope}（${result.entry.signed.date} 签收）`);
    console.log("工作区已重置为空白；历史写入 governance/data/history.json");
    return;
  }

  if (command === "phase") {
    const action = rest[0];
    if (action === "add") {
      const result = addPhase(doc, {
        name: flags.name,
        goal: typeof flags.goal === "string" ? flags.goal : null,
      });
      doc = commit(root, result.doc, { dryRun });
      console.log(`阶段 ${result.phase.id} 已建立：${result.phase.name}`);
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
      console.log(`阶段 ${result.phase.id} 已记重审（验什么 / 可能漏什么 / 要不要拆并）`);
      return;
    }
    if (action === "start") {
      const result = startPhase(doc, { id: flags.id });
      doc = commit(root, result.doc, { dryRun });
      console.log(`阶段 ${result.phase.id} 已开始`);
      return;
    }
    if (action === "done") {
      const result = completePhase(doc, { id: flags.id });
      doc = commit(root, result.doc, { dryRun });
      console.log(`阶段 ${result.phase.id} 已完成`);
      return;
    }
    if (action === "list" || action === undefined) {
      printWork(doc);
      return;
    }
    throw new Error("phase 后面要写 add / done / list");
  }

  if (command === "task") {
    const action = rest[0];
    if (action === "add") {
      const result = addTask(doc, { phase: flags.phase, text: flags.text });
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
        phase: flags.phase,
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
    throw new Error("accept 后面要写 add / set / resolve");
  }

  if (command === "work") {
    printWork(doc);
    return;
  }

  if (command === "log") {
    const limit = Number(flags.limit ?? 10);
    const entries = logOf(doc, { limit: Number.isFinite(limit) && limit > 0 ? limit : 10 });
    if (entries.length === 0) {
      console.log("还没有切换记录");
      return;
    }
    for (const entry of entries) {
      const from = entry.from ?? "起始";
      console.log(`${entry.date} ${from} → ${entry.to}（${entry.obligation}）：${entry.reason}`);
    }
    return;
  }

  if (command === "title") {
    const text = rest.find((token) => !token.startsWith("--"));
    if (!text) throw new Error("要写会话标题");
    const { thread } = ensureThread(doc);
    thread.title = text;
    doc = commit(root, doc, { dryRun });
    console.log(`会话 ${thread.id} 标题：${text}`);
    return;
  }

  if (command === "thread") {
    const id = flags.id;
    const thread = id ? threadById(doc, String(id)) : activeThread(doc);
    if (!thread) throw new Error("没有活动会话");
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
