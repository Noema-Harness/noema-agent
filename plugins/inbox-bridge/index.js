/**
 * Inbox bridge for DeepSeek Harness.
 *
 * Owns: polling one external source on an interval, injecting new events into
 * the next admitted agent step as a notice-form context, and remembering what
 * was delivered so the same notice is not injected twice. Delivery is not the
 * end: the agent must mark an event done (`npm run inbox:ack --done -- <key>`);
 * if it stays delivered for `resurfaceMs` the notice comes back once.
 * Does not own: fetching the source (the configured poller does), the meaning of
 * "handled" (the ack command decides), or waking an idle agent — inject never
 * wakes the driver.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const name = "inbox-bridge";
export const inject = ["agents"];

const DEFAULTS = Object.freeze({
  label: "外部收件箱",
  cwd: process.cwd(),
  repo: null,
  intervalMs: 120_000,
  timeoutMs: 45_000,
  maxEvents: 6,
  /** delivered-but-unhandled events come back after this long */
  resurfaceMs: 6 * 60 * 60 * 1000,
  /** one reminder at most this often when the workspace has no repo */
  offlineReminderMs: 12 * 60 * 60 * 1000,
  poll: { command: "node", args: ["scripts/inbox-bridge.mjs", "poll"] },
  ack: { command: "node", args: ["scripts/inbox-bridge.mjs", "ack"] },
});

export function apply(ctx, config) {
  const options = mergeConfig(config);
  const logPath = join(options.cwd, ".work", "inbox-bridge", "plugin.log");
  const agents = new Set();
  let timer;
  let polling = false;
  let lastOfflineNoticeAt = 0;

  const log = (line) => {
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // Logging must never break polling.
    }
  };

  const announceOffline = (reason) => {
    const now = Date.now();
    if (now - lastOfflineNoticeAt < options.offlineReminderMs) return;
    lastOfflineNoticeAt = now;
    const text = formatOfflineNotice(options, reason);
    for (const agent of agents) {
      try {
        agent.inject(buildMessage(0, text, options.label));
      } catch (error) {
        log(`offline inject failed: ${describe(error)}`);
      }
    }
    log(`injected offline reminder: ${reason}`);
  };

  const poll = async () => {
    if (polling || agents.size === 0) return;
    polling = true;
    try {
      const payload = await pollEvents(options);
      if (payload.skipped) {
        // No source at all: tell the user once in a while instead of failing silently.
        if (!options.repo) announceOffline(payload.skipped);
        return;
      }
      const events = payload.events;
      if (events.length === 0) return;
      const text = formatEvents(events, options);
      let delivered = 0;
      for (const agent of agents) {
        try {
          agent.inject(buildMessage(events.length, text, options.label));
          delivered += 1;
        } catch (error) {
          log(`inject failed: ${describe(error)}`);
        }
      }
      if (delivered > 0) {
        log(`injected ${events.length} event(s) into ${delivered} agent(s)`);
        await ackEvents(options, events, "delivered");
        // Infrastructure failures cannot be fixed by a code change: report once.
        const infra = events.filter((event) => event.kind === "infra");
        if (infra.length > 0) await ackEvents(options, infra, "done");
      }
    } catch (error) {
      log(`poll skipped: ${describe(error)}`);
    } finally {
      polling = false;
    }
  };

  const register = (agent) => {
    if (!agent || agents.has(agent)) return;
    agents.add(agent);
    agent.ctx.effect(() => () => {
      agents.delete(agent);
    });
    if (!timer) {
      timer = setInterval(() => {
        void poll();
      }, options.intervalMs);
      timer.unref?.();
      void poll();
    }
  };

  for (const agent of ctx.agents.list()) register(agent);
  ctx.on("agent/created", ({ agent }) => register(agent));

  ctx.effect(() => () => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    agents.clear();
  });
}

export function mergeConfig(config) {
  const given = config ?? {};
  const repo = given.repo ?? detectRepo(given.cwd ?? DEFAULTS.cwd);
  return {
    ...DEFAULTS,
    ...given,
    repo,
    poll: { ...DEFAULTS.poll, ...(given.poll ?? {}) },
    ack: { ...DEFAULTS.ack, ...(given.ack ?? {}) },
  };
}

/** `owner/name` from `git remote get-url origin`, or null when not connected. */
export function detectRepo(cwd) {
  try {
    const { execFileSync } = require("node:child_process");
    const url = String(
      execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    ).trim();
    const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/u.exec(url);
    return match ? `${match[1]}/${match[2]}` : null;
  } catch {
    return null;
  }
}

async function pollEvents(options) {
  const stdout = await runCommand(options.poll, options);
  const payload = JSON.parse(stdout);
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return {
    events: events.filter((event) => event && typeof event.key === "string"),
    skipped: payload?.skipped ?? null,
  };
}

async function ackEvents(options, events, status) {
  if (events.length === 0) return;
  try {
    await runCommand(options.ack, options, {
      INBOX_BRIDGE_KEYS: JSON.stringify(events.map((event) => event.key)),
      ...(status === "done" ? { INBOX_BRIDGE_DONE: "1" } : {}),
    });
  } catch (error) {
    // Delivering the notice matters more than the bookkeeping; the next poll
    // injects the same event again rather than losing it.
    throw new Error(`ack failed: ${describe(error)}`);
  }
}

function runCommand(spec, options, extraEnv = {}) {
  const command = spec.command ?? "node";
  const args = Array.isArray(spec.args) ? spec.args : [];
  const useNode = command === "node";
  const ackArgs =
    useNode && (spec.args ?? []).includes("ack")
      ? [...args, ...(extraEnv.INBOX_BRIDGE_DONE === "1" ? ["--done"] : [])]
      : args;
  return new Promise((resolve, reject) => {
    execFile(
      useNode ? process.execPath : command,
      ackArgs,
      {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...(useNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          ...(options.repo ? { NOEMA_INBOX_REPO: options.repo } : {}),
          ...extraEnv,
        },
        timeout: options.timeoutMs,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || stdout || "").trim().slice(0, 200);
          reject(new Error(`${error.message}${detail ? `: ${detail}` : ""}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export function formatOfflineNotice(options, reason) {
  const where = options.repo ? `仓库 ${options.repo}` : "本地工作区";
  return [
    `${options.label ?? "外部收件箱"}：收件箱暂时不可用（${where}，${reason}）。`,
    "",
    "如果这是工作区没有连接 GitHub 仓库：请告诉用户——把工作区指向已连接的仓库目录，或在插件配置里设置 `repoPath`/`repo`；否则不会收到该仓库的任何通知。",
    "如果是 gh 未登录或离线：告知用户后继续手头工作，不必现在修。",
  ].join("\n");
}

export function formatEvents(events, options = DEFAULTS) {
  const maxEvents = options.maxEvents ?? 6;
  const lines = events.slice(0, maxEvents).map((event) => `- ${describeEvent(event)}`);
  if (events.length > maxEvents)
    lines.push(`- 其余 ${events.length - maxEvents} 条见 \`npm run inbox\``);
  return [
    `${options.label ?? "外部收件箱"}（后台轮询，不是用户提问）：`,
    ...lines,
    "",
    "只在它影响当前工作时处理；处理完运行 `npm run inbox:ack --done -- <key>` 标记完成。",
    "只标 delivered 的事件会在 6 小时后再次提醒；`kind: infra` 的基础设施失败只提醒一次。",
  ].join("\n");
}

export function buildMessage(count, text, label = "外部收件箱") {
  const summary = count > 0 ? `${label}有 ${count} 条新事件` : `${label}需要你注意`;
  return {
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "inbox-bridge", form: "notice", summary },
  };
}

function describeEvent(event) {
  const kind = event.kind ?? "event";
  const ref = event.ref ? `${event.ref} ` : "";
  const url = event.url ? ` ${event.url}` : "";
  return `[${kind}] ${ref}${event.title ?? ""}${url} · key: ${event.key}`;
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
