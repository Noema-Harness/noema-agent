// Renders the governance state into a single static console page.
// Adapter only: reads governance/data/state.json and writes
// .work/review/work-view.html. The model lives in governance/core/state.mjs.
//
// What the page must answer at a glance, in this order:
//   1. which state the work is in, and how the session stands (rounds, waits)
//   2. the scope this round is judged against
//   3. where we are among the acceptance units, and how each one is doing
//   4. the single next command
// Detail is not shown by default; a unit opens on demand. Shapes carry the
// four acceptance layers, fill carries progress, colour carries verdict.
import fs from "node:fs";
import path from "node:path";

import {
  nextAction,
  upgradeState,
  validateState,
  workProgress,
} from "../governance/core/state.mjs";

const STATE_PATH = "governance/data/state.json";
const OUTPUT_PATH = ".work/review/work-view.html";

const STATES = ["讨论", "执行", "验收"];
const STATE_CODE = { 讨论: "DISCUSS", 执行: "EXECUTE", 验收: "ACCEPT" };

// A layer is a shape, not a word: square, circle, diamond, triangle.
const LAYER_SHAPE = { D: "▢", C: "○", R: "◇", H: "△" };
const LAYER_NAME = { D: "确定性检查", C: "判据对照", R: "审查发现", H: "人签收" };

function escape(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function verdict(status) {
  if (status === "通过" || status === "已完成") return "ok";
  if (status === "不通过") return "bad";
  return "idle";
}

function taskBar(tasks) {
  if (!tasks.length) return `<span class="bar empty" aria-hidden="true"></span>`;
  const cells = tasks
    .map(
      (task) =>
        `<span class="cell${task.status === "已完成" ? " done" : ""}" title="${escape(
          `${task.status === "已完成" ? "✓" : "·"} ${task.text}${task.evidence?.length ? `\n${task.evidence.join("\n")}` : ""}`,
        )}"></span>`,
    )
    .join("");
  return `<span class="bar" aria-label="任务 ${tasks.filter((task) => task.status === "已完成").length}/${tasks.length}">${cells}</span>`;
}

function layerRow(acceptance) {
  const byLayer = new Map();
  for (const item of acceptance) {
    const layer = item.layer ?? "D";
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(item);
  }
  return `<span class="layers">${["D", "C", "R", "H"]
    .map((layer) => {
      const items = byLayer.get(layer) ?? [];
      if (!items.length)
        return `<span class="layer idle" title="${LAYER_NAME[layer]}：无">${LAYER_SHAPE[layer]}</span>`;
      const state = items.some((item) => item.status === "不通过")
        ? "bad"
        : items.every((item) => item.status === "通过" || Boolean(item.resolution))
          ? "ok"
          : "idle";
      const detail = items
        .map((item) => {
          const resolved = item.resolution
            ? ` → ${item.resolution.decision}${item.resolution.note ? `（${item.resolution.note}）` : ""}`
            : "";
          const evidence = item.evidence?.length ? `\n${item.evidence.join("\n")}` : "";
          return `${item.status}${resolved}\n${item.text}${evidence}`;
        })
        .join("\n\n");
      return `<span class="layer ${state}" title="${LAYER_NAME[layer]}：${escape(detail)}">${LAYER_SHAPE[layer]}</span>`;
    })
    .join("")}</span>`;
}

function drawer(phase) {
  const tasks = phase.tasks ?? [];
  const acceptance = phase.acceptance ?? [];
  const taskRows = tasks
    .map(
      (task) => `<li class="detail${task.status === "已完成" ? " done" : ""}">
        <span class="glyph">${task.status === "已完成" ? "✓" : "·"}</span>
        <span class="text">${escape(task.text)}</span>
        ${task.evidence?.length ? `<span class="evidence">${task.evidence.map(escape).join("<br>")}</span>` : ""}
      </li>`,
    )
    .join("");
  const acceptanceRows = acceptance
    .map((item) => {
      const layer = item.layer ?? "D";
      const tone = verdict(item.status);
      const resolution = item.resolution
        ? `<span class="note">${escape(item.resolution.decision)}${
            item.resolution.note ? ` · ${escape(item.resolution.note)}` : ""
          }</span>`
        : "";
      return `<li class="detail ${tone}" data-layer="${LAYER_NAME[layer]}">
        <span class="glyph">${LAYER_SHAPE[layer]}</span>
        <span class="text">${escape(item.text)}${resolution}</span>
        <span class="evidence">${
          item.evidence?.length ? item.evidence.map(escape).join("<br>") : "还没有证据"
        }</span>
      </li>`;
    })
    .join("");
  const review = phase.review
    ? `<li class="detail muted">
        <span class="glyph">↻</span>
        <span class="text">${escape(phase.review.what)} · ${escape(phase.review.gap)} · ${escape(phase.review.split)}</span>
      </li>`
    : "";
  if (!taskRows && !acceptanceRows && !review) return "";
  return `<div class="drawer"><ul class="details">${taskRows}${acceptanceRows}${review}</ul></div>`;
}

function unitRow(phase, currentId, index) {
  const tasks = phase.tasks ?? [];
  const acceptance = phase.acceptance ?? [];
  const blocking = acceptance.filter((item) => (item.layer ?? "D") !== "R");
  const passed = blocking.filter((item) => item.status === "通过").length;
  const isCurrent = phase.id === currentId;
  const done = phase.status === "已完成";
  const stateName = done ? "done" : isCurrent ? "live" : "idle";
  const milestone = done
    ? `<span class="badge ok">✓</span>`
    : isCurrent && blocking.length
      ? `<span class="badge live">${passed}/${blocking.length}</span>`
      : `<span class="badge"></span>`;
  return `<li class="unit ${stateName}" data-phase="${escape(phase.id)}">
    <button class="unit-row" type="button" aria-expanded="false" aria-controls="drawer-${escape(phase.id)}">
      <span class="index">${String(index + 1).padStart(2, "0")}</span>
      <span class="name">${escape(phase.name)}</span>
      ${taskBar(tasks)}
      ${layerRow(acceptance)}
      ${milestone}
      <span class="chevron" aria-hidden="true">▾</span>
    </button>
    <div class="drawer-wrap" id="drawer-${escape(phase.id)}">${drawer(phase)}</div>
  </li>`;
}

function stateStrip(current) {
  return `<nav class="states" aria-label="治理状态">${STATES.map((state) => {
    const active = state === current;
    return `<span class="state${active ? " on" : ""}"${active ? ` aria-current="true"` : ""}>
      <span class="dot" aria-hidden="true"></span>
      <span class="word">${escape(state)}</span>
      <span class="code">${STATE_CODE[state]}</span>
    </span>`;
  }).join('<span class="state-link" aria-hidden="true"></span>')}</nav>`;
}

function logTicks(log, now) {
  const recent = [...log].slice(-8).reverse();
  if (!recent.length) return `<span class="tick-line" aria-hidden="true"></span>`;
  return `<span class="tick-line">${recent
    .map(
      (entry, index) =>
        `<span class="tick${index === 0 ? " latest" : ""}" title="${escape(entry.reason ?? "")} · ${escape(
          entry.at ?? "",
        )}"></span>`,
    )
    .join("")}</span>`;
}

/**
 * @param {object} doc state document
 * @param {Date} now render time
 * @returns {string} complete HTML page
 */
export function renderView(doc, now = new Date()) {
  validateState(doc);
  const progress = workProgress(doc);
  const state = doc.current.state;
  const action = nextAction(doc);
  const scope = doc.work?.scope ?? null;
  const phases = doc.work?.phases ?? [];
  const current = phases.find((phase) => phase.status === "进行中");
  const thread = doc.current.threadId
    ? doc.threads.find((entry) => entry.id === doc.current.threadId)
    : null;
  const meta = [
    thread ? `${thread.rounds?.length ?? 0} 轮` : "没有会话",
    thread?.waits?.length ? `${thread.waits.length} 待裁` : "",
    `${progress.phases.done}/${progress.phases.total} 单元`,
  ]
    .filter(Boolean)
    .join(" · ");
  const scopeLine = scope
    ? `<span class="scope-kind">${escape(scope.kind)}</span><span class="scope-text">${escape(scope.text)}</span>`
    : `<span class="scope-kind">范围</span><span class="scope-text empty">npm run state -- scope "…"</span>`;
  const actionBlock = action
    ? `<button class="action" type="button" data-copy="${escape(action.command)}" title="${escape(
        `${action.label} · ${action.detail}`,
      )}">
        <span class="action-tag">下一步</span>
        <code class="action-cmd">${escape(action.command)}</code>
        <span class="action-mark" aria-hidden="true">⧉</span>
      </button>`
    : "";
  const stamp = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(
    now.getHours(),
  ).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const units = phases.length
    ? `<ol class="units" aria-label="验收单元">${phases
        .map((phase, index) => unitRow(phase, current?.id ?? null, index))
        .join("")}</ol>`
    : `<p class="blank">还没有验收单元。范围定了以后用 <code>npm run state -- phase add --name "…"</code> 拆单元。</p>`;

  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Noema · 治理</title>
<style>
:root {
  --bg: #08090b;
  --ink: #e9edf2;
  --ink-2: #aeb7c2;
  --muted: #5d6673;
  --line: #171b21;
  --line-2: #232a33;
  --accent: #f0b429;
  --ok: #58c08a;
  --bad: #ef6a5c;
  --panel: #0e1216;
  --mono: "JetBrains Mono", "Cascadia Mono", "Consolas", ui-monospace, monospace;
  --sans: "Segoe UI Variable", "Segoe UI", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
}
html[data-theme="light"] {
  --bg: #f3f0e9; --ink: #12161a; --ink-2: #39424b; --muted: #7d858f;
  --line: #e2ddd1; --line-2: #d5cfc1; --accent: #8f5d00; --ok: #1c744f; --bad: #a33529; --panel: #fbf9f4;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--ink); font: 14px/1.55 var(--sans); -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
button:focus-visible { outline: 1px solid var(--accent); outline-offset: 3px; }
code, .mono { font-family: var(--mono); }

.shell {
  max-width: 940px; margin: 0 auto; padding: 26px 30px 22px;
  min-height: 100vh; display: grid; grid-template-rows: auto auto 1fr auto auto; gap: 0;
}

/* top: identity, state, session */
.bar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 10px; font: 11px var(--mono); letter-spacing: .34em; color: var(--ink-2); }
.brand::before { content: ""; width: 7px; height: 18px; background: var(--accent); clip-path: polygon(0 0, 100% 22%, 100% 100%, 0 78%); }
.states { display: flex; align-items: center; gap: 0; margin-left: 6px; }
.state { display: flex; align-items: baseline; gap: 7px; padding: 5px 13px 5px 11px; border: 1px solid var(--line-2); color: var(--muted); position: relative; }
.state + .state { border-left: 0; }
.state .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; opacity: .35; align-self: center; }
.state .word { font-size: 12px; letter-spacing: .08em; }
.state .code { font: 8px var(--mono); letter-spacing: .2em; opacity: .55; }
.state.on { color: var(--bg); background: var(--accent); border-color: var(--accent); }
.state.on .dot { opacity: 1; background: var(--bg); box-shadow: 0 0 0 3px color-mix(in srgb, var(--bg) 35%, transparent); animation: beat 2.6s ease-in-out infinite; }
.state.on .code { opacity: .7; }
.state-link { width: 10px; height: 1px; background: var(--line-2); }
.meta { font: 10px var(--mono); color: var(--muted); letter-spacing: .08em; margin-left: auto; }
.theme { width: 28px; height: 28px; display: grid; place-items: center; color: var(--muted); border: 1px solid transparent; transition: color .25s, transform .6s, border-color .25s; }
.theme:hover { color: var(--accent); transform: rotate(180deg); border-color: var(--line-2); }

/* scope: the sentence this round is judged against */
.scope { display: flex; gap: 10px; align-items: baseline; margin: 22px 0 0; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.scope-kind { font: 9px var(--mono); letter-spacing: .22em; color: var(--muted); border: 1px solid var(--line-2); padding: 2px 6px; flex: none; }
.scope-text { font-size: 13px; color: var(--ink-2); }
.scope-text.empty { font-family: var(--mono); font-size: 12px; color: var(--muted); }

/* the units: one row each, shape and fill tell the story */
.units { list-style: none; margin: 8px 0 0; padding: 0; flex: 1; display: flex; flex-direction: column; justify-content: space-evenly; }\nmain { display: flex; flex-direction: column; min-height: 0; }
.unit { position: relative; border-bottom: 1px solid var(--line); animation: rise .5s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i, 0) * 45ms); }
.unit-row {
  display: grid; grid-template-columns: 34px minmax(0, 1fr) auto auto 42px 14px;
  align-items: center; column-gap: 16px; width: 100%; text-align: left; padding: 15px 8px 15px 4px;
  transition: background .25s, padding-left .25s;
}
.unit-row:hover { background: color-mix(in srgb, var(--accent) 4%, transparent); padding-left: 8px; }
.unit.live .unit-row { background: color-mix(in srgb, var(--accent) 7%, transparent); padding-top: 26px; padding-bottom: 26px; }\n.unit.live::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px; background: var(--accent); }\n.unit.idle .unit-row { opacity: .62; }\n.unit.idle .unit-row:hover { opacity: 1; }\n.unit.live .name { font-size: 16px; letter-spacing: .01em; }\n.unit.live .layers { font-size: 16px; gap: 14px; }\n.unit.live .bar { min-width: 72px; }\n.unit.live .index { color: var(--accent); }
.index { font: 11px var(--mono); letter-spacing: .12em; color: var(--muted); }
.name { font-size: 14px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: color .25s; }
.unit.done .name { color: var(--muted); }
.unit.live .name { color: var(--ink); }
.unit-row:hover .name { color: var(--ink); }

.bar { display: flex; gap: 3px; align-items: center; min-width: 64px; }
.bar.empty { min-width: 0; }
.cell { width: 14px; height: 5px; border: 1px solid var(--line-2); background: transparent; transition: background .3s, border-color .3s; }
.cell.done { background: var(--ink-2); border-color: transparent; }\n.bar.empty { font: 11px var(--mono); color: var(--muted); opacity: .5; }
.unit.live .cell.done { background: var(--accent); }

.layers { display: flex; gap: 11px; font: 13px var(--mono); color: var(--line-2); }
.layer.ok { color: var(--ok); }
.layer.bad { color: var(--bad); }
.layer.idle { color: var(--muted); }
.layer { transition: color .25s, transform .25s; }
.unit-row:hover .layer { transform: translateY(-1px); }

.badge { font: 10px var(--mono); color: var(--muted); text-align: right; letter-spacing: .06em; }\n.chevron { font-size: 9px; color: var(--muted); opacity: 0; transition: opacity .25s, transform .35s; }\n.unit-row:hover .chevron, .unit.open .chevron { opacity: .8; }\n.unit.open .chevron { transform: rotate(180deg); }
.badge.ok { color: var(--ok); font-size: 12px; }
.badge.live { color: var(--accent); }

/* the unit opens only when asked for */
.drawer-wrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .5s cubic-bezier(.2,.8,.2,1); }
.unit.open .drawer-wrap { grid-template-rows: 1fr; }
.drawer { overflow: hidden; }
.details { list-style: none; margin: 0 0 14px 50px; padding: 0; }
.drawer-wrap:has(.drawer:empty) { display: none; }
.detail { position: relative; display: flex; gap: 12px; align-items: baseline; padding: 7px 10px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
.detail.done { color: var(--ink-2); }
.detail.ok { color: var(--ink); }
.detail.ok .glyph { color: var(--ok); }
.detail.bad { color: var(--bad); }
.detail.bad .glyph { color: var(--bad); }
.detail .glyph { width: 14px; flex: none; font: 11px var(--mono); color: var(--muted); }
.detail .text { flex: 1; min-width: 0; }
.detail .note { color: var(--muted); font-size: 11px; margin-left: 8px; }
.evidence {
  position: absolute; left: 40px; top: calc(100% - 2px); z-index: 6;
  max-width: min(560px, 74vw); padding: 9px 12px;
  background: var(--panel); border: 1px solid var(--line-2); border-left: 2px solid var(--accent);
  color: var(--ink-2); font: 11px/1.7 var(--mono);
  opacity: 0; transform: translateY(-5px); pointer-events: none;
  transition: opacity .2s, transform .2s;
  box-shadow: 0 22px 48px -26px rgba(0,0,0,.65);
}
.detail:hover .evidence, .detail:focus-within .evidence { opacity: 1; transform: translateY(0); pointer-events: auto; }

/* the next command sits at the seam between the units and the log */
.action {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; column-gap: 12px; align-items: baseline;
  margin: 18px 0 0; padding: 12px 15px; text-align: left;
  border-left: 2px solid var(--accent);
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 12%, transparent), transparent 72%);
  transition: background .3s, transform .3s;
}
.action:hover { transform: translateX(3px); background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 18%, transparent), transparent 78%); }
.action-tag { font: 9px var(--mono); letter-spacing: .26em; color: var(--muted); align-self: center; }
.action-cmd { font-size: 12px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.action-mark { font-size: 12px; color: var(--accent); opacity: .5; transition: opacity .25s; }
.action:hover .action-mark { opacity: 1; }
.action.copied { border-left-color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
.action.copied .action-mark { color: var(--ok); opacity: 1; }

/* bottom: how we got here, as ticks instead of a paragraph */
.foot { display: flex; align-items: center; gap: 14px; padding-top: 20px; margin-top: auto; font: 10px var(--mono); color: var(--muted); letter-spacing: .06em; }
.tick-line { display: flex; gap: 5px; align-items: center; flex: 1; }
.tick-line::before, .tick-line::after { content: ""; height: 1px; background: var(--line-2); flex: 1; }
.tick { width: 2px; height: 9px; background: var(--line-2); transition: background .2s, height .2s; }
.tick:hover { background: var(--accent); height: 14px; }
.tick.latest { background: var(--accent); height: 14px; }
.blank { color: var(--muted); font-size: 13px; padding: 26px 4px; }
.blank code { color: var(--ink-2); }

@keyframes rise { from { transform: translateY(8px); } to { transform: none; } }
@keyframes beat { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--bg) 22%, transparent); } }

@media (max-width: 680px) {
  .shell { padding: 20px 16px 18px; }
  .bar { gap: 8px; }
  .state { padding: 4px 9px; }
  .state .code { display: none; }
  .state .word { font-size: 11px; }
  .meta { order: 3; margin-left: 0; flex-basis: 100%; }
  .theme { margin-left: auto; }
  .units { margin-top: 6px; }
  .unit-row { grid-template-columns: 26px minmax(0, 1fr) auto; row-gap: 6px; column-gap: 10px; }
  .bar { grid-column: 2 / -1; }
  .layers { grid-column: 2 / -1; }
  .badge { position: absolute; right: 4px; top: 13px; }
  .details { margin-left: 0; }
  .action { align-items: start; }
  .action-cmd { white-space: normal; overflow-wrap: anywhere; }
  .evidence { left: 0; max-width: calc(100vw - 52px); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
</style>
</head>
<body>
<div class="shell">
  <header class="bar">
    <span class="brand">NOEMA</span>
    ${stateStrip(state)}
    <span class="meta">${escape(meta)}</span>
    <button class="theme" type="button" title="明暗（T）" aria-label="切换明暗">◐</button>
  </header>

  <p class="scope">${scopeLine}</p>

  <main>${units}</main>

  ${actionBlock}

  <footer class="foot">
    <span>${escape(stamp)}</span>
    ${logTicks(doc.log ?? [], now)}
    <span>state v${escape(doc.version)}</span>
  </footer>
</div>
<script>
(() => {
  const root = document.documentElement;
  const saved = localStorage.getItem("noema-work-theme");
  if (saved) root.dataset.theme = saved;
  const theme = document.querySelector(".theme");
  const flip = () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem("noema-work-theme", next);
  };
  theme.addEventListener("click", flip);
  document.addEventListener("keydown", (event) => {
    if (event.key === "t" || event.key === "T") flip();
  });

  const rows = [...document.querySelectorAll(".unit-row")];
  for (const row of rows) {
    const unit = row.closest(".unit");
    row.addEventListener("click", () => {
      const open = unit.classList.toggle("open");
      row.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  // number keys jump to a unit and open it
  document.addEventListener("keydown", (event) => {
    const n = Number(event.key);
    if (!Number.isInteger(n) || n < 1 || n > rows.length) return;
    if (document.activeElement?.tagName === "INPUT") return;
    const row = rows[n - 1];
    const unit = row.closest(".unit");
    unit.classList.add("open");
    row.setAttribute("aria-expanded", "true");
    row.focus();
    history.replaceState(null, "", "#" + unit.dataset.phase);
  });

  const action = document.querySelector(".action");
  if (action) {
    action.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(action.dataset.copy);
        action.classList.add("copied");
        setTimeout(() => action.classList.remove("copied"), 1400);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(action.querySelector(".action-cmd"));
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
  }
})();
</script>
</body>
</html>`;
}

function loadState(root) {
  const file = path.join(root, STATE_PATH);
  if (!fs.existsSync(file)) {
    throw new Error(`缺少 ${STATE_PATH}：先用 npm run state 记录当前状态`);
  }
  return upgradeState(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function writeView(root = process.cwd(), now = new Date()) {
  const doc = loadState(root);
  const output = path.join(root, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, renderView(doc, now));
  return { output, state: doc.current.state, progress: workProgress(doc) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const result = writeView();
  const { progress } = result;
  console.log(
    `工作台：${path.relative(process.cwd(), result.output)} · 状态 ${result.state} · 单元 ${progress.phases.done}/${progress.phases.total} · 任务 ${progress.tasks.done}/${progress.tasks.total} · 验收 ${progress.acceptance.passed}/${progress.acceptance.total}`,
  );
}
