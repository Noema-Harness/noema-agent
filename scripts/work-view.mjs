// Read-only console for governance/data/state.json.
//
// One screen, one subject: the focused session. Left half is the state of the
// moment (alive: caret, pulse, numbers that refresh on rebuild); right half is
// the segment ledger with the current segment open; the bottom strip holds the
// single next command and the recent transitions.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCEPTANCE_LAYERS,
  BLOCKING_LAYERS,
  briefLines,
  currentSegment,
  focusSession,
  listSessions,
  logOf,
  nextAction,
  sessionProgress,
} from "../governance/core/state.mjs";
import { loadState } from "./state.mjs";

const STATE_CODE = { 讨论: "DISCUSS", 执行: "EXECUTING", 验收: "REVIEWING" };
const STATE_WORD = { 讨论: "讨论", 执行: "执行", 验收: "验收" };
const LAYER_SHAPE = { D: "▢", C: "○", R: "◇", H: "△" };
const LAYER_NAME = { D: "确定性", C: "可复核", R: "审查发现", H: "人签收" };
const TONE = { 未开始: "idle", 进行中: "live", 已完成: "done" };

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function fmtDate(value) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(String(value));
  return match ? `${match[2]}-${match[3]}` : String(value);
}

function ageOf(value, now = new Date()) {
  if (!value) return "";
  const then = new Date(String(value));
  if (Number.isNaN(then.getTime())) return "";
  const minutes = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 30) return `${hours} 小时`;
  return `${Math.round(hours / 24)} 天`;
}

function segmentName(segment, index) {
  return segment.name ?? `日常 · ${String(index + 1).padStart(2, "0")}`;
}

function layerChips(segment) {
  return ACCEPTANCE_LAYERS.map((layer) => {
    const items = segment.acceptance.filter((item) => (item.layer ?? "D") === layer);
    if (items.length === 0) {
      return `<span class="chip idle" data-layer="${layer}" title="${LAYER_NAME[layer]}"><b>${LAYER_SHAPE[layer]}</b><i>—</i></span>`;
    }
    return items
      .map((item) => {
        const state =
          item.layer === "R"
            ? item.resolution
              ? "ok"
              : "bad"
            : item.status === "通过"
              ? "ok"
              : item.status === "不通过"
                ? "bad"
                : "wait";
        const glyph =
          item.layer === "R" && !item.resolution
            ? "未处置"
            : item.layer === "H" && item.status !== "通过"
              ? "等你"
              : "";
        const note = item.resolution
          ? `${item.resolution.decision}${item.resolution.note ? `：${item.resolution.note}` : ""}`
          : (item.evidence ?? []).join("｜");
        return `<span class="chip ${state}" data-layer="${item.layer}" tabindex="0" title="${escapeHtml(
          `${LAYER_NAME[item.layer]} · ${item.text}`,
        )}"><b>${LAYER_SHAPE[item.layer]}</b><i>${escapeHtml(glyph || item.status)}</i>${
          note ? `<span class="ev">${escapeHtml(note)}</span>` : ""
        }</span>`;
      })
      .join("");
  }).join("");
}

function tasksOf(segment) {
  const open = segment.tasks.filter((task) => task.status !== "已完成");
  const done = segment.tasks.filter((task) => task.status === "已完成");
  const row = (task) => `<li class="task ${task.status === "已完成" ? "done" : "open"}">
      <span class="mark">${task.status === "已完成" ? "✓" : "·"}</span>
      <span class="text">${escapeHtml(task.text)}</span>
      ${(task.evidence ?? []).length ? `<span class="ev">${escapeHtml(task.evidence.join("｜"))}</span>` : ""}
    </li>`;
  const doneBlock = done.length
    ? `<details class="done"><summary>已完成 ${done.length} 项</summary><ul>${done.map(row).join("")}</ul></details>`
    : "";
  return `<ul class="tasks">${open.map(row).join("")}</ul>${doneBlock}`;
}

function segmentsOf(session, selectedId) {
  return session.segments
    .map((segment, index) => {
      const active = segment.id === selectedId;
      const labeled = Boolean(segment.labeled);
      const pass = segment.acceptance.filter(
        (item) => BLOCKING_LAYERS.includes(item.layer ?? "D") && item.status === "通过",
      ).length;
      const need = segment.acceptance.filter((item) =>
        BLOCKING_LAYERS.includes(item.layer ?? "D"),
      ).length;
      return `<li class="seg ${TONE[segment.status] ?? "idle"}${active ? " on" : ""}" data-seg="${segment.id}"${
        active ? ' data-current="true"' : ""
      }>
      <a class="seg-head" href="#${segment.id}" aria-expanded="${active}">
        <span class="num">${String(index + 1).padStart(2, "0")}</span>
        <span class="name">${escapeHtml(segmentName(segment, index))}</span>
        <span class="count">${labeled ? `${pass}/${need}` : `${segment.tasks.filter((t) => t.status === "已完成").length}/${segment.tasks.length}`}</span>
        <span class="st">${escapeHtml(segment.status)}</span>
      </a>
      <div class="seg-body">
        ${labeled ? `<div class="layers">${layerChips(segment)}</div>` : ""}
        ${tasksOf(segment)}
      </div>
    </li>`;
    })
    .join("");
}

function wave(state) {
  const paths = {
    讨论: "M0 34 C 40 34, 60 20, 100 24 S 160 40, 200 34 S 260 26, 300 34 S 360 42, 400 34",
    执行: "M0 34 L 60 34 L 74 14 L 86 44 L 98 34 L 190 34 L 204 8 L 216 50 L 228 34 L 340 34 L 352 18 L 364 42 L 376 34 L 400 34",
    验收: "M0 34 L 40 34 L 40 22 L 120 22 L 120 34 L 200 34 L 200 16 L 280 16 L 280 34 L 360 34 L 360 26 L 400 26",
  };
  return paths[state] ?? paths.执行;
}

function hero({ session, focused, progress, now, selectedId }) {
  const currentIndex = session.segments.findIndex((segment) => segment.id === selectedId);
  const ghost = String(currentIndex >= 0 ? currentIndex + 1 : session.segments.length).padStart(
    2,
    "0",
  );
  const alive = focused && session.status === "open";
  const code = STATE_CODE[session.state] ?? session.state;
  return `<section class="state">
    <p class="code">${code}${alive ? '<span class="dots"><i></i><i></i><i></i></span>' : ""}</p>
    <span class="glow" aria-hidden="true"></span>
    <span class="ghost" aria-hidden="true">${ghost}</span>
    <h1 class="word">${escapeHtml(STATE_WORD[session.state] ?? session.state)}${alive ? '<span class="caret" aria-hidden="true"></span>' : ""}</h1>
    <p class="session">${session.id ? escapeHtml(session.id) : "—"} · ${escapeHtml(session.title)}</p>
    <p class="scope">${
      session.scope
        ? `<span class="kind">${escapeHtml(session.scope.kind)}</span>${escapeHtml(session.scope.text)}`
        : `<code>npm run state -- scope "这次交付什么"</code>`
    }</p>
    <dl class="facts">
      <div><dt>段</dt><dd>${progress.segmentsDone}<small>/${progress.segments}</small></dd></div>
      <div><dt>任务</dt><dd>${progress.tasksDone}<small>/${progress.tasks}</small></dd></div>
      <div><dt>验收</dt><dd>${progress.acceptanceDone}<small>/${progress.acceptanceBlocking}</small></dd></div>
      <div><dt>发现</dt><dd>${progress.findings}</dd></div>
    </dl>
    <div class="pulse" aria-hidden="true">
      <svg viewBox="0 0 400 68" preserveAspectRatio="none"><path class="track" d="M0 34 L 400 34"/><path class="line" d="${wave(session.state)}"/></svg>
    </div>
    <p class="since" data-since="${escapeHtml(session.since ?? "")}">${session.status === "archived" ? "已归档" : "开始于"} <span class="age">${ageOf(session.since, now)}</span> 前${session.status === "archived" ? "" : " · 数据只经命令写入"}</p>
  </section>`;
}

function ledger({ session, selectedId }) {
  return `<section class="ledger">
    <p class="lede"><span>段</span><span>${session.segments.length}</span></p>
    <ol class="segments">${segmentsOf(session, selectedId)}</ol>
  </section>`;
}

function ticker({ doc, next, now }) {
  const log = logOf(doc).slice(-4).reverse();
  const trail = log.length
    ? log
        .map(
          (entry) =>
            `<span>${fmtDate(entry.date)} ${escapeHtml(entry.from ?? "起始")}<i>→</i>${escapeHtml(entry.to)}</span>`,
        )
        .join("")
    : `<span>还没有切换记录</span>`;
  return `<footer class="ticker">
    <p class="next"><em>下一步</em><code class="cmd">${escapeHtml(next.command)}</code><button class="copy" type="button" title="${escapeHtml(
      `${next.label} · ${next.detail}`,
    )}">复制</button></p>
    <p class="trail">${trail}</p>
    <p class="stamp" id="stamp">${escapeHtml(now.toLocaleString("zh-CN", { hour12: false }))}</p>
  </footer>`;
}

function page({ doc, session, selectedId, focused, now }) {
  const progress = sessionProgress(session);
  const next = nextAction(doc);
  const sessions = listSessions(doc);
  const open = sessions.filter((one) => one.status === "open");
  const bar = `<header class="bar">
    <span class="mark">治理台</span>
    <span class="sub">state.json · v${doc.version ?? 4}</span>
    <span class="tabs">${
      open.length > 1
        ? open
            .map(
              (one) =>
                `<a href="#${one.id}" class="${one.focused ? "here" : ""}">${escapeHtml(one.id)}</a>`,
            )
            .join("")
        : ""
    }</span>
    <button class="lamp" type="button" data-theme-toggle aria-label="切换明暗" title="明暗（T）">◐</button>
  </header>`;
  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>治理台 · ${escapeHtml(session.title ?? "会话")}</title>
<style>${STYLE}</style>
</head>
<body data-theme="dark">
${bar}
<main class="stage" data-state="${escapeHtml(session.state)}">
${hero({ session, focused, progress, now, selectedId })}
${ledger({ session, selectedId })}
</main>
${ticker({ doc, next, now })}
<script>${SCRIPT}</script>
</body>
</html>`;
}

const STYLE = `
:root {
  --bg: #0a0b0c; --ink: #f4f1e8; --dim: #8e897c; --line: #24252a; --raise: #101114;
  --accent: #d9ff3f; --done: #8fbf72; --bad: #e2604a; --wait: #f0b45a;
  --serif: "Songti SC", "SimSun", "Georgia", serif;
  --mono: "Cascadia Mono", "Consolas", ui-monospace, monospace;
  --sans: "Segoe UI", system-ui, sans-serif;
}
[data-theme="light"] {
  --bg: #efe9dc; --ink: #14120c; --dim: #6d6557; --line: #d6cbb5; --raise: #f6f1e6;
  --accent: #a3381b; --done: #3f7a3a; --bad: #a3241b; --wait: #8a5a12;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: var(--sans); display: grid; grid-template-rows: auto 1fr auto;
  overflow: hidden; transition: background .5s ease, color .5s ease;
}
body::after {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 5;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,.014) 0 1px, transparent 1px 4px);
  mix-blend-mode: overlay;
}
[data-theme="light"] body::after { background: repeating-linear-gradient(0deg, rgba(0,0,0,.02) 0 1px, transparent 1px 5px); }
.bar {
  display: flex; align-items: baseline; gap: 18px;
  padding: 20px 28px 14px; border-bottom: 1px solid var(--line);
}
.mark { font-family: var(--serif); font-size: 17px; letter-spacing: .34em; }
.sub { font-family: var(--mono); font-size: 10px; color: var(--dim); letter-spacing: .12em; }
.tabs { margin-left: auto; display: flex; gap: 10px; font-family: var(--mono); font-size: 11px; }
.tabs a { color: var(--dim); text-decoration: none; padding: 2px 6px; border: 1px solid transparent; }
.tabs a.here { color: var(--ink); border-color: var(--line); }
.lamp {
  background: none; border: 1px solid var(--line); color: var(--ink); cursor: pointer;
  width: 26px; height: 26px; line-height: 1; font-size: 12px; border-radius: 50%;
  transition: transform .5s ease, border-color .3s ease;
}
.lamp:hover { transform: rotate(180deg); border-color: var(--accent); }

.stage { display: grid; grid-template-columns: 1.06fr .94fr; min-height: 0; }
.state {
  padding: 40px 32px 26px 48px; display: flex; flex-direction: column;
  position: relative; min-width: 0;
}
.code {
  margin: 0; font-family: var(--mono); font-size: 11px; letter-spacing: .34em;
  color: var(--dim); display: flex; align-items: center; gap: 10px;
}
.dots { display: inline-flex; gap: 4px; }
.dots i {
  width: 4px; height: 4px; background: var(--accent); border-radius: 50%;
  animation: breathe 2.1s ease-in-out infinite;
}
.dots i:nth-child(2) { animation-delay: .35s; }
.dots i:nth-child(3) { animation-delay: .7s; }
.word {
  margin: 6px 0 0; font-family: var(--serif); font-weight: 600;
  font-size: clamp(84px, 12.5vw, 176px); line-height: .92; letter-spacing: .02em;
  display: flex; align-items: flex-end; gap: 8px;
}
.caret {
  display: inline-block; width: .08em; height: .68em; margin-bottom: .08em;
  background: var(--accent); animation: blink 1.15s steps(1, end) infinite;
}
.session {
  margin: 18px 0 0; font-family: var(--mono); font-size: 11px; color: var(--dim);
  letter-spacing: .04em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.scope { margin: 10px 0 0; font-size: 15px; line-height: 1.5; max-width: 46ch; }
.scope .kind {
  font-family: var(--mono); font-size: 10px; letter-spacing: .1em;
  border: 1px solid var(--line); padding: 1px 6px; margin-right: 10px; color: var(--dim);
}
.facts {
  display: flex; gap: 30px; margin: 28px 0 0; padding-top: 16px; border-top: 1px solid var(--line);
}
.facts div { display: flex; flex-direction: column-reverse; gap: 4px; }
.facts dt { font-family: var(--mono); font-size: 10px; color: var(--dim); letter-spacing: .14em; }
.facts dd { margin: 0; font-family: var(--mono); font-size: 26px; }
.facts small { font-size: 12px; color: var(--dim); }
.pulse { margin-top: auto; padding-top: 26px; }
.pulse svg { width: 100%; height: 62px; display: block; overflow: visible; }
.pulse .track { fill: none; stroke: var(--line); stroke-width: 1; }
.pulse .line {
  fill: none; stroke: var(--accent); stroke-width: 1.4; stroke-linecap: round;
  stroke-dasharray: 5 7; animation: march 7s linear infinite;
  opacity: .9;
}
.glow {
  position: absolute; left: -6%; top: 12%; width: 62%; aspect-ratio: 1; border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 64%);
  filter: blur(16px); pointer-events: none; animation: glow 9s ease-in-out infinite;
}
.ghost {
  position: absolute; right: 2%; bottom: 10%; z-index: 0;
  font-family: var(--serif); font-size: clamp(180px, 27vw, 360px); line-height: .78;
  letter-spacing: -.05em; color: var(--ink); opacity: .05; pointer-events: none; user-select: none;
}
[data-theme="light"] .ghost { opacity: .07; }
.seg.live { position: relative; }
.seg.live::before {
  content: ""; position: absolute; left: -22px; top: 6px; bottom: 6px; width: 2px;
  background: linear-gradient(180deg, transparent, var(--accent), transparent);
  animation: slide 3.6s ease-in-out infinite;
}
@keyframes glow { 0%, 100% { opacity: .35; transform: scale(.96); } 50% { opacity: .8; transform: scale(1.04); } }
@keyframes slide { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.since { margin: 10px 0 0; font-family: var(--mono); font-size: 10px; color: var(--dim); letter-spacing: .06em; }

.ledger {
  border-left: 1px solid var(--line); padding: 26px 26px 20px 22px;
  overflow-y: auto; min-width: 0;
}
.lede {
  display: flex; justify-content: space-between; margin: 0 0 14px;
  font-family: var(--mono); font-size: 10px; letter-spacing: .2em; color: var(--dim);
}
.segments { list-style: none; margin: 0; padding: 0; }
.seg { border-bottom: 1px solid var(--line); }
.seg-head {
  display: grid; grid-template-columns: 34px 1fr auto auto; gap: 12px; align-items: baseline;
  padding: 14px 4px; text-decoration: none; color: inherit; cursor: pointer;
}
.num { font-family: var(--mono); font-size: 12px; color: var(--dim); }
.name { font-family: var(--serif); font-size: 17px; letter-spacing: .02em; }
.count { font-family: var(--mono); font-size: 11px; color: var(--dim); }
.st { font-family: var(--mono); font-size: 10px; letter-spacing: .1em; color: var(--dim); width: 44px; text-align: right; }
.seg-head:hover .name { color: var(--accent); }
.seg.live .st { color: var(--accent); }
.seg.live .num::before {
  content: "●"; color: var(--accent); margin-right: 6px; font-size: 8px; vertical-align: middle;
  animation: breathe 2.4s ease-in-out infinite;
}
.seg.done .st { color: var(--done); }
.seg-body { display: none; padding: 0 4px 18px 46px; }
.seg.on .seg-body { display: block; animation: rise .38s ease both; }
.seg.on .name { color: var(--ink); }
.layers { display: flex; flex-wrap: wrap; gap: 8px; margin: 2px 0 14px; }
.chip {
  position: relative; display: inline-flex; align-items: baseline; gap: 6px;
  font-family: var(--mono); font-size: 10px; padding: 3px 8px;
  border: 1px solid var(--line); color: var(--dim);
}
.chip b { font-size: 11px; font-weight: 400; }
.chip.ok { color: var(--done); border-color: color-mix(in srgb, var(--done) 40%, var(--line)); }
.chip.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); }
.chip.wait { color: var(--wait); border-color: color-mix(in srgb, var(--wait) 45%, var(--line)); }
.chip .ev {
  position: absolute; left: 0; top: calc(100% + 6px); z-index: 4; width: max-content; max-width: 300px;
  background: var(--raise); border: 1px solid var(--line); color: var(--ink);
  font-family: var(--sans); font-size: 12px; line-height: 1.45; padding: 6px 9px;
  opacity: 0; transform: translateY(-4px); pointer-events: none; transition: .18s ease;
}
.chip:hover .ev, .chip:focus .ev { opacity: 1; transform: none; }
.tasks { list-style: none; margin: 0 0 4px; padding: 0; }
.task { display: grid; grid-template-columns: 18px 1fr; gap: 8px; padding: 6px 0; position: relative; font-size: 13.5px; }
.task .mark { color: var(--dim); font-family: var(--mono); }
.task.open .mark { color: var(--accent); }
.task.done .text { color: var(--dim); }
.task .ev {
  position: absolute; left: 26px; top: calc(100% - 4px); z-index: 4;
  background: var(--raise); border: 1px solid var(--line); padding: 5px 9px;
  font-family: var(--mono); font-size: 11px; color: var(--ink); max-width: 360px;
  opacity: 0; transform: translateY(-3px); pointer-events: none; transition: .16s ease;
}
.task:hover .ev { opacity: 1; transform: none; }
.done summary {
  font-family: var(--mono); font-size: 10px; color: var(--dim); cursor: pointer;
  letter-spacing: .08em; padding: 6px 0; list-style: none;
}
.done summary::-webkit-details-marker { display: none; }
.done summary::after { content: " ▾"; }
.done[open] summary::after { content: " ▴"; }

.ticker {
  display: grid; grid-template-columns: minmax(0, max-content) 1fr auto; gap: 24px;
  align-items: center; padding: 12px 24px 12px 20px; border-top: 1px solid var(--line);
  background: var(--raise); font-family: var(--mono); font-size: 11px;
}
.next { display: flex; align-items: center; gap: 12px; margin: 0; min-width: 0; }
.next em { font-style: normal; color: var(--dim); letter-spacing: .16em; font-size: 10px; }
.next .cmd { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.copy {
  background: none; border: 1px solid var(--line); color: var(--dim); cursor: pointer;
  font-family: var(--mono); font-size: 10px; padding: 3px 8px; transition: .2s ease;
}
.copy:hover { color: var(--accent); border-color: var(--accent); }
.trail { margin: 0; color: var(--dim); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.trail i { font-style: normal; margin: 0 6px; color: var(--accent); }
.trail span { margin-right: 18px; }
.stamp { margin: 0; color: var(--dim); font-size: 10px; }

@keyframes breathe { 0%, 100% { opacity: .25; transform: scale(.8); } 50% { opacity: 1; transform: scale(1); } }
@keyframes blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes march { to { stroke-dashoffset: -240; } }
@keyframes rise { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .dots i, .caret, .pulse .line, .seg.live .num::before, .seg-body { animation: none !important; }
}
@media (max-width: 900px) {
  body { overflow: auto; }
  .stage { grid-template-columns: 1fr; }
  .state { padding: 26px 20px 18px; }
  .ledger { border-left: 0; border-top: 1px solid var(--line); padding: 18px 18px 24px; }
  .word { font-size: clamp(64px, 18vw, 110px); }
  .ticker { grid-template-columns: 1fr; gap: 8px; }
  .trail { display: none; }
}
`;

const SCRIPT = `
const root = document.documentElement;
const body = document.body;
const rule = matchMedia('(prefers-color-scheme: light)');
const saved = localStorage.getItem('governance-theme');
const setTheme = (theme) => {
  root.dataset.theme = theme;
  body.dataset.theme = theme;
  document.querySelector('[data-theme-toggle]').setAttribute('aria-pressed', String(theme === 'light'));
};
if (saved) setTheme(saved);
const toggle = () => {
  const next = root.dataset.theme === 'light' ? 'dark' : 'light';
  setTheme(next);
  localStorage.setItem('governance-theme', next);
};
document.querySelector('[data-theme-toggle]').addEventListener('click', toggle);
document.addEventListener('keydown', (event) => {
  if (event.key === 't' || event.key === 'T') { if (!event.metaKey && !event.ctrlKey) toggle(); }
  if (event.key === 'j' || event.key === 'k') {
    const segs = [...document.querySelectorAll('.seg')];
    const index = segs.findIndex((seg) => seg.classList.contains('on'));
    const next = Math.min(segs.length - 1, Math.max(0, index + (event.key === 'j' ? 1 : -1)));
    if (segs[next]) segs[next].querySelector('.seg-head').click();
  }
});
const open = (id) => {
  for (const seg of document.querySelectorAll('.seg')) {
    const on = seg.dataset.seg === id;
    seg.classList.toggle('on', on);
    const head = seg.querySelector('.seg-head');
    if (head) head.setAttribute('aria-expanded', String(on));
  }
};
const fromHash = () => {
  const id = location.hash.replace('#', '');
  if (id) open(id);
};
window.addEventListener('hashchange', fromHash);
fromHash();
"const stamp = document.getElementById('stamp');
const age = document.querySelector('.age');
const since = document.querySelector('.since')?.dataset.since;
const ageOf = (value) => {
  if (!value) return '';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return String(minutes);
  const hours = Math.round(minutes / 60);
  return hours < 30 ? String(hours) : String(Math.round(hours / 24));
};
if (since && age) {
  setInterval(() => { age.textContent = ageOf(since); }, 20000);
}
if (stamp) {
  setInterval(() => { stamp.textContent = new Date().toLocaleString('zh-CN', { hour12: false }); }, 1000);
}
document.querySelectorAll('.copy').forEach((button) => {"
  button.addEventListener('click', async () => {
    const cmd = button.parentElement.querySelector('.cmd').textContent;
    try { await navigator.clipboard.writeText(cmd); } catch { }
    const was = button.textContent;
    button.textContent = '已复制';
    setTimeout(() => { button.textContent = was; }, 1400);
  });
});
`;

export function renderView(root = process.cwd()) {
  const doc = loadState(root);
  const focused = focusSession(doc);
  const session =
    focused ??
    [...(doc.sessions ?? [])]
      .sort((a, b) => String(b.since).localeCompare(String(a.since)))
      .find((one) => one.segments.length > 0);
  if (!session) {
    return page({
      doc,
      session: {
        id: null,
        title: "还没有在推进的会话",
        state: "讨论",
        scope: null,
        segments: [],
        status: "open",
        since: null,
      },
      selectedId: null,
      focused: false,
      now: new Date(),
    });
  }
  const now = new Date();
  const selectedId =
    process.env.NOEMA_VIEW_SEGMENT ??
    (focused
      ? (currentSegment(doc)?.id ?? null)
      : (
          [...session.segments].reverse().find((segment) => segment.status === "已完成") ??
          session.segments[session.segments.length - 1]
        )?.id);
  return page({ doc, session, selectedId, focused: Boolean(focused), now });
}

export function writeView(root = process.cwd()) {
  const file = path.join(root, ".work", "review", "work-view.html");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderView(root), "utf8");
  return file;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.env.NOEMA_STATE_ROOT ?? process.cwd();
  const file = writeView(root);
  const doc = loadState(root);
  const session = focusSession(doc);
  console.log(file);
  console.log(
    session
      ? `会话 ${session.id}「${session.title}」· ${session.state} · 段 ${session.segments.length}`
      : "没有打开的会话",
  );
  if (session) console.log(briefLines(doc)[0] ?? "");
}
