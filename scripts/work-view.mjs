// Renders the current agent state, scope and staged work list into a static,
// read-only HTML page. Adapter layer: reads governance/data/state.json and
// writes .work/review/work-view.html. The state model lives in
// governance/core/state.mjs.
//
// The page is deliberately a single file: no scripts are loaded from disk
// except the inline theme/animation helpers, so it can be opened by double
// click and still behaves like a small console.
import fs from "node:fs";
import path from "node:path";

import {
  activeThread,
  emptyState,
  logOf,
  nextAction,
  upgradeState,
  validateState,
  workProgress,
} from "../governance/core/state.mjs";

const STATE_PATH = "governance/data/state.json";
const HISTORY_PATH = "governance/data/history.json";
const OUTPUT_PATH = ".work/review/work-view.html";

const STATES = [
  ["讨论", "DISCUSSION", "把问题说清楚，只产出证据"],
  ["执行", "EXECUTION", "按阶段交付，进度只记在清单里"],
  ["验收", "ACCEPTANCE", "逐层核对，签收之后才算完成"],
];

const LAYER = {
  D: ["确定性", "跑一次就能看见结果"],
  C: ["可复核", "换个知道标准的人也能复核"],
  R: ["审查发现", "交付前挑毛病，不改判通过"],
  H: ["人签收", "只有你能判断"],
};

function escape(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusTone(status) {
  if (status === "已完成" || status === "通过") return "ok";
  if (status === "不通过") return "bad";
  if (status === "进行中") return "live";
  if (status === "未验") return "wait";
  return "todo";
}

function tag(status) {
  return `<span class="tag ${statusTone(status)}">${escape(status)}</span>`;
}

function evidenceLine(list) {
  if (!list?.length) return "";
  return `<span class="evidence">${list.map(escape).join(" · ")}</span>`;
}

function acceptanceRow(item) {
  const layer = item.layer ?? "D";
  const resolution = item.resolution
    ? `<span class="resolution">处置 ${escape(item.resolution.decision)}${
        item.resolution.note ? ` · ${escape(item.resolution.note)}` : ""
      }</span>`
    : "";
  return `<li class="row accept-row" title="${escape(item.id)}">
  <span class="layer layer-${layer}" title="${escape(LAYER[layer]?.[1] ?? "")}">${layer}</span>
  <span class="grow">${escape(item.text)}${evidenceLine(item.evidence)}${resolution}</span>
  ${tag(item.status)}
</li>`;
}

function taskRow(task, index) {
  const done = task.status === "已完成";
  return `<li class="row task-row${done ? " done" : ""}" style="--i:${index}" title="${escape(task.id)}">
  <span class="check" aria-hidden="true">${done ? "✓" : ""}</span>
  <span class="grow">${escape(task.text)}${evidenceLine(task.evidence)}</span>
</li>`;
}

function phaseSection(phase, current, index) {
  const isCurrent = phase.id === current;
  const tasks = phase.tasks ?? [];
  const acceptance = phase.acceptance ?? [];
  const tasksDone = tasks.filter((task) => task.status === "已完成").length;
  const passed = acceptance.filter((item) => item.status === "通过").length;
  const blocking = acceptance.filter((item) => (item.layer ?? "D") !== "R").length;
  const tasksPercent = tasks.length ? Math.round((tasksDone / tasks.length) * 100) : 0;
  const acceptPercent = blocking ? Math.round((passed / blocking) * 100) : 0;
  const tone = isCurrent ? "live" : phase.status === "已完成" ? "ok" : "todo";
  const review = phase.review
    ? `<p class="review"><span>重审</span>验什么：${escape(phase.review.what)}<i>/</i>可能漏：${escape(
        phase.review.gap,
      )}<i>/</i>拆并：${escape(phase.review.split)}</p>`
    : "";
  const progressStrip =
    phase.status === "进行中"
      ? `<span class="phase-progress" title="任务 ${tasksDone}/${tasks.length} · 验收 ${passed}/${blocking}">
      ${tasks.length ? `<span class="bar"><i style="--w:${tasksPercent}%"></i></span><span class="mono">${tasksDone}/${tasks.length}</span>` : ""}
      <span class="bar accent"><i style="--w:${acceptPercent}%"></i></span>
      <span class="mono">${passed}/${blocking}</span>
    </span>`
      : "";
  const taskColumn = tasks.length
    ? `<div class="column">
        <h3 class="sub">任务<span class="count">${tasks.length}</span></h3>
        <ul class="rows">${tasks.map(taskRow).join("")}</ul>
      </div>`
    : "";
  const acceptColumn = `<div class="column">
        <h3 class="sub">阶段验收<span class="count">${acceptance.length}</span></h3>
        <ul class="rows">${acceptance.map(acceptanceRow).join("") || '<li class="empty">还没写验收项</li>'}</ul>
      </div>`;
  return `<details class="phase ${tone}"${isCurrent ? " open" : ""} id="${escape(phase.id)}" style="--i:${index}">
  <summary>
    <span class="phase-id">${escape(phase.id)}</span>
    <h2>${escape(phase.name)}</h2>
    ${progressStrip}
    ${isCurrent ? '<span class="tag live pulse">进行中</span>' : tag(phase.status)}
  </summary>
  <div class="phase-body">
    ${phase.goal ? `<p class="goal">${escape(phase.goal)}</p>` : ""}
    ${review}
    <div class="columns${tasks.length ? "" : " single"}">${taskColumn}${acceptColumn}</div>
  </div>
</details>`;
}

function threadBlock(thread) {
  if (!thread) {
    return `<p class="empty">当前没有活动会话；进入讨论会自动恢复最近一次归档会话。</p>`;
  }
  const rounds = thread.rounds
    .slice(-8)
    .map(
      (round) => `<li class="round">
        <span class="round-n">${String(round.n).padStart(2, "0")}</span>
        <div class="round-body">
          <span class="round-date">${escape(round.date)}</span>
          <p>${escape(round.conclusion)}</p>
          ${round.change ? `<span class="diff">${escape(round.change)}</span>` : ""}
        </div>
      </li>`,
    )
    .join("");
  const waits = thread.waits.length
    ? thread.waits
        .map((one) => `<li class="row wait-row"><span class="grow">${escape(one)}</span></li>`)
        .join("")
    : '<li class="empty">没有待裁事项</li>';
  return `<p class="thread-title">${escape(thread.title)}</p>
  <div class="columns">
    <div class="column">
      <h3 class="sub">需要你拍板<span class="count">${thread.waits.length}</span></h3>
      <ul class="rows">${waits}</ul>
    </div>
    <div class="column">
      <h3 class="sub">最近轮次<span class="count">${thread.rounds.length}</span></h3>
      <ul class="rounds">${rounds || '<li class="empty">还没有轮次</li>'}</ul>
    </div>
  </div>`;
}

function timeline(phases, current) {
  if (!phases.length) return "";
  const items = phases
    .map((phase, index) => {
      const tone = phase.status === "已完成" ? "ok" : phase.id === current ? "live" : "todo";
      return `<li class="step step-${tone}${phase.id === current ? " current" : ""}" data-jump="${escape(
        phase.id,
      )}" style="--i:${index}" title="${escape(phase.name)}">
      <span class="dot" aria-hidden="true"></span>
      <span class="step-id">${escape(phase.id)}</span>
      <span class="step-name">${escape(phase.name)}</span>
    </li>`;
    })
    .join("");
  return `<ol class="timeline" aria-label="阶段时间线">${items}</ol>`;
}

function lifecycle(state) {
  const order = STATES.map(([name, code]) => name);
  const index = order.indexOf(state);
  return `<ol class="lifecycle" aria-label="治理状态">
    ${STATES.map(
      ([name, code], position) => `<li class="lc${position === index ? " current" : ""}${
        position < index ? " passed" : ""
      }">
        <span class="lc-dot" aria-hidden="true"></span>
        <span class="lc-name">${name}</span>
        <span class="lc-code mono">${code}</span>
      </li>`,
    ).join("")}
  </ol>`;
}

function progressBlock(progress, activity = "") {
  const ratio = (done, total) => (total === 0 ? 0 : Math.round((done / total) * 100));
  const rows = [
    ["任务", progress.tasks.done, progress.tasks.total],
    ["验收", progress.acceptance.passed, progress.acceptance.total],
  ]
    .map(
      ([label, done, total]) => `<div class="stat">
        <span class="stat-label">${label}</span>
        <span class="stat-value mono">${done}/${total}</span>
        <span class="stat-bar"><i style="--w:${ratio(done, total)}%"></i></span>
      </div>`,
    )
    .join("");
  const findings = progress.acceptance.findings
    ? `<div class="stat${progress.acceptance.openFindings ? " alert" : ""}">
        <span class="stat-label">审查发现</span>
        <span class="stat-value mono">${progress.acceptance.openFindings}/${progress.acceptance.findings}</span>
        <span class="stat-note">未处置 / 总数</span>
      </div>`
    : "";
  return `<aside class="progress" aria-label="进度">
    <div class="ring" data-ring="${ratio(progress.phases.done, progress.phases.total)}" style="--value:0" aria-label="阶段完成 ${ratio(
      progress.phases.done,
      progress.phases.total,
    )}%">
      <div class="ring-inner"><b class="mono">${ratio(progress.phases.done, progress.phases.total)}</b><span>%</span><small>阶段完成</small></div>
    </div>
    <div class="stats">${rows}${findings}</div>
    <p class="legend">${Object.entries(LAYER)
      .map(
        ([layer, [name, hint]]) =>
          `<span title="${escape(hint)}"><b class="layer-${layer}">${layer}</b>${name}</span>`,
      )
      .join("")}</p>
    ${activity}
  </aside>`;
}

function nextBlock(action) {
  return `<div class="next" aria-label="下一步">
    <div class="next-head"><span class="next-label mono">NEXT</span><span>${escape(action.label)}</span></div>
    <div class="next-cmd">
      <code>${escape(action.command)}</code>
      <button class="copy" type="button" data-copy="${escape(action.command)}" title="复制命令">复制</button>
    </div>
    <p class="next-detail">${escape(action.detail)}</p>
  </div>`;
}

export function renderView(doc, now = new Date(), history = []) {
  const progress = workProgress(doc);
  const state = doc.current.state;
  const action = nextAction(doc);
  const scope = doc.work?.scope ?? null;
  const phases = doc.work?.phases ?? [];
  const currentPhase = phases.find((phase) => phase.status === "进行中")?.id ?? null;
  const thread = doc.current.threadId
    ? doc.threads.find((one) => one.id === doc.current.threadId)
    : activeThread(doc);
  const recent = logOf(doc, { limit: 5 })
    .map(
      (entry) => `<li class="row log-row">
      <span class="log-date mono">${escape(entry.date)}</span>
      <span class="log-flow mono">${escape(entry.from ?? "起始")}<i>→</i>${escape(entry.to)}</span>
      <span class="log-reason grow">${escape(entry.reason)}</span>
    </li>`,
    )
    .join("");
  const activity = `<div class="activity">
    <span class="activity-label mono">RECENT · 近期动态</span>
    <ul class="rows">${logOf(doc, { limit: 3 })
      .slice()
      .reverse()
      .map(
        (entry) => `<li class="row activity-row" title="${escape(entry.reason)}">
      <span class="activity-date mono">${escape(String(entry.date).slice(5))}</span>
      <span class="grow">${escape(entry.from ?? "起始")} → ${escape(entry.to)}</span>
    </li>`,
      )
      .join("")}</ul>
  </div>`;
  const folder = (label, inner, open) =>
    `<details class="fold"${open ? " open" : ""}><summary><span>${escape(label)}</span></summary><div class="fold-body">${inner}</div></details>`;
  const scopeHtml = scope
    ? `<div class="scope">
      <div class="scope-head"><span class="scope-kind mono">${escape(scope.kind)}</span>${
        scope.signed
          ? `<span class="signed">已签收 · ${escape(scope.signed.date)}</span>`
          : '<span class="signed wait">尚未签收</span>'
      }</div>
      <p>${escape(scope.text)}</p>
      ${
        scope.signed
          ? `<p class="quote">「${escape(scope.signed.text)}」</p>`
          : `<p class="meta">始于 ${escape(String(scope.since).slice(0, 10))}</p>`
      }
    </div>`
    : `<div class="scope empty-scope">还没有声明范围：<code>npm run state -- scope "…"</code></div>`;
  const phaseSections = phases
    .map((phase, index) => phaseSection(phase, currentPhase, index))
    .join("");
  const historyHtml = history.length
    ? history
        .slice(-3)
        .reverse()
        .map(
          (item) =>
            `<li class="row"><span class="grow">${escape(item.scope?.text ?? "(无范围)")}</span><span class="meta mono">${escape(
              item.archivedAt?.slice(0, 10) ?? "",
            )}</span></li>`,
        )
        .join("")
    : "";
  const stamp = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
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
<title>Noema 工作台</title>
<style>
@property --value { syntax: "<number>"; inherits: false; initial-value: 0; }
:root {
  --bg: #0d1014;
  --bg-soft: #12161c;
  --panel: #151b22;
  --panel-2: #1a212a;
  --line: #29323d;
  --line-soft: #202832;
  --ink: #e9eef4;
  --ink-2: #c4cdd7;
  --muted: #8894a1;
  --accent: #ffc45c;
  --accent-dim: #a97d2a;
  --ok: #6fd6a3;
  --bad: #ff7b6e;
  --wait: #d9b25c;
  --live: #74c6ff;
  --R: #b995ff;
  --mono: "JetBrains Mono", "Cascadia Mono", "Consolas", "SFMono-Regular", monospace;
  --sans: "Segoe UI Variable", "Segoe UI", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
}
html[data-theme="light"] {
  --bg: #f4f1ea; --bg-soft: #ebe7de; --panel: #fbf9f5; --panel-2: #f1eee7;
  --line: #d8d2c6; --line-soft: #e4dfd5; --ink: #1d2125; --ink-2: #3c434a;
  --muted: #6d747c; --accent: #a86800; --accent-dim: #cf9b3a;
  --ok: #1c7a52; --bad: #b03428; --wait: #8a6a12; --live: #15618f; --R: #6b47a8;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background:
    repeating-linear-gradient(135deg, rgba(255,255,255,.012) 0 2px, transparent 2px 9px),
    radial-gradient(1000px 380px at 88% -8%, rgba(255,196,92,.09), transparent 60%),
    var(--bg);
  color: var(--ink);
  font: 15px/1.6 var(--sans);
  -webkit-font-smoothing: antialiased;
}
body::after {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 9;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,.028) 0 1px, transparent 1px 4px);
  opacity: .35; animation: drift 9s linear infinite;
}
@keyframes drift { to { background-position: 0 40px; } }
.shell { max-width: 1080px; margin: 0 auto; padding: 26px 26px 64px; }
.mono, .tag, .state-code, .num, code, .step, .next { font-family: var(--mono); font-variant-numeric: tabular-nums; }
code { font-size: 12px; }

.topbar { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 10px; }
.brand-mark { width: 10px; height: 24px; background: var(--accent); clip-path: polygon(0 0, 100% 24%, 100% 100%, 0 76%); }
.brand-name { font: 12px var(--mono); letter-spacing: .32em; color: var(--ink-2); }
.brand-sub { font-size: 10px; color: var(--muted); letter-spacing: .1em; }
.grow-space { flex: 1; }
button { font: inherit; cursor: pointer; }
button.theme, button.copy {
  font: 10px var(--mono); letter-spacing: .12em; text-transform: uppercase;
  background: transparent; color: var(--muted); border: 1px solid var(--line);
  padding: 5px 9px; transition: color .2s, border-color .2s, background .2s;
}
button.theme:hover, button.copy:hover { color: var(--accent); border-color: var(--accent-dim); }
button.theme:focus-visible, button.copy:focus-visible, .step:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }

.hero { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(250px, .95fr); gap: 24px; padding: 26px 0 18px; }
.state-line { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.state-code { font-size: 10px; letter-spacing: .4em; color: var(--accent); }
.state-name { font-size: clamp(34px, 5vw, 50px); font-weight: 650; letter-spacing: .02em; margin: 0; line-height: 1.06; }
.state-desc { color: var(--muted); margin: 8px 0 0; font-size: 13px; }

.lifecycle { display: flex; gap: 0; list-style: none; margin: 18px 0 0; padding: 0; border: 1px solid var(--line-soft); }
.lc { flex: 1; display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-right: 1px solid var(--line-soft); }
.lc:last-child { border-right: 0; }
.lc-dot { width: 6px; height: 6px; border: 1px solid var(--line); transform: rotate(45deg); flex: none; }
.lc-name { font-size: 12px; color: var(--muted); }
.lc-code { font-size: 9px; color: var(--muted); opacity: .6; }
.lc.passed .lc-dot { background: var(--ok); border-color: var(--ok); }
.lc.current { background: linear-gradient(90deg, rgba(255,196,92,.12), transparent); }
.lc.current .lc-dot { background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 3px rgba(255,196,92,.16); }
.lc.current .lc-name { color: var(--accent); font-weight: 600; }

.next { margin-top: 18px; border-left: 2px solid var(--accent); background: linear-gradient(90deg, rgba(255,196,92,.10), transparent 72%); padding: 10px 14px; }
.next-head { display: flex; align-items: baseline; gap: 10px; }
.next-label { font-size: 9px; letter-spacing: .3em; color: var(--accent); }
.next-head span:last-child { color: var(--ink); font-size: 14px; font-family: var(--sans); font-weight: 500; }
.next-cmd { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.next-cmd code { flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; color: var(--ink-2); font-size: 11px; padding: 5px 8px; background: var(--bg-soft); border: 1px solid var(--line-soft); }
.next-detail { margin: 7px 0 0; color: var(--muted); font-size: 11px; }

.scope { margin-top: 18px; background: var(--panel); border: 1px solid var(--line); border-left: 2px solid var(--accent-dim); padding: 12px 15px; transition: border-color .25s, transform .25s; }
.scope:hover { border-left-color: var(--accent); }
.scope-head { display: flex; align-items: center; gap: 10px; }
.scope-kind { font-size: 9px; letter-spacing: .22em; color: var(--accent); border: 1px solid var(--accent-dim); padding: 1px 6px; }
.signed { font-size: 10px; color: var(--ok); }
.signed.wait { color: var(--wait); }
.scope p { margin: 8px 0 0; font-size: 16px; line-height: 1.45; color: var(--ink); }
.scope .quote { font-size: 11px; color: var(--muted); }
.empty-scope { color: var(--muted); font-size: 13px; }

.progress { background: var(--panel); border: 1px solid var(--line); padding: 16px; align-self: start; }
.ring { --value: 0; width: 128px; height: 128px; margin: 2px auto 14px; border-radius: 50%;
  background: conic-gradient(var(--accent) calc(var(--value) * 1%), var(--line-soft) 0);
  display: grid; place-items: center; position: relative; transition: --value 900ms cubic-bezier(.22,.8,.2,1); }
.ring::before { content: ""; position: absolute; inset: -5px; border-radius: 50%; border: 1px dashed var(--line-soft); opacity: .6; }
.ring::after { content: ""; position: absolute; inset: 9px; border-radius: 50%; background: var(--panel); }
.ring-inner { position: relative; z-index: 1; text-align: center; line-height: 1.1; }
.ring-inner b { font-size: 32px; }
.ring-inner span { font-size: 12px; color: var(--muted); }
.ring-inner small { display: block; font-size: 9px; letter-spacing: .22em; color: var(--muted); margin-top: 2px; }
.stats { display: grid; gap: 9px; }
.stat { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: baseline; }
.stat-label { font-size: 11px; color: var(--muted); }
.stat-value { font-size: 13px; color: var(--ink); }
.stat-bar { grid-column: 1 / -1; height: 2px; background: var(--line-soft); }
.stat-bar i { display: block; height: 100%; width: var(--w); background: var(--accent); }
.stat.alert .stat-value { color: var(--bad); }
.stat-note { grid-column: 1 / -1; font-size: 9px; color: var(--muted); letter-spacing: .1em; }
.legend { margin: 13px 0 0; padding-top: 11px; border-top: 1px solid var(--line-soft); display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 10px; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.legend b { width: 15px; height: 15px; display: grid; place-items: center; font: 9px var(--mono); border: 1px solid currentColor; }
.activity { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line-soft); }
.activity-label { display: block; font-size: 9px; letter-spacing: .2em; color: var(--muted); margin-bottom: 6px; }
.activity-row { font-size: 11px; padding: 3px 0; }
.activity-date { color: var(--muted); font-size: 10px; min-width: 38px; }
.activity-row .grow { color: var(--ink-2); }

.timeline { display: flex; list-style: none; margin: 4px 0 22px; padding: 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.step { flex: 1; position: relative; padding: 12px 12px 10px; border-right: 1px solid var(--line-soft); min-width: 0; cursor: pointer; transition: background .25s; }
.step:last-child { border-right: 0; }
.step:hover { background: var(--panel); }
.step .dot { position: absolute; top: -4px; left: 11px; width: 6px; height: 6px; background: var(--line); transform: rotate(45deg); }
.step-ok .dot { background: var(--ok); }
.step-live .dot { background: var(--live); }
.step.current { background: linear-gradient(180deg, rgba(116,198,255,.12), transparent); }
.step.current .dot { animation: pulse 2.2s ease-in-out infinite; }
.step.active { background: linear-gradient(180deg, rgba(255,196,92,.14), transparent); }
.step.active .dot { background: var(--accent); }
.step-id { display: block; font: 9px var(--mono); letter-spacing: .18em; color: var(--muted); }
.step-name { display: block; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--sans); }
.step-ok .step-name { color: var(--ink-2); }
.step.current .step-name { color: var(--ink); font-weight: 600; }
@keyframes pulse { 50% { box-shadow: 0 0 0 5px rgba(116,198,255,.14); } }

.phase { background: var(--panel); border: 1px solid var(--line); margin-bottom: 10px; transition: border-color .25s; }
.phase + .phase { margin-top: 0; }
.phase.todo { opacity: .78; }
.phase.live { border-left: 2px solid var(--live); }
.phase.flash { animation: flash 1.4s ease-out; }
@keyframes flash { 0% { background: rgba(255,196,92,.10); } 100% { background: var(--panel); } }
.phase > summary { display: flex; align-items: center; gap: 10px; padding: 13px 16px; cursor: pointer; list-style: none; flex-wrap: wrap; }
.phase > summary::-webkit-details-marker { display: none; }
.phase > summary::before { content: "+"; font: 11px var(--mono); color: var(--accent); width: 9px; flex: none; }
.phase[open] > summary::before { content: "−"; }
.phase > summary:hover { background: var(--panel-2); }
.phase > summary:focus-visible { outline: 1px solid var(--accent); outline-offset: -2px; }
.phase-body { padding: 0 18px 14px; }
.phase-id { font: 10px var(--mono); letter-spacing: .2em; color: var(--muted); }
.phase h2 { margin: 0; font-size: 15px; font-weight: 600; flex: 1; min-width: 0; }
.phase-progress { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; color: var(--muted); }
.bar { width: 34px; height: 2px; background: var(--line-soft); }
.bar i { display: block; height: 100%; width: var(--w); background: var(--ok); }
.bar.accent i { background: var(--accent); }
.goal { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
.review { margin: 9px 0 0; font-size: 11px; color: var(--muted); }
.review span { color: var(--accent); letter-spacing: .18em; margin-right: 8px; }
.review i { color: var(--line); font-style: normal; margin: 0 6px; }
.columns { display: grid; grid-template-columns: minmax(0, .95fr) minmax(0, 1.2fr); gap: 20px; }
.columns.single { grid-template-columns: 1fr; }
.sub { display: flex; gap: 7px; align-items: baseline; margin: 14px 0 6px; font-size: 10px; letter-spacing: .18em; color: var(--muted); font-weight: 500; }
.count { font-family: var(--mono); color: var(--ink-2); }
.rows { list-style: none; margin: 0; padding: 0; }
.row { display: flex; gap: 9px; align-items: flex-start; padding: 6px 4px; border-bottom: 1px solid var(--line-soft); transition: background .2s, padding .2s; }
.row:hover { background: var(--panel-2); padding-left: 7px; }
.rows > .row:last-child { border-bottom: 0; }
.task-row .check { width: 13px; height: 13px; margin-top: 3px; border: 1px solid var(--line); display: grid; place-items: center; font-size: 9px; color: var(--bg); flex: none; }
.task-row.done .check { background: var(--ok); border-color: var(--ok); color: #08130c; }
.task-row.done .grow { color: var(--muted); }
.grow { flex: 1; min-width: 0; font-size: 13px; color: var(--ink-2); }
.evidence { display: block; font: 10px var(--mono); color: var(--muted); margin-top: 2px; }
.tag { font-size: 9px; letter-spacing: .1em; padding: 1px 6px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.tag.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
.tag.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, transparent); }
.tag.live { color: var(--live); border-color: color-mix(in srgb, var(--live) 45%, transparent); }
.tag.pulse { animation: soft 2.4s ease-in-out infinite; }
@keyframes soft { 50% { opacity: .62; } }
.tag.wait { color: var(--wait); border-color: color-mix(in srgb, var(--wait) 45%, transparent); }
.layer { flex: none; font: 9px var(--mono); width: 17px; height: 17px; display: grid; place-items: center; border: 1px solid var(--line); color: var(--muted); margin-top: 2px; }
.layer-D { color: var(--live); border-color: color-mix(in srgb, var(--live) 40%, transparent); }
.layer-C { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
.layer-R { color: var(--R); border-color: color-mix(in srgb, var(--R) 40%, transparent); }
.layer-H { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.resolution { display: block; font-size: 10px; color: var(--wait); margin-top: 1px; }
.wait-row { border-left: 2px solid var(--wait); padding-left: 9px; }

.thread-title { margin: 0 0 2px; color: var(--ink-2); font-size: 14px; }
.rounds { list-style: none; margin: 6px 0 0; padding: 0; }
.round { display: flex; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line-soft); }
.round:last-child { border-bottom: 0; }
.round-n { font: 10px var(--mono); color: var(--muted); padding-top: 2px; }
.round-date { font: 10px var(--mono); color: var(--muted); }
.round-body p { margin: 2px 0 0; font-size: 12px; color: var(--ink-2); }
.diff { display: inline-block; margin-top: 3px; font: 10px var(--mono); color: var(--wait); }
.log-row { align-items: baseline; }
.log-date { font-size: 10px; color: var(--muted); }
.log-flow { font-size: 10px; color: var(--ink-2); white-space: nowrap; }
.log-flow i { color: var(--accent); font-style: normal; margin: 0 4px; }
.log-reason { font-size: 12px; color: var(--muted); }
.meta { color: var(--muted); font-size: 11px; }
.empty { color: var(--muted); font-size: 12px; margin: 8px 0; }

.fold { margin-top: 12px; border-top: 1px solid var(--line); }
.fold > summary { cursor: pointer; padding: 11px 0; font: 11px var(--mono); letter-spacing: .2em; color: var(--muted); list-style: none; display: flex; align-items: center; gap: 8px; }
.fold > summary::-webkit-details-marker { display: none; }
.fold > summary::before { content: "+"; color: var(--accent); width: 10px; }
.fold[open] > summary::before { content: "−"; }
.fold > summary:hover { color: var(--ink); }
.fold-body { padding-bottom: 6px; }
footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid var(--line); font: 10px var(--mono); color: var(--muted); display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; letter-spacing: .08em; }

.toast { position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 12px); background: var(--panel-2); border: 1px solid var(--accent-dim); color: var(--ink); font: 11px var(--mono); padding: 7px 12px; opacity: 0; pointer-events: none; transition: opacity .25s, transform .25s; z-index: 20; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }

@media (max-width: 860px) {
  .shell { padding: 18px 15px 48px; }
  .hero { grid-template-columns: 1fr; gap: 16px; }
  .columns { grid-template-columns: 1fr; gap: 8px; }
  .timeline { overflow-x: auto; }
  .step { flex: 0 0 44%; }
  .lc-code { display: none; }
}
@media (max-width: 560px) {
  body { font-size: 14px; }
  .topbar { flex-wrap: wrap; row-gap: 8px; }
  .brand-name { letter-spacing: .16em; font-size: 10px; }
  .brand-sub { display: none; }
  .grow-space { display: none; }
  button.theme { margin-left: auto; }
  .state-name { font-size: 34px; }
  .hero { padding: 18px 0 12px; }
  .lc { padding: 6px 7px; gap: 5px; }
  .lc-name { font-size: 11px; }
  .ring { width: 104px; height: 104px; }
  .progress { padding: 13px; }
  .phase { padding: 13px; }
  .phase-progress { display: none; }
  .step { flex: 0 0 62%; }
  .next-cmd { flex-wrap: wrap; }
  .next-cmd code { flex: 1 1 100%; white-space: pre-wrap; overflow-wrap: anywhere; overflow-x: visible; font-size: 10px; }
  .next-cmd .copy { margin-left: auto; }
  .stats { gap: 7px; }
}
@media (prefers-reduced-motion: reduce) {
  body::after { animation: none; }
  .ring { transition: none; }
  .phase { animation: none; }
  .step.current .dot, .tag.pulse { animation: none; }
  .phase.flash { animation: none; }
}
@media print {
  body { background: #fff; color: #000; }
  body::after { display: none; }
  .fold-body { display: block; }
  button { display: none; }
}
</style>
</head>
<body>
<div class="shell">
  <div class="topbar">
    <span class="brand-mark"></span>
    <div class="brand">
      <span class="brand-name">NOEMA // GOVERNANCE</span>
      <span class="brand-sub">状态驱动 · 只读工作台</span>
    </div>
    <span class="grow-space"></span>
    <button class="theme" type="button" data-theme-toggle aria-pressed="false" title="切换明暗（快捷键 T）">LIGHT</button>
  </div>

  <section class="hero">
    <div>
      <div class="state-line">
        <span class="state-code">${STATES.find(([name]) => name === state)?.[1] ?? ""}</span>
        <p class="state-desc">${escape(STATES.find(([name]) => name === state)?.[2] ?? "")}</p>
      </div>
      <h1 class="state-name">${escape(state)}</h1>
      ${lifecycle(state)}
      ${nextBlock(action)}
      ${scopeHtml}
    </div>
    ${progressBlock(progress, activity)}
  </section>

  ${timeline(phases, currentPhase)}

  ${folder("阶段 · 任务 · 验收", phaseSections || '<p class="empty">还没有阶段：npm run state -- phase add --name "…"</p>', true)}
  ${folder(
    thread && thread.waits.length ? `讨论会话 · ${thread.waits.length} 项待裁` : "讨论会话",
    threadBlock(thread),
    state === "讨论",
  )}
  ${folder("最近切换", `<ul class="rows">${recent || '<li class="empty">还没有切换记录</li>'}</ul>`, false)}
  ${history.length ? folder("历史归档", `<ul class="rows">${historyHtml}</ul>`, false) : ""}

  <footer>
    <span>${stamp} 生成 · npm run work:view 重新生成</span>
    <span>${phases.length} 阶段 · ${progress.tasks.total} 任务 · ${progress.acceptance.total} 验收项</span>
  </footer>
</div>
<div class="toast" data-toast role="status" aria-live="polite"></div>
<script>
  const root = document.documentElement;
  const themeButton = document.querySelector("[data-theme-toggle]");
  const toast = document.querySelector("[data-toast]");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const saved = localStorage.getItem("noema-work-theme");
  if (saved) applyTheme(saved);
  else paintTheme(root.dataset.theme);

  themeButton.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("noema-work-theme", next);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "t" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem("noema-work-theme", next);
    }
  });

  function applyTheme(theme) {
    root.dataset.theme = theme;
    paintTheme(theme);
  }
  function paintTheme(theme) {
    const dark = theme === "dark";
    themeButton.textContent = dark ? "LIGHT" : "DARK";
    themeButton.setAttribute("aria-pressed", String(!dark));
  }

  const ring = document.querySelector(".ring");
  if (ring) {
    const target = Number(ring.dataset.ring || 0);
    if (reduceMotion) ring.style.setProperty("--value", String(target));
    else requestAnimationFrame(() => requestAnimationFrame(() => ring.style.setProperty("--value", String(target))));
  }

  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const text = button.dataset.copy || "";
      try {
        await navigator.clipboard.writeText(text);
        showToast("已复制命令");
      } catch {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.append(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        showToast("已复制命令");
      }
    });
  });

  let toastTimer = 0;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
  }

  const steps = [...document.querySelectorAll("[data-jump]")];
  steps.forEach((step) => {
    const jump = () => {
      const target = document.getElementById(step.dataset.jump);
      if (!target) return;
      if (target instanceof HTMLDetailsElement) target.open = true;
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      target.classList.remove("flash");
      void target.offsetWidth;
      target.classList.add("flash");
      steps.forEach((one) => one.classList.toggle("active", one === step));
    };
    step.addEventListener("click", jump);
    step.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        jump();
      }
    });
    step.tabIndex = 0;
  });

</script>
</body>
</html>`;
}

export function writeView(root = process.cwd(), output = OUTPUT_PATH, now = new Date()) {
  const file = path.join(root, STATE_PATH);
  const doc = fs.existsSync(file)
    ? upgradeState(JSON.parse(fs.readFileSync(file, "utf8")))
    : emptyState(now);
  const errors = validateState(doc);
  if (errors.length > 0) throw new Error(`状态数据不合规：${errors.join("；")}`);
  const historyFile = path.join(root, HISTORY_PATH);
  const history = fs.existsSync(historyFile)
    ? JSON.parse(fs.readFileSync(historyFile, "utf8"))
    : [];
  const target = path.join(root, output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderView(doc, now, history), "utf8");
  return { file: target, progress: workProgress(doc) };
}

if (process.argv[1] && process.argv[1].endsWith("work-view.mjs")) {
  try {
    const result = writeView();
    console.log(`工作台：${path.relative(process.cwd(), result.file)}`);
    console.log(
      `阶段 ${result.progress.phases.done}/${result.progress.phases.total} · 任务 ${result.progress.tasks.done}/${result.progress.tasks.total} · 验收 ${result.progress.acceptance.passed}/${result.progress.acceptance.total}`,
    );
  } catch (error) {
    console.error(`work-view: ${error.message}`);
    process.exitCode = 1;
  }
}
