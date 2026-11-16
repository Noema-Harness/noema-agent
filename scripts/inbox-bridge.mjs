// Inbox bridge: the repo side of any external-event source.
//
// Owns: turning one poller's stdout into pending events, and keeping the
// delivered/handled state the agent loop needs (a notice is injected once, then
// it stays quiet until it is handled).
// Does not own: fetching the source (the poller does), scheduling (the DSH
// plugin does), or deciding what "handled" means for the work itself.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STATE_REL = join(".work", "inbox-bridge", "state.json");
const POLLER_REL = join("scripts", "github-inbox.mjs");

export const STATUSES = ["pending", "delivered", "done"];

/** Read the bridge state; a missing or broken file means "nothing handled yet". */
export function readState(file) {
  if (!existsSync(file)) return { events: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const events = parsed && typeof parsed.events === "object" ? parsed.events : {};
    return { events };
  } catch {
    return { events: {} };
  }
}

/** Merge status changes into the state and write it back. */
export function transition(state, keys, status, at) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status: ${status}`);
  const events = { ...(state?.events ?? {}) };
  const marked = [];
  for (const key of keys ?? []) {
    if (typeof key !== "string" || key.length === 0) continue;
    const current = events[key]?.status;
    // Never move a handled event back to pending or delivered.
    if (current === "done" && status !== "done") continue;
    if (current === status) continue;
    events[key] = { status, at };
    marked.push(key);
  }
  return { state: { events }, marked };
}

/** Split the poller's events into the ones still worth injecting and the rest. */
export function classify(events, state) {
  const pending = [];
  const delivered = [];
  const done = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event.key !== "string") continue;
    const status = state?.events?.[event.key]?.status ?? "pending";
    if (status === "done") done.push(event);
    else if (status === "delivered") delivered.push(event);
    else pending.push(event);
  }
  return { pending, delivered, done };
}

/** Run the poller and return its fresh events (no state involved). */
export function pollEvents(root, options = {}) {
  const poller = resolve(root, POLLER_REL);
  if (!existsSync(poller)) throw new Error(`missing poller: ${poller}`);
  const exec = options.execFile ?? execFileSync;
  const stdout = exec(process.execPath, [poller, "--poll", "--json", "--quiet", "--no-toast"], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    timeout: options.timeoutMs ?? 45_000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  const payload = JSON.parse(String(stdout));
  const fresh = Array.isArray(payload?.fresh) ? payload.fresh : [];
  return fresh.filter((event) => event && typeof event.key === "string");
}

export function describeEvent(event) {
  const kind = event.kind ?? "event";
  const ref = event.ref ? `${event.ref} ` : "";
  const url = event.url ? ` ${event.url}` : "";
  return `[${kind}] ${ref}${event.title ?? ""}${url}`;
}

function safePoll(root) {
  try {
    return pollEvents(root);
  } catch (error) {
    process.stderr.write(
      `inbox-bridge: poll skipped (${error instanceof Error ? error.message : String(error)})\n`,
    );
    return null;
  }
}

function main(argv) {
  const root = process.cwd();
  const stateFile = resolve(root, STATE_REL);
  const command = argv[0] ?? "list";
  const flags = argv.slice(1);
  const at = new Date().toISOString();
  const json = flags.includes("--json");

  if (command === "poll") {
    const events = safePoll(root);
    if (events === null) {
      process.stdout.write(`${JSON.stringify({ events: [], skipped: true })}\n`);
      return 0;
    }
    const { pending } = classify(events, readState(stateFile));
    process.stdout.write(`${JSON.stringify({ events: pending })}\n`);
    return 0;
  }

  if (command === "ack") {
    const fromEnv = process.env.INBOX_BRIDGE_KEYS ? JSON.parse(process.env.INBOX_BRIDGE_KEYS) : [];
    const fromArgs = flags.filter((flag) => !flag.startsWith("--"));
    const keys = [...fromEnv, ...fromArgs];
    const done = flags.includes("--done");
    const { state, marked } = transition(
      readState(stateFile),
      keys,
      done ? "done" : "delivered",
      at,
    );
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ marked, status: done ? "done" : "delivered" })}\n`);
    return 0;
  }

  if (command === "list") {
    const events = safePoll(root);
    if (events === null) {
      process.stdout.write("inbox-bridge: skipped（拉取来源失败；gh 未登录或离线？）\n");
      return 0;
    }
    const state = readState(stateFile);
    const groups = classify(events, state);
    if (json) {
      process.stdout.write(`${JSON.stringify({ ...groups, state }, null, 2)}\n`);
      return 0;
    }
    const lines = [];
    for (const status of STATUSES) {
      const rows = groups[status];
      if (rows.length === 0) continue;
      lines.push(`${status} (${rows.length})`);
      for (const row of rows) lines.push(`  ${describeEvent(row)}`);
    }
    if (lines.length === 0) lines.push("没有待处理事件。");
    lines.push("", "处理完用 npm run inbox:ack -- <key> 标记完成。");
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  process.stderr.write(`usage: node scripts/inbox-bridge.mjs [poll|list|ack] [--json] [--done]\n`);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
