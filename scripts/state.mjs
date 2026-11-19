// Agent state CLI: what the agent is doing right now, and the discussion
// session that belongs to it. Adapter layer: owns paths, JSON IO and the npm
// printout; the rules live in governance/core/state.mjs.
import fs from "node:fs";
import path from "node:path";
import {
  STATES,
  PACK_BY_STATE,
  activeThread,
  addRound,
  addWait,
  archiveThread,
  dropWait,
  emptyState,
  ensureThread,
  logOf,
  resumeThread,
  setState,
  summaryLines,
  threadById,
  validateState,
} from "../governance/core/state.mjs";
import { checkPackGates, loadPack } from "./stage.mjs";

const STATE_PATH = "governance/data/state.json";

const USAGE = [
  "用法：",
  "  npm run state                              # 当前状态、会话、待裁、最近切换与规则包",
  "  npm run state -- set <讨论|执行|验收> --reason \"为什么切换\" [--scope changes/<name>] [--obligation 关闭|挂起]",
  "  npm run state -- round --conclusion \"这一轮的结论\" [--change \"+新增 / 已解除\"]",
  "  npm run state -- title \"会话主题\"",
  "  npm run state -- wait add --item \"T1 要定什么\"",
  "  npm run state -- wait drop --item T1",
  "  npm run state -- archive [--ending 定案|归档]",
  "  npm run state -- resume [--id thread-…]",
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
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = validateState(doc);
  if (errors.length > 0) throw new Error(`状态数据不合规：${errors.join("；")}`);
  return doc;
}

export function saveState(root, doc) {
  const errors = validateState(doc);
  if (errors.length > 0) throw new Error(`状态数据不合规：${errors.join("；")}`);
  const file = stateFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
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

function requireState(argv) {
  const value = argv[1];
  if (!value || !STATES.includes(value)) {
    throw new Error(`要写状态：${STATES.join(" / ")}`);
  }
  return value;
}

export function main(argv, root = process.cwd()) {
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

  if (command === "set") {
    const to = requireState([command, ...rest]);
    const result = setState(doc, {
      to,
      reason: flags.reason,
      scope: typeof flags.scope === "string" ? flags.scope : null,
      obligation: typeof flags.obligation === "string" ? flags.obligation : null,
    });
    doc = commit(root, result.doc, { dryRun });
    console.log(`状态：${result.log.from} → ${result.log.to}（${result.log.obligation}，${result.log.date}）`);
    console.log(summaryLines(doc).join("\n"));
    return;
  }

  if (command === "round") {
    const result = addRound(doc, {
      conclusion: flags.conclusion,
      change: typeof flags.change === "string" ? flags.change : null,
    });
    doc = commit(root, result.doc, { dryRun });
    console.log(`第 ${result.round.n} 轮已记录（${result.round.date}）：${result.round.conclusion}`);
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
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`state: ${error.message}`);
    process.exitCode = 1;
  }
}