/**
 * Inbox bridge for DeepSeek Harness.
 *
 * Owns: polling one external source on an interval, injecting new events into
 * the next admitted agent step as a notice-form context, and marking what was
 * delivered so the same notice is not injected twice.
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
  intervalMs: 120_000,
  timeoutMs: 45_000,
  maxEvents: 6,
  poll: { command: "node", args: ["scripts/inbox-bridge.mjs", "poll"] },
  ack: { command: "node", args: ["scripts/inbox-bridge.mjs", "ack"] },
});

export function apply(ctx, config) {
  const options = mergeConfig(config);
  const logPath = join(options.cwd, ".work", "inbox-bridge", "plugin.log");
  const agents = new Set();
  let timer;
  let polling = false;

  const log = (line) => {
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // Logging must never break polling.
    }
  };

  const poll = async () => {
    if (polling || agents.size === 0) return;
    polling = true;
    try {
      const events = await pollEvents(options);
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
        // Mark delivered so the next poll only returns what nobody has seen yet.
        await ackEvents(options, events.map((event) => event.key));
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
  return {
    ...DEFAULTS,
    ...given,
    poll: { ...DEFAULTS.poll, ...(given.poll ?? {}) },
    ack: { ...DEFAULTS.ack, ...(given.ack ?? {}) },
  };
}

async function pollEvents(options) {
  const stdout = await runCommand(options.poll, options);
  const payload = JSON.parse(stdout);
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return events.filter((event) => event && typeof event.key === "string");
}

async function ackEvents(options, keys) {
  if (keys.length === 0) return;
  try {
    await runCommand(options.ack, options, { INBOX_BRIDGE_KEYS: JSON.stringify(keys) });
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
  return new Promise((resolve, reject) => {
    execFile(
      useNode ? process.execPath : command,
      args,
      {
        cwd: options.cwd,
        env: { ...process.env, ...(useNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}), ...extraEnv },
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

export function formatEvents(events, options = DEFAULTS) {
  const maxEvents = options.maxEvents ?? 6;
  const lines = events.slice(0, maxEvents).map((event) => `- ${describeEvent(event)}`);
  if (events.length > maxEvents) lines.push(`- 其余 ${events.length - maxEvents} 条见 \`npm run inbox\``);
  return [
    `${options.label ?? "外部收件箱"}（后台轮询，不是用户提问）：`,
    ...lines,
    "",
    "只在它影响当前工作时处理；处理完用 `npm run inbox:ack -- <key>` 标记完成。",
  ].join("\n");
}

export function buildMessage(count, text, label = "外部收件箱") {
  const summary = count === 1 ? `${label}有 1 条新事件` : `${label}有 ${count} 条新事件`;
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
  return `[${kind}] ${ref}${event.title ?? ""}${url}`;
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
