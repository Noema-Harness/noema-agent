// Read-only view of governance/data/state.json. One session at a time: the
// focused one, its current segment in the middle, the rest folded into rails.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCEPTANCE_LAYERS,
  briefLines,
  currentSegment,
  focusSession,
  listSessions,
  logOf,
  nextAction,
  openFindings,
  sessionProgress,
} from "../governance/core/state.mjs";
import { loadState } from "./state.mjs";

const STATE_LABEL = { 讨论: "DISCUSS", 执行: "EXECUTE", 验收: "ACCEPT" };
const STATE_NAME = { 讨论: "讨论", 执行: "执行", 验收: "验收" };
const LAYER_SHAPE = { D: "▢", C: "○", R: "◇", H: "△" };
const LAYER_NAME = { D: "确定性", C: "可复核", R: "审查发现", H: "人签收" };
const SEGMENT_TONE = { 未开始: "idle", 进行中: "live", 已完成: "done" };

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function shortId(id) {
  return escapeHtml(id);
}

function fmtDate(value) {
  if (!value) return "";
  const text = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(text);
  return match ? `${match[2]}-${match[3]}` : text;
}

function segmentName(segment) {
  return segment.name ?? "日常段";
}

function segmentCounts(segment) {
  const done = segment.tasks.filter((task) => task.status === "已完成").length;
  const passed = segment.acceptance.filter((item) => item.status === "通过").length;
  return { tasks: segment.tasks.length, tasksDone: done, passed };
}

function statusTone(status) {
  if (status === "通过" || status === "已完成") return "ok";
  if (status === "不通过") return "bad";
  return "idle";
}

function renderSessions(doc, focused) {
  const rows = listSessions(doc);
  if (rows.length <= 1) return "";
  const chips = rows
    .map((row) => {
      const live = row.focused ? " live" : row.status === "archived" ? " gone" : "";
      return `<span class="chip${live}" title="${escapeHtml(row.title)}"><i>${escapeHtml(row.id)}</i>${escapeHtml(
        row.status === "archived" ? "已归档" : row.state,
      )}</span>`;
    })
    .join("");
  return `<div class="sessions" aria-label="会话">${chips}</div>`;
}

function renderRail(session, selectedId, currentId) {
  return session.segments
    .map((segment) => {
      const counts = segmentCounts(segment);
      const tone = SEGMENT_TONE[segment.status] ?? "idle";
      const live = segment.id === selectedId ? " selected" : "";
      const meter =
        counts.tasks > 0
          ? `<span class="meter"><i style="--fill:${Math.round((counts.tasksDone / counts.tasks) * 100)}%"></i></span>`
          : "";
      const countsText =
        counts.tasks > 0 || counts.passed > 0
          ? `${counts.tasksDone}/${counts.tasks} · ${counts.passed}`
          : segment.status;
      return `<button type="button" class="seg${live} ${tone}" data-seg="${shortId(segment.id)}" data-current="${
        segment.id === currentId
      }" aria-pressed="${segment.id === selectedId}"><span class="seg-id">${shortId(
        segment.id,
      )}</span><span class="seg-name">${escapeHtml(segmentName(segment))}</span><span class="seg-status">${escapeHtml(
        countsText,
      )}</span>${meter}</button>`;
    })
    .join("");
}

function renderEvidence(values) {
  if (!values || values.length === 0) return "";
  const items = values.map((one) => `<li>${escapeHtml(one)}</li>`).join("");
  return `<div class="ev" role="tooltip"><ul>${items}</ul></div>`;
}

function renderTasks(segment) {
  if (segment.tasks.length === 0) {
    return `<p class="quiet">这一段还没有任务。</p>`;
  }
  const done = segment.tasks.filter((task) => task.status === "已完成");
  const open = segment.tasks.filter((task) => task.status !== "已完成");
  const row = (task) => {
    const ok = task.status === "已完成";
    const evidence = renderEvidence(task.evidence);
    return `<li class="task${ok ? " ok" : ""}${evidence ? " has-ev" : ""}" tabindex="0"><span class="mark">${
      ok ? "✓" : "·"
    }</span><span class="task-text">${escapeHtml(task.text)}</span>${evidence}</li>`;
  };
  const openRows = open.map(row).join("");
  const doneRows = done.map(row).join("");
  const doneBlock = done.length
    ? `<details class="done-fold"><summary>已完成 ${done.length} 项</summary><ul>${doneRows}</ul></details>`
    : "";
  return `<ul class="tasks">${openRows}</ul>${doneBlock}`;
}

function renderLayers(segment) {
  if (segment.acceptance.length === 0) {
    return segment.labeled ? `<p class="quiet">这一段还没有验收判据。</p>` : "";
  }
  const byLayer = new Map(ACCEPTANCE_LAYERS.map((layer) => [layer, []]));
  for (const item of segment.acceptance) {
    const layer = item.layer ?? "D";
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(item);
  }
  const columns = ACCEPTANCE_LAYERS.filter((layer) => (byLayer.get(layer) ?? []).length > 0)
    .map((layer) => {
      const items = byLayer.get(layer);
      const slips = items
        .map((item) => {
          const tone =
            layer === "R" && !item.resolution
              ? "bad"
              : layer === "H" && item.status !== "通过"
                ? "wait"
                : statusTone(item.status);
          const note =
            layer === "R"
              ? item.resolution
                ? escapeHtml(item.resolution.decision)
                : "未处置"
              : item.status === "未验" && layer === "H"
                ? "等你"
                : escapeHtml(item.status);
          const evidence = renderEvidence(item.evidence);
          return `<li class="slip ${tone}${evidence ? " has-ev" : ""}" tabindex="0" title="${escapeHtml(
            `${item.id} · ${item.text}`,
          )}"><span class="slip-shape">${LAYER_SHAPE[layer]}</span><span class="slip-text">${escapeHtml(
            item.text,
          )}</span><span class="slip-note">${note}</span>${evidence}</li>`;
        })
        .join("");
      return `<div class="layer"><h3><span class="shape">${LAYER_SHAPE[layer]}</span>${LAYER_NAME[layer]}<em>${
        items.filter((item) => item.status === "通过" || (layer === "R" && item.resolution)).length
      }/${items.length}</em></h3><ul>${slips}</ul></div>`;
    })
    .join("");
  return `<div class="layers">${columns}</div>`;
}

function renderSign(session, segment) {
  if (!segment.labeled) return "";
  const blocking = segment.acceptance.filter((item) => (item.layer ?? "D") !== "R");
  const open = blocking.filter((item) => item.status !== "通过");
  const findings = segment.acceptance.filter(
    (item) => (item.layer ?? "D") === "R" && !item.resolution,
  );
  const gaps = [...open, ...findings];
  if (segment.status === "已完成") {
    const signed = session.scope?.signed;
    return `<p class="sign done">这一段已经放行。${signed ? `<span>${fmtDate(signed.date)} 签收</span>` : ""}</p>`;
  }
  if (gaps.length === 0) return `<p class="sign ready">还差一步：收尾这一段。</p>`;
  return `<p class="sign gap">还差 ${gaps.length} 项 · 第一处：${escapeHtml(
    gaps[0].text,
  )}<span class="pulse" aria-hidden="true"></span></p>`;
}

function renderSegment(session, segment) {
  const review = segment.review
    ? `<dl class="review">${
        segment.review.what ? `<dt>验什么</dt><dd>${escapeHtml(segment.review.what)}</dd>` : ""
      }${segment.review.gap ? `<dt>可能漏</dt><dd>${escapeHtml(segment.review.gap)}</dd>` : ""}${
        segment.review.split ? `<dt>划分</dt><dd>${escapeHtml(segment.review.split)}</dd>` : ""
      }</dl>`
    : "";
  return `<section class="sheet" aria-label="当前段">
    <header class="sheet-head">
      <span class="sheet-id">${shortId(segment.id)}</span>
      <h2>${escapeHtml(segmentName(segment))}</h2>
      <span class="badge ${SEGMENT_TONE[segment.status] ?? "idle"}">${escapeHtml(segment.status)}</span>
      <span class="sheet-counts">${segment.tasks.filter((task) => task.status === "已完成").length}/${
        segment.tasks.length
      } 任务 · ${segment.acceptance.filter((item) => item.status === "通过").length}/${
        segment.acceptance.length
      } 验收</span>
    </header>
    ${review}
    ${renderTasks(segment)}
    ${renderLayers(segment)}
    ${renderSign(session, segment)}
  </section>`;
}

function renderFacts(session) {
  const progress = sessionProgress(session);
  const byLayer = ACCEPTANCE_LAYERS.map((layer) => {
    const items = session.segments.flatMap((segment) =>
      segment.acceptance.filter((item) => (item.layer ?? "D") === layer),
    );
    const passed = items.filter(
      (item) => item.status === "通过" || (layer === "R" && item.resolution),
    ).length;
    return `<li><span class="shape">${LAYER_SHAPE[layer]}</span><span>${LAYER_NAME[layer]}</span><em>${passed}/${items.length}</em></li>`;
  }).join("");
  return `<aside class="facts" aria-label="进度">
    <div class="fact"><em>${progress.segmentsDone}/${progress.segments}</em><span>段</span></div>
    <div class="fact"><em>${progress.tasksDone}/${progress.tasks}</em><span>任务</span></div>
    <div class="fact"><em>${progress.acceptanceDone}/${progress.acceptance}</em><span>验收</span></div>
    <ul class="layers-legend">${byLayer}</ul>
  </aside>`;
}

function renderLog(doc) {
  const rows = logOf(doc).slice(-3).reverse();
  if (rows.length === 0) return "";
  const items = rows
    .map(
      (entry) =>
        `<li><span>${escapeHtml(fmtDate(entry.date))}</span>${escapeHtml(
          `${entry.from ?? "起始"} → ${entry.to}`,
        )}</li>`,
    )
    .join("");
  return `<section class="log"><h3>最近切换</h3><ul>${items}</ul></section>`;
}

function page({ doc, session, selected, fileUrl }) {
  const samples = doc.sessions.length;
  const next = nextAction(doc);
  const focused = focusSession(doc);
  const currentSegmentId = focused ? (currentSegment(doc)?.id ?? null) : null;
  const selectedSegment =
    session.segments.find((segment) => segment.id === selected) ??
    session.segments.find((segment) => segment.id === currentSegmentId) ??
    session.segments[session.segments.length - 1];
  const generated = new Date().toLocaleString("zh-CN", { hour12: false });
  const state = session.state;
  const sessions = renderSessions(doc, session);
  const hero = `<header class="hero">
    <div class="hero-state"><span class="state-code">${STATE_LABEL[state] ?? state}</span><span class="state-word">${
      STATE_NAME[state] ?? state
    }</span></div>
    <h1 class="session-title" title="${escapeHtml(session.title)}">${escapeHtml(session.title)}</h1>
    <p class="scope-line">${
      session.status === "archived" ? `<span class="archived-chip">已归档</span>` : ""
    }${
      session.scope
        ? `<span class="kind">${escapeHtml(session.scope.kind)}</span>${escapeHtml(session.scope.text)}`
        : `<code>npm run state -- scope "这次交付什么"</code>`
    }</p>
    ${sessions}
  </header>`;
  const empty =
    session.segments.length === 1 && session.segments[0].tasks.length === 0 && !session.scope
      ? `<p class="empty-hint">下一步：<code>${escapeHtml(next.command)}</code></p>`
      : "";
  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Noema · 治理工作台</title>
<style>${STYLE}</style>
</head>
<body>
<div class="frame">
  <header class="topbar">
    <span class="brand"><i></i>NOEMA<span class="thin">//</span>GOVERNANCE<span class="sub">状态驱动 · 只读</span></span>
    <button type="button" class="theme" aria-label="切换明暗" title="切换明暗">◐</button>
  </header>
  ${hero}
  <main class="board">
    <nav class="rail" aria-label="段">${renderRail(session, selectedSegment?.id, currentSegmentId)}</nav>
    <div class="stage">
      ${
        session.segments.length
          ? session.segments
              .map(
                (one) =>
                  `<div class="sheet-block" data-sheet="${one.id}">${renderSegment(session, one)}</div>`,
              )
              .join("")
          : `<p class="quiet">这个会话还没有段。</p>`
      }
      ${empty}
      ${renderLog(doc)}
    </div>
    ${renderFacts(session)}
  </main>
  <footer class="command">
    <span class="command-label">下一步</span>
    <code class="command-text" title="${escapeHtml(`${next.label} — ${next.detail}`)}">${escapeHtml(
      next.command,
    )}</code>
    <button type="button" class="copy" aria-label="复制下一步命令" title="复制">⧉</button>
    <span class="stamp">${samples} 个会话 · ${escapeHtml(generated)}</span>
  </footer>
</div>
<script>
(function () {
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem("noema-work-view-theme"); } catch (error) { saved = null; }
  if (saved === "light") root.dataset.theme = "light";
  function toggle() {
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
    try { localStorage.setItem("noema-work-view-theme", root.dataset.theme); } catch (error) {}
  }
  document.querySelector(".theme").addEventListener("click", toggle);
  document.addEventListener("keydown", function (event) {
    if (event.key === "t" || event.key === "T") toggle();
  });
  var blocks = Array.prototype.slice.call(document.querySelectorAll(".sheet-block"));
  var buttons = Array.prototype.slice.call(document.querySelectorAll(".seg"));
  function show(id) {
    blocks.forEach(function (block) { block.classList.toggle("on", block.dataset.sheet === id); });
    buttons.forEach(function (button) {
      button.classList.toggle("selected", button.dataset.seg === id);
      button.setAttribute("aria-pressed", String(button.dataset.seg === id));
    });
  }
  function fromHash() {
    var match = /^#seg-(\S+)$/.exec(location.hash);
    return match ? match[1] : null;
  }
  var initial = document.querySelector('.seg[data-current="true"]');
  show(fromHash() || (initial && initial.dataset.seg) || (buttons[0] && buttons[0].dataset.seg));
  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      show(button.dataset.seg);
      history.replaceState(null, "", "#seg-" + button.dataset.seg);
    });
  });
  window.addEventListener("hashchange", function () {
    var id = fromHash();
    if (id) show(id);
  });
  document.querySelector(".copy").addEventListener("click", function () {
    var text = document.querySelector(".command-text").textContent;
    var done = function () { var button = document.querySelector(".copy"); button.textContent = "✓"; setTimeout(function () { button.textContent = "⧉"; }, 1200); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
    else done();
  });
})();
</script>
</body>
</html>
`;
}

const STYLE = `
:root {
  --bg: #141412;
  --panel: #1b1a17;
  --line: #2e2c27;
  --ink: #ece7dc;
  --dim: #928c7d;
  --amber: #ffc45c;
  --ok: #6fd39a;
  --bad: #e2705c;
}
html[data-theme="light"] {
  --bg: #f5f2ea;
  --panel: #fffdf7;
  --line: #d9d3c4;
  --ink: #221f1a;
  --dim: #7c7466;
  --amber: #b07a1d;
  --ok: #2f7a4f;
  --bad: #a8402f;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.55 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
}
code, .state-code, .brand, .seg-id, .stamp { font-family: "Consolas", "Cascadia Mono", monospace; }
.frame { min-height: 100vh; display: grid; grid-template-rows: auto auto 1fr auto; }
.topbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 24px; border-bottom: 1px solid var(--line);
}
.brand { font-size: 11px; letter-spacing: .18em; display: flex; gap: 8px; align-items: center; }
.brand i { width: 8px; height: 8px; background: var(--amber); display: inline-block; }
.brand .thin { color: var(--dim); }
.brand .sub { color: var(--dim); letter-spacing: .08em; }
.theme {
  background: none; border: 1px solid var(--line); color: var(--dim);
  width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 13px;
  transition: color .2s, border-color .2s, transform .3s;
}
.theme:hover { color: var(--amber); border-color: var(--amber); transform: rotate(180deg); }
.hero { padding: 30px 24px 18px; border-bottom: 1px solid var(--line); }
.hero-state { display: flex; align-items: baseline; gap: 12px; }
.state-code { font-size: 11px; letter-spacing: .28em; color: var(--amber); }
.state-word { font-size: 40px; font-weight: 700; letter-spacing: .02em; }
.session-title {
  margin: 10px 0 0; font-size: 15px; font-weight: 600; color: var(--ink);
  max-width: 78ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.scope-line { margin: 10px 0 0; color: var(--dim); font-size: 13px; }
.archived-chip {
  margin-left: 10px; font-size: 10px; letter-spacing: .08em; color: var(--dim);
  border: 1px solid var(--line); padding: 1px 6px; font-weight: 400; vertical-align: middle;
}
.scope-line .kind {
  border: 1px solid var(--line); border-radius: 3px; padding: 1px 5px; margin-right: 8px;
  font-size: 10px; letter-spacing: .08em; color: var(--amber);
}
.scope-line code { color: var(--ink); }
.sessions { margin-top: 14px; display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  border: 1px solid var(--line); color: var(--dim); padding: 2px 8px; font-size: 11px;
  display: inline-flex; gap: 6px; align-items: center;
}
.chip i { font-style: normal; color: var(--dim); }
.chip.live { color: var(--ink); border-color: var(--amber); }
.chip.live i { color: var(--amber); }
.chip.gone { opacity: .5; }
.board {
  display: grid; grid-template-columns: 216px minmax(0, 1fr) 200px;
  gap: 0; min-height: 0;
}
.rail {
  border-right: 1px solid var(--line); padding: 18px 12px; display: flex;
  flex-direction: column; gap: 4px; align-content: start;
}
.seg {
  display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; align-items: center;
  text-align: left; background: none; border: 1px solid transparent; color: var(--dim);
  padding: 8px 6px; cursor: pointer; font: inherit; position: relative;
}
.seg:hover { border-color: var(--line); color: var(--ink); }
.seg.selected { border-color: var(--amber); color: var(--ink); }
.seg-id { font-size: 10px; letter-spacing: .1em; color: var(--dim); }
.seg.selected .seg-id { color: var(--amber); }
.seg-name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seg-status { grid-column: 2; font-size: 10px; color: var(--dim); }
.seg.done .seg-id::after, .seg.live .seg-id::after {
  content: "●"; font-size: 7px; margin-left: 5px;
}
.seg.done .seg-id::after { color: var(--ok); }
.seg.live .seg-id::after { color: var(--amber); }
.meter { grid-column: 2; height: 2px; background: var(--line); display: block; }
.meter i { display: block; height: 2px; width: var(--fill); background: var(--amber); }
.stage { padding: 18px 22px; min-width: 0; }
.sheet-block { display: none; }
.sheet-block.on { display: block; }
.sheet-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.sheet-id { font-size: 11px; letter-spacing: .18em; color: var(--amber); }
.sheet-head h2 { margin: 0; font-size: 19px; font-weight: 600; }
.badge { font-size: 10px; padding: 1px 6px; border: 1px solid var(--line); color: var(--dim); }
.badge.live { color: var(--amber); border-color: var(--amber); }
.badge.done { color: var(--ok); border-color: var(--ok); }
.sheet-counts { margin-left: auto; font-size: 11px; color: var(--dim); }
.review { margin: 12px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: 12px; color: var(--dim); }
.review dt { color: var(--dim); }
.review dd { margin: 0; color: var(--ink); }
.tasks { list-style: none; margin: 16px 0 0; padding: 0; }
.task {
  display: flex; gap: 10px; align-items: baseline; padding: 7px 8px; position: relative;
  border-left: 2px solid transparent; cursor: default;
}
.task:hover, .task:focus-within { background: var(--panel); border-left-color: var(--amber); }
.task .mark { width: 12px; color: var(--dim); font-size: 12px; }
.task.ok .mark { color: var(--ok); }
.task-text { font-size: 13px; }
.done-fold { margin: 8px 0 0; }
.done-fold summary { cursor: pointer; color: var(--dim); font-size: 12px; padding: 4px 8px; }
.done-fold summary:hover { color: var(--ink); }
.layers { margin: 18px 0 0; display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
.layer h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: .06em; color: var(--dim); display: flex; gap: 6px; align-items: baseline; }
.layer h3 .shape, .layers-legend .shape { color: var(--amber); }
.layer h3 em { margin-left: auto; font-style: normal; color: var(--dim); }
.layer ul { list-style: none; margin: 0; padding: 0; }
.slip {
  display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: baseline;
  padding: 6px 8px; border-left: 2px solid var(--line); margin-bottom: 4px; position: relative; cursor: default;
}
.slip:hover, .slip:focus-within { background: var(--panel); border-left-color: var(--amber); }
.slip.ok { border-left-color: var(--ok); }
.slip.bad { border-left-color: var(--bad); }
.slip.wait { border-left-color: var(--amber); }
.slip-shape { color: var(--dim); }
.slip.ok .slip-shape { color: var(--ok); }
.slip.bad .slip-shape { color: var(--bad); }
.slip-text { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slip-note { font-size: 10px; color: var(--dim); }
.slip.ok .slip-note { color: var(--ok); }
.slip.bad .slip-note { color: var(--bad); }
.slip.wait .slip-note { color: var(--amber); }
.ev {
  position: absolute; z-index: 4; left: 8px; right: 8px; top: calc(100% + 2px);
  background: var(--panel); border: 1px solid var(--line); padding: 8px 10px;
  font-size: 11px; color: var(--dim); opacity: 0; transform: translateY(-4px);
  pointer-events: none; transition: opacity .18s ease, transform .18s ease;
}
.task:hover .ev, .task:focus-within .ev, .slip:hover .ev, .slip:focus-within .ev {
  opacity: 1; transform: translateY(0);
}
.ev ul { margin: 0; padding-left: 14px; }
.sign {
  margin: 20px 0 0; padding: 10px 12px; border: 1px dashed var(--line);
  font-size: 12px; color: var(--dim); display: flex; gap: 10px; align-items: center;
}
.sign.gap { color: var(--bad); border-color: var(--bad); }
.sign.ready { color: var(--amber); border-color: var(--amber); }
.sign.done { color: var(--ok); border-color: var(--ok); }
.sign span { color: var(--dim); font-size: 11px; }
.pulse {
  width: 7px; height: 7px; background: var(--bad); display: inline-block;
  animation: pulse 1.8s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.facts {
  border-left: 1px solid var(--line); padding: 18px 16px;
  display: flex; flex-direction: column; gap: 12px;
}
.fact { display: flex; align-items: baseline; gap: 8px; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
.fact em { font-style: normal; font-size: 20px; font-weight: 600; }
.fact span { color: var(--dim); font-size: 11px; }
.layers-legend { list-style: none; margin: 0; padding: 0; font-size: 11px; color: var(--dim); }
.layers-legend li { display: flex; gap: 6px; align-items: baseline; padding: 2px 0; }
.layers-legend em { margin-left: auto; font-style: normal; }
.log { margin-top: 22px; border-top: 1px solid var(--line); padding-top: 12px; }
.log h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; color: var(--dim); font-weight: 500; }
.log ul { list-style: none; margin: 0; padding: 0; font-size: 11px; color: var(--dim); }
.log li { display: flex; gap: 10px; padding: 2px 0; }
.quiet { color: var(--dim); font-size: 12px; }
.empty-hint { color: var(--dim); font-size: 12px; margin-top: 14px; }
.empty-hint code { color: var(--amber); }
.command {
  border-top: 1px solid var(--line); padding: 12px 24px; display: flex; gap: 12px;
  align-items: center; background: var(--panel);
}
.command-label { font-size: 10px; letter-spacing: .16em; color: var(--amber); }
.command-text { color: var(--ink); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.copy {
  background: none; border: 1px solid var(--line); color: var(--dim); cursor: pointer;
  width: 24px; height: 24px; font-size: 12px; transition: color .2s, border-color .2s;
}
.copy:hover { color: var(--amber); border-color: var(--amber); }
.stamp { margin-left: auto; font-size: 10px; color: var(--dim); letter-spacing: .06em; }
@media (max-width: 900px) {
  .board { grid-template-columns: 1fr; }
  .rail { border-right: 0; border-bottom: 1px solid var(--line); flex-direction: row; overflow-x: auto; gap: 6px; }
  .seg { min-width: 150px; }
  .facts { border-left: 0; border-top: 1px solid var(--line); flex-direction: row; flex-wrap: wrap; }
  .fact { border-bottom: 0; }
  .session-title { white-space: normal; }
  .stamp { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
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
      },
      selected: null,
    });
  }
  const selected =
    process.env.NOEMA_VIEW_SEGMENT ??
    (focused
      ? (currentSegment(doc)?.id ?? null)
      : session.segments[session.segments.length - 1]?.id);
  return page({ doc, session, selected });
}

export function writeView(
  root = process.cwd(),
  file = path.join(root, ".work", "review", "work-view.html"),
) {
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
