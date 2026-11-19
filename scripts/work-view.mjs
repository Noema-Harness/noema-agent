// Renders the current agent state and staged work into a single static HTML
// console. Adapter only: reads governance/data/state.json, writes
// .work/review/work-view.html. The state model lives in
// governance/core/state.mjs.
//
// Design intent: one focus (the current phase and the single next action),
// no explanatory copy in the interface, interaction reveals evidence on
// demand. Everything else is cut on purpose.
import fs from "node:fs";
import path from "node:path";

import {
  activeThread,
  nextAction,
  upgradeState,
  validateState,
  workProgress,
} from "../governance/core/state.mjs";

const STATE_PATH = "governance/data/state.json";
const OUTPUT_PATH = ".work/review/work-view.html";

const STATE_CODE = { 讨论: "DISCUSS", 执行: "EXECUTE", 验收: "ACCEPT" };

// Layer is carried by shape, not by a legend: square, circle, diamond, triangle.
const LAYER_SHAPE = { D: "▢", C: "○", R: "◇", H: "△" };
const LAYER_NAME = { D: "确定性检查", C: "可复核", R: "审查发现", H: "人签收" };

function escape(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function tone(status) {
  if (status === "通过" || status === "已完成") return "ok";
  if (status === "不通过") return "bad";
  if (status === "进行中") return "live";
  return "idle";
}

function taskRow(task) {
  const done = task.status === "已完成";
  return `<li class="task${done ? " done" : ""}">
    <span class="mark" aria-hidden="true">${done ? "✓" : ""}</span>
    <span class="task-text">${escape(task.text)}</span>
    ${task.evidence?.length ? `<span class="ev" role="note">${task.evidence.map(escape).join("<br>")}</span>` : ""}
  </li>`;
}

function acceptanceRow(item, phaseId) {
  const layer = item.layer ?? "D";
  const state = tone(item.status);
  const resolution = item.resolution
    ? `<em class="resolution">${escape(item.resolution.decision)}${
        item.resolution.note ? ` · ${escape(item.resolution.note)}` : ""
      }</em>`
    : "";
  const evidence = item.evidence?.length ? item.evidence.map(escape).join("<br>") : "";
  return `<li class="accept ${state}" data-layer="${escape(LAYER_NAME[layer])}">
    <span class="shape shape-${layer}" aria-hidden="true">${LAYER_SHAPE[layer]}</span>
    <span class="accept-text">${escape(item.text)}${resolution}</span>
    <span class="ev" role="note">${evidence || "还没有证据"}</span>
  </li>`;
}

function phaseNode(phase, currentPhase, index) {
  const tasks = phase.tasks ?? [];
  const acceptance = phase.acceptance ?? [];
  const blocking = acceptance.filter((item) => (item.layer ?? "D") !== "R");
  const passed = blocking.filter((item) => item.status === "通过").length;
  const isCurrent = phase.id === currentPhase;
  const open = isCurrent;
  const stateName = phase.status === "已完成" ? "done" : isCurrent ? "live" : "idle";
  const summary =
    phase.status === "已完成"
      ? "✓"
      : isCurrent && blocking.length
        ? `${passed}/${blocking.length}`
        : "";
  const review = phase.review
    ? `<li class="review-line">
        <span>${escape(phase.review.what)}</span>
        <span class="muted">${escape(phase.review.gap)}</span>
        <span class="muted">${escape(phase.review.split)}</span>
      </li>`
    : "";
  return `<li class="node ${stateName}${open ? " open" : ""}" data-phase="${escape(phase.id)}" style="--i:${index}">
    <button class="node-head" type="button" aria-expanded="${open ? "true" : "false"}" aria-controls="body-${escape(phase.id)}">
      <span class="node-dot" aria-hidden="true"></span>
      <span class="node-name">${escape(phase.name)}</span>
      <span class="node-summary">${summary}</span>
    </button>
    <div class="node-body" id="body-${escape(phase.id)}">
      <div class="node-inner">
        ${phase.goal ? `<p class="node-goal">${escape(phase.goal)}</p>` : ""}
        ${tasks.length ? `<ul class="tasks">${tasks.map(taskRow).join("")}</ul>` : ""}
        <ul class="accepts">${acceptance.map((item) => acceptanceRow(item, phase.id)).join("")}</ul>
        ${review ? `<ul class="extras">${review}</ul>` : ""}
      </div>
    </div>
  </li>`;
}

function waitsLine(thread) {
  const waits = thread?.waits ?? [];
  if (!waits.length) return "";
  return `<span class="waits" tabindex="0">
    <span class="waits-mark" aria-hidden="true">◇</span>
    <span class="waits-count">${waits.length}</span>
    <span class="ev waits-ev" role="note">${waits.map(escape).join("<br>")}</span>
  </span>`;
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
  const currentPhase = phases.find((phase) => phase.status === "进行中");
  const focusIndex = String(
    currentPhase ? phases.indexOf(currentPhase) + 1 : phases.length,
  ).padStart(2, "0");
  const focusTotal = String(phases.length).padStart(2, "0");
  const focus = currentPhase ?? phases[phases.length - 1] ?? null;
  const doneRatio = phases.length ? Math.round((progress.phases.done / phases.length) * 100) : 0;
  const thread = doc.current.threadId
    ? doc.threads.find((one) => one.id === doc.current.threadId)
    : activeThread(doc);

  const state_ = STATES_LABEL[state] ?? state;
  const scopeLine = scope
    ? `<p class="scope"><span class="scope-kind">${escape(scope.kind)}</span>${escape(scope.text)}</p>`
    : `<p class="scope empty"><code>npm run state -- scope "…"</code></p>`;

  const actionBlock = action
    ? `<button class="action" type="button" data-copy="${escape(action.command)}" title="${escape(
        `${action.label} · ${action.detail}`,
      )}">
        <span class="action-tag">下一步</span>
        <code class="action-cmd">${escape(action.command)}</code>
        <span class="action-state" aria-hidden="true">⧉</span>
      </button>`
    : "";

  const nowStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(
    2,
    "0",
  )} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Noema · 工作台</title>
<style>
:root {
  --bg: #0a0c0f;
  --ink: #eef2f6;
  --ink-2: #b9c2cc;
  --muted: #66707c;
  --line: #1a2027;
  --line-2: #232b34;
  --accent: #f0b429;
  --ok: #5cc08d;
  --bad: #ef6a5c;
  --panel: #0f141a;
  --mono: "JetBrains Mono", "Cascadia Mono", "Consolas", ui-monospace, monospace;
  --sans: "Segoe UI Variable", "Segoe UI", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
}
html[data-theme="light"] {
  --bg: #f2efe8; --ink: #14181c; --ink-2: #3b444d; --muted: #7a828c;
  --line: #ddd7ca; --line-2: #e7e2d7; --accent: #9a6400; --ok: #1f7a52; --bad: #a8382c; --panel: #faf8f3;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--bg); color: var(--ink);
  font: 15px/1.6 var(--sans); -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
button:focus-visible { outline: 1px solid var(--accent); outline-offset: 3px; }
code { font-family: var(--mono); }

.shell {
  max-width: 920px; margin: 0 auto; padding: 30px 30px 30px;
  min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto;
}
.top { display: flex; align-items: center; gap: 12px; }
.top-mark { width: 8px; height: 20px; background: var(--accent); clip-path: polygon(0 0, 100% 22%, 100% 100%, 0 78%); }
.top-brand { font: 11px var(--mono); letter-spacing: .34em; color: var(--ink-2); }
.top-state { font: 10px var(--mono); letter-spacing: .3em; color: var(--muted); }
.top-grow { flex: 1; }
.theme { width: 30px; height: 30px; display: grid; place-items: center; color: var(--muted); transition: color .25s, transform .6s; }
.theme:hover { color: var(--accent); transform: rotate(180deg); }

.main { display: flex; flex-direction: column; justify-content: center; padding: 5vh 0 3vh; }

/* the one focus */
.focus { animation: rise .7s cubic-bezier(.2,.8,.2,1) both; }
.focus-line { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.focus-index { font-family: var(--mono); font-size: 64px; line-height: .9; font-weight: 600; letter-spacing: -.03em; }
.focus-of { font: 12px var(--mono); letter-spacing: .16em; color: var(--muted); }
.focus-name { margin: 0; font-size: clamp(23px, 3vw, 31px); font-weight: 600; letter-spacing: .01em; }
.focus-rule { position: relative; height: 3px; margin: 24px 0 0; background: var(--line); overflow: hidden; }
.focus-rule::after {
  content: ""; position: absolute; inset: 0 auto 0 0; width: var(--done, 0%);
  background: var(--accent);
  box-shadow: 0 0 12px -2px var(--accent);
  animation: draw 1.2s .2s cubic-bezier(.2,.8,.2,1) both;
}
.scope { margin: 16px 0 0; color: var(--ink-2); font-size: 14px; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.scope.empty { color: var(--muted); }
.scope-kind { font: 9px var(--mono); letter-spacing: .22em; color: var(--muted); border: 1px solid var(--line-2); padding: 2px 6px; flex: none; }

/* the only bright control */
.action {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; column-gap: 12px;
  align-items: baseline; width: 100%; text-align: left;
  margin: 30px 0 0; padding: 13px 16px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 13%, transparent), transparent 80%);
  border-left: 2px solid var(--accent);
  transition: background .3s, transform .3s;
  animation: rise .7s .06s cubic-bezier(.2,.8,.2,1) both;
}
.action:hover { transform: translateX(3px); background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 20%, transparent), transparent 84%); }
.action-tag { font: 9px var(--mono); letter-spacing: .26em; color: var(--muted); flex: none; align-self: center; }
.action-cmd { font-size: 12px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.action-state { font-size: 12px; color: var(--accent); flex: none; opacity: .5; transition: opacity .25s; }
.action:hover .action-state { opacity: 1; }
.action.copied { background: color-mix(in srgb, var(--ok) 16%, transparent); border-left-color: var(--ok); }
.action.copied .action-state { color: var(--ok); opacity: 1; }

.waits { display: inline-flex; align-items: baseline; gap: 8px; margin-top: 18px; position: relative; cursor: default; }
.waits-mark { color: var(--accent); font: 11px var(--mono); }
.waits-count { font: 11px var(--mono); color: var(--muted); }

/* the spine: one navigation */
.spine { list-style: none; margin: 4.5vh 0 0; padding: 0; position: relative; }
.spine::before { content: ""; position: absolute; left: 4px; top: 10px; bottom: 10px; width: 1px; background: var(--line-2); }
.node { position: relative; padding-left: 30px; animation: rise .5s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i) * 55ms + .1s); }
.node + .node { margin-top: 1px; }
.node-head { display: flex; align-items: baseline; gap: 12px; width: 100%; text-align: left; padding: 11px 6px 11px 0; }
.node-dot {
  position: absolute; left: 0; top: 19px; width: 9px; height: 9px; transform: rotate(45deg);
  border: 1px solid var(--line-2); background: var(--bg);
  transition: transform .35s, border-color .35s, background .35s, box-shadow .35s;
}
.node.done .node-dot { background: var(--ok); border-color: var(--ok); }
.node.live .node-dot { background: var(--accent); border-color: var(--accent); animation: pulse 2.4s ease-in-out infinite; }
.node-head:hover .node-dot { transform: rotate(45deg) scale(1.5); box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 12%, transparent); }
.node-name { font-size: 15px; color: var(--ink-2); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: color .25s, transform .25s; }
.node-head:hover .node-name, .node.open .node-name { color: var(--ink); }
.node.done .node-name { color: var(--muted); }
.node-summary { font: 11px var(--mono); color: var(--accent); letter-spacing: .06em; flex: none; }
.node.done .node-summary { color: var(--ok); }

.node-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .5s cubic-bezier(.2,.8,.2,1); }
.node.open .node-body { grid-template-rows: 1fr; }
.node-inner { overflow: hidden; }
.node-goal { margin: 0 0 12px; color: var(--muted); font-size: 12px; }
.tasks, .accepts, .extras { list-style: none; margin: 0 0 14px; padding: 0; }
.task, .accept { position: relative; display: flex; align-items: baseline; gap: 10px; padding: 8px 8px; border-top: 1px solid var(--line); }
.task:last-child, .accept:last-child { border-bottom: 1px solid var(--line); }
.task { color: var(--muted); font-size: 13px; }
.task.done { color: var(--ink-2); }
.mark { width: 12px; font: 11px var(--mono); color: var(--ok); flex: none; }
.task-text, .accept-text { flex: 1; min-width: 0; }
.accept { font-size: 13.5px; color: var(--ink-2); cursor: default; transition: background .25s; }
.accept:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); }
.shape { font: 12px var(--mono); flex: none; width: 14px; color: var(--muted); }
.accept.ok .shape { color: var(--ok); }
.accept.bad .shape { color: var(--bad); }
.accept.ok .accept-text { color: var(--ink); }
.accept.bad .accept-text { color: var(--bad); }
.resolution { font-style: normal; color: var(--muted); font-size: 11px; margin-left: 8px; }
.review-line { display: flex; gap: 14px; font-size: 11px; color: var(--muted); padding: 6px 8px; border-top: 1px solid var(--line); }
.review-line .muted { opacity: .7; }

/* evidence only when asked for */
.ev {
  position: absolute; left: 32px; top: calc(100% - 3px); z-index: 5;
  max-width: min(580px, 76vw); padding: 9px 12px;
  background: var(--panel); border: 1px solid var(--line-2); border-left: 2px solid var(--accent);
  color: var(--ink-2); font: 11px/1.7 var(--mono);
  opacity: 0; transform: translateY(-5px); pointer-events: none;
  transition: opacity .22s, transform .22s;
  box-shadow: 0 20px 44px -24px rgba(0,0,0,.6);
}
.accept:hover .ev, .accept:focus-within .ev, .task:hover .ev { opacity: 1; transform: translateY(0); pointer-events: auto; }
.waits-ev { left: 0; top: calc(100% + 6px); }
.waits:hover .ev, .waits:focus .ev { opacity: 1; transform: translateY(0); }

.foot { display: flex; justify-content: space-between; font: 10px var(--mono); color: var(--muted); letter-spacing: .08em; }

@keyframes rise { from { transform: translateY(10px); } to { transform: none; } }
@keyframes draw { from { width: 0; } }
@keyframes pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 18%, transparent); } }

@media (max-width: 620px) {
  .shell { padding: 22px 18px 24px; }
  .main { padding: 4vh 0 3vh; }
  .focus-index { font-size: 44px; }
  .focus-name { font-size: 22px; }
  .action { align-items: start; padding: 11px 13px; }
  .action-cmd { white-space: normal; overflow-wrap: anywhere; }
  .node-name { font-size: 14px; }
  .spine { margin-top: 5vh; }
  .ev { left: 0; max-width: calc(100vw - 56px); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
</style>
</head>
<body>
<div class="shell">
  <header class="top">
    <span class="top-mark" aria-hidden="true"></span>
    <span class="top-brand">NOEMA</span>
    <span class="top-state">${escape(state_)}</span>
    <span class="top-grow"></span>
    <button class="theme" type="button" title="明暗（T）" aria-label="切换明暗">◐</button>
  </header>

  <main class="main">
    <section class="focus" style="--done:${doneRatio}%" ${focus?.goal ? `title="${escape(focus.goal)}"` : ""}>
      <div class="focus-line">
        <span class="focus-index mono">${focusIndex}</span><span class="focus-of">/ ${focusTotal}</span>
        <h1 class="focus-name">${escape(focus?.name ?? "还没有验收单元")}</h1>
      </div>
      <div class="focus-rule" aria-hidden="true"></div>
      ${scopeLine}
      ${actionBlock}
      ${state === "讨论" ? waitsLine(thread) : ""}
    </section>

    <ol class="spine" aria-label="验收单元">${phases
      .map((phase, index) => phaseNode(phase, currentPhase?.id ?? null, index))
      .join("")}</ol>
  </main>

  <footer class="foot"><span>${escape(nowStamp)}</span><span>state.json · v${escape(doc.version)}</span></footer>
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

  for (const node of document.querySelectorAll(".node")) {
    const head = node.querySelector(".node-head");
    head.addEventListener("click", () => {
      const open = node.classList.toggle("open");
      head.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) history.replaceState(null, "", "#" + node.dataset.phase);
    });
  }

  const heads = [...document.querySelectorAll(".node-head")];
  document.addEventListener("keydown", (event) => {
    if (event.key !== "j" && event.key !== "k" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (document.activeElement?.tagName === "INPUT") return;
    const index = heads.indexOf(document.activeElement);
    const next = event.key === "j" || event.key === "ArrowDown" ? index + 1 : index - 1;
    const target = heads[Math.max(0, Math.min(heads.length - 1, index < 0 ? 0 : next))];
    if (target) { event.preventDefault(); target.focus(); }
  });

  const openFromHash = () => {
    const id = location.hash.slice(1);
    if (!id) return;
    const node = document.querySelector('.node[data-phase="' + CSS.escape(id) + '"]');
    if (!node) return;
    node.classList.add("open");
    node.querySelector(".node-head").setAttribute("aria-expanded", "true");
    node.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  openFromHash();
  window.addEventListener("hashchange", openFromHash);

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

const STATES_LABEL = { 讨论: "DISCUSS", 执行: "EXECUTE", 验收: "ACCEPT" };

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
    `工作台：${path.relative(process.cwd(), result.output)} · 状态 ${result.state} · 阶段 ${progress.phases.done}/${progress.phases.total} · 任务 ${progress.tasks.done}/${progress.tasks.total} · 验收 ${progress.acceptance.passed}/${progress.acceptance.total}`,
  );
}
