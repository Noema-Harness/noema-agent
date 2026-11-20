// Renders the agent state as one static HTML console: sessions on the left, the focused
// delivery in the middle, the numbers and recent switches on the right. Adapter only:
// reads governance/data/state.json, writes .work/review/work-view.html. The model lives
// in governance/core/state.mjs.
//
// Design rules the page obeys:
// - one focus: the segment in progress, its name and how far it is
// - every fact is reachable: sessions, segments, tasks, gates, discussion, switches
// - evidence opens in place, never as a floating tip
// - motion follows real activity (live / idle / standby), and the clock is the page's
//   only claim to being current
import fs from "node:fs";
import path from "node:path";

import {
  activeThread,
  focusSession,
  nextAction,
  sessionProgress,
  upgradeState,
  validateState,
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

function minutesSince(iso, now) {
  if (!iso) return null;
  return Math.max(0, Math.floor((now - new Date(iso)) / 60000));
}

// The newest moment a session really moved. Used only to pick the motion register.
function lastTouch(session) {
  const stamps = [session.since];
  for (const segment of session.segments ?? []) {
    stamps.push(segment.createdAt, segment.startedAt, segment.doneAt);
    for (const task of segment.tasks ?? []) stamps.push(task.createdAt, task.doneAt);
    for (const item of segment.acceptance ?? []) stamps.push(item.createdAt, item.doneAt);
  }
  return stamps.filter(Boolean).sort().at(-1) ?? null;
}

function relative(iso, now) {
  const minutes = minutesSince(iso, now);
  if (minutes === null) return "还没有动作";
  if (minutes < 1) return "刚刚有动作";
  if (minutes < 60) return `${minutes} 分钟前有动作`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前有动作`;
  return `${Math.floor(hours / 24)} 天前有动作`;
}

function taskRow(task, segment) {
  const done = task.status === "已完成";
  const evidence = task.evidence?.length
    ? task.evidence.map((line) => `<p>${escape(line)}</p>`).join("")
    : "还没有证据";
  return `<li class="item ${done ? "done" : ""}">
    <button class="row" type="button" aria-expanded="false" data-toggle>
      <span class="mark" aria-hidden="true">${done ? "✓" : "·"}</span>
      <span class="row-text">${escape(task.text)}</span>
      <span class="row-tag">${done ? "完成" : "未完成"}</span>
    </button>
    <div class="fold"><div class="fold-in"><div class="ev">${evidence}</div></div></div>
  </li>`;
}

function acceptanceRow(item) {
  const layer = item.layer ?? "D";
  const state = tone(item.status);
  const resolution = item.resolution
    ? `<em class="res">${escape(item.resolution.decision)}${item.resolution.note ? ` · ${escape(item.resolution.note)}` : ""}</em>`
    : "";
  const tag = item.resolution
    ? "已处置"
    : layer === "H" && item.status !== "通过"
      ? "等你"
      : layer === "R"
        ? "未处置"
        : state === "ok"
          ? "通过"
          : state === "bad"
            ? "不通过"
            : "未判";
  const evidence = item.evidence?.length
    ? item.evidence.map((line) => `<p>${escape(line)}</p>`).join("")
    : "还没有证据";
  return `<li class="item gate ${state}">
    <button class="row" type="button" aria-expanded="false" data-toggle>
      <span class="shape shape-${layer}" aria-hidden="true">${LAYER_SHAPE[layer]}</span>
      <span class="row-text">${escape(item.text)}${resolution}</span>
      <span class="row-tag">${tag}</span>
    </button>
    <div class="fold"><div class="fold-in"><div class="ev">${evidence}</div></div></div>
  </li>`;
}

function segmentBlock(segment, currentId, index) {
  const tasks = segment.tasks ?? [];
  const gates = segment.acceptance ?? [];
  const blocking = gates.filter((item) => (item.layer ?? "D") !== "R");
  const passed = blocking.filter((item) => item.status === "通过").length;
  const current = segment.id === currentId;
  const done = segment.status === "已完成";
  const name = segment.name ?? `日常 ${segment.id.replace("P", "")}`;
  const summary = done ? "✓" : current && blocking.length ? `${passed}/${blocking.length}` : "";
  return `<li class="seg ${done ? "done" : current ? "live" : "idle"}${current ? " open" : ""}" data-seg="${escape(segment.id)}" style="--i:${index}">
    <button class="seg-head" type="button" aria-expanded="${current ? "true" : "false"}" aria-controls="body-${escape(segment.id)}">
      <span class="dot" aria-hidden="true"></span>
      <span class="seg-name">${escape(name)}</span>
      <span class="seg-meta">${escape(summary)}</span>
    </button>
    <div class="seg-body" id="body-${escape(segment.id)}">
      <div class="seg-inner">
        ${tasks.length ? `<ul class="items">${tasks.map((task) => taskRow(task, segment)).join("")}</ul>` : ""}
        ${gates.length ? `<ul class="items gates">${gates.map(acceptanceRow).join("")}</ul>` : ""}
        ${!tasks.length && !gates.length ? `<p class="quiet">这一段还没有条目。</p>` : ""}
      </div>
    </div>
  </li>`;
}

function shortDate(iso) {
  return iso ? String(iso).slice(0, 16).replace("T", " ") : "—";
}

function threadBlock(session) {
  const thread = session.threadId
    ? (session.threads ?? []).find((one) => one.id === session.threadId)
    : null;
  const rounds = (thread?.rounds ?? []).slice(-6).reverse();
  const waits = thread?.waits ?? [];
  const switches = session.log ?? [];
  return `<section class="thread">
    <h2 class="thread-title">讨论记录 <span>${rounds.length ? `${thread.rounds.length} 轮` : "没有轮次"}</span></h2>
    ${waits.length ? `<ul class="waits">${waits.map((item) => `<li><span aria-hidden="true">◇</span>${escape(item)}</li>`).join("")}</ul>` : ""}
    ${rounds.length ? `<ol class="rounds">${rounds.map((round) => `<li><time>${escape(round.date)}</time><p>${escape(round.summary ?? round.conclusion ?? "")}</p></li>`).join("")}</ol>` : `<p class="quiet">这一轮还没有记下轮次结论。</p>`}
    <p class="thread-foot">始于 ${shortDate(session.since)} · ${switches.length ? `切换 ${switches.length} 次` : "还没有切过状态"}</p>
  </section>`;
}

function sessionSection(session, focused, now) {
  const progress = sessionProgress(session);
  const all = (session.segments ?? []).map((segment, index) => ({
    ...segment,
    index: index + 1,
    name: segment.name ?? `日常 ${segment.id.replace("P", "")}`,
  }));
  // Empty segments with nothing in them are noise: only keep what carries a name,
  // work, or the work in progress.
  const segments = all.filter(
    (segment) =>
      segment.name.startsWith("日常") === false ||
      segment.tasks.length ||
      segment.acceptance.length ||
      segment.status === "进行中",
  );
  const current = all.find((segment) => segment.status === "进行中");
  const index = String(current ? current.index : Math.max(all.length, 1)).padStart(2, "0");
  const total = String(Math.max(all.length, 1)).padStart(2, "0");
  const focus = current ?? all.at(-1) ?? null;
  const doneRatio = segments.length
    ? Math.round((progress.segmentsDone / segments.length) * 100)
    : 0;
  const scope = session.scope;
  const code = STATE_CODE[session.state] ?? session.state;
  return `<section class="sess" data-session="${escape(session.id)}"${focused ? "" : " hidden"}>
    <header class="sess-head">
      <span class="code" data-code="${escape(code)}">${escape(code)}</span>
      <h1 class="title">${escape(session.title)}</h1>
      <span class="chip">${escape(session.status === "archived" ? "已归档" : `${progress.segmentsDone}/${progress.segments || 0} 段`)}</span>
    </header>

    <div class="focus" style="--done:${doneRatio}%">
      <div class="focus-line">
        <span class="number">${index}</span><span class="of">/ ${total}</span>
        <h2 class="focus-name">${escape(focus?.name ?? "还没有段落")}</h2>
      </div>
      <div class="rule" aria-hidden="true"></div>
      ${
        scope
          ? `<p class="scope"><span class="kind">${escape(scope.kind)}</span>${escape(scope.text)}${
              session.scope?.signed
                ? `<span class="signed">已签收 ${escape(scope.signed.date)}</span>`
                : ""
            }</p>`
          : `<p class="scope quiet">这一轮还没有写范围；先说要交付什么。</p>`
      }
      <ol class="spine">${segments.map((segment, i) => segmentBlock(segment, current?.id ?? null, i)).join("")}</ol>
      ${threadBlock(session)}
    </div>
  </section>`;
}

function aside(doc, sessions, now) {
  const focused = focusSession(doc);
  const progress = focused ? sessionProgress(focused) : null;
  const trail = (doc.log ?? []).slice(-5).reverse();
  const action = nextAction(doc);
  const owner = /accept human|--text/.test(action.command ?? "")
    ? "你"
    : /sign/.test(action.command ?? "")
      ? "你"
      : /--decision/.test(action.command ?? "")
        ? "你或 agent"
        : "agent";
  return `<aside class="meta">
    <div class="counts">
      <div><b>${progress ? progress.segmentsDone : 0}</b><span>段完成</span></div>
      <div><b>${progress ? progress.tasksDone : 0}/${progress ? progress.tasks : 0}</b><span>任务</span></div>
      <div><b>${progress ? progress.acceptanceDone : 0}/${progress ? progress.acceptance : 0}</b><span>判据</span></div>
      <div class="${progress && progress.openFindings ? "warn" : ""}"><b>${progress ? progress.openFindings : 0}</b><span>未处置发现</span></div>
    </div>
    <div class="next">
      <p class="next-label">下一步 · ${escape(owner)}</p>
      <p class="next-text">${escape(action.label)}</p>
      ${action.detail ? `<p class="next-note">${escape(action.detail)}</p>` : ""}
      ${
        action.command
          ? `<details class="next-cmd"><summary>agent 会执行什么</summary><code>${escape(action.command)}</code></details>`
          : ""
      }
    </div>
    <div class="trail">
      <p class="trail-label">最近切换</p>
      ${trail.length ? `<ol>${trail.map((entry) => `<li><time>${escape(entry.date)}</time><span>${escape(entry.from ?? "新")} → ${escape(entry.to)}</span><em>${escape(entry.sessionId ?? "")}</em></li>`).join("")}</ol>` : `<p class="quiet">还没有切换过状态。</p>`}
      ${
        (doc.log ?? []).length > trail.length
          ? `<details class="trail-all"><summary>全部 ${doc.log.length} 次</summary><ol>${(
              doc.log ?? []
            )
              .slice()
              .reverse()
              .map(
                (entry) =>
                  `<li><time>${escape(entry.date)}</time><span>${escape(entry.from ?? "新")} → ${escape(entry.to)}</span><em>${escape(entry.sessionId ?? "")}</em></li>`,
              )
              .join("")}</ol></details>`
          : ""
      }
    </div>
    <div class="foot">
      <span class="activity"><i aria-hidden="true"></i><span id="activity">${escape(activityText(focused, now))}</span></span>
      <span>state.json · v${escape(doc.version)}</span>
    </div>
  </aside>`;
}

function activityText(session, now) {
  if (!session) return "没有在推进的会话";
  if (session.status === "archived") return "已归档";
  return relative(lastTouch(session), now);
}

function activityOf(session, now) {
  if (!session || session.status === "archived") return "standby";
  const minutes = minutesSince(lastTouch(session), now);
  return minutes !== null && minutes <= 10 ? "live" : "idle";
}

/**
 * @param {object} doc state document
 * @param {Date} now render time
 * @returns {string} complete HTML page
 */
export function renderView(doc, now = new Date()) {
  validateState(doc);
  const focused = focusSession(doc);
  const sessions = doc.sessions ?? [];
  const activity = activityOf(focused, now);
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
<title>治理台</title>
<style>
:root {
  --bg: #0a0c0f; --panel: #0f1318; --ink: #eef2f6; --ink-2: #b9c2cc; --muted: #8b96a3;
  --line: #1a2027; --line-2: #2b3743;
  --accent: #f0b429; --ok: #5cc08d; --bad: #ef6a5c;
  --mono: "JetBrains Mono", "Cascadia Mono", "Consolas", ui-monospace, monospace;
  --sans: "Segoe UI Variable", "Segoe UI", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
}
html[data-theme="light"] {
  --bg: #f1ece1; --panel: #faf7f0; --ink: #14181c; --ink-2: #3b444d; --muted: #5f666e;
  --line: #d8d2c4; --line-2: #cec6b4; --accent: #9a6400; --ok: #1f7a52; --bad: #a8382c;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--bg); color: var(--ink); font: 14px/1.55 var(--sans); }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code, .mono { font-family: var(--mono); }
[hidden] { display: none !important; }

.app {
  min-height: 100%; display: grid; grid-template-columns: 232px minmax(0, 1fr) 292px;
}
/* left: every session is reachable */
.nav { border-right: 1px solid var(--line); padding: 22px 14px; display: flex; flex-direction: column; gap: 18px; }
.brand { display: flex; align-items: center; gap: 9px; font: 11px var(--mono); letter-spacing: .3em; color: var(--ink-2); }
.mark { width: 7px; height: 18px; background: var(--accent); clip-path: polygon(0 0, 100% 22%, 100% 100%, 0 78%); }
body[data-activity="live"] .mark { animation: mark 2.2s ease-in-out infinite; }
body[data-activity="idle"] .mark, body[data-activity="standby"] .mark { animation: mark 8s ease-in-out infinite; }
.nav-hint { font: 10px var(--mono); letter-spacing: .2em; color: var(--muted); margin: 0; }
.nav-list { display: flex; flex-direction: column; gap: 6px; }
.sess-pick { text-align: left; padding: 9px 10px; border-left: 2px solid transparent; transition: border-color .3s, background .3s, transform .3s; }
.sess-pick:hover { background: color-mix(in srgb, var(--accent) 7%, transparent); transform: translateX(2px); }
.sess-pick[aria-current="true"] { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 9%, transparent); }
.sess-pick .id { font: 10px var(--mono); color: var(--muted); letter-spacing: .16em; }
.sess-pick .name { display: block; margin: 2px 0 4px; font-size: 13px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sess-pick .meta { font: 10px var(--mono); color: var(--muted); }
.sess-pick[aria-current="true"] .name { color: var(--ink); }
.nav-foot { margin-top: auto; font: 10px var(--mono); color: var(--muted); display: flex; flex-direction: column; gap: 4px; }
.clock { font-size: 13px; letter-spacing: .1em; color: var(--ink-2); }

/* middle: the focused delivery, one segment open */
.stage { padding: 34px 40px 28px; min-width: 0; }
.sess-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.code { font: 10px var(--mono); letter-spacing: .28em; color: var(--accent); }
body[data-activity="live"] .code::after { content: " ·"; animation: blink 1.1s steps(1, end) infinite; }
.title { margin: 0; font-size: 15px; font-weight: 500; color: var(--ink-2); }
.chip { font: 10px var(--mono); color: var(--muted); border: 1px solid var(--line-2); padding: 1px 7px; }

.focus { margin-top: 26px; animation: rise .6s cubic-bezier(.2,.8,.2,1) both; }
.focus-line { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.number { font-family: var(--mono); font-size: 68px; line-height: .85; font-weight: 600; letter-spacing: -.03em; }
.of { font: 12px var(--mono); color: var(--muted); letter-spacing: .16em; }
.focus-name { margin: 0; font-size: clamp(22px, 2.6vw, 30px); font-weight: 600; }
body[data-activity="live"] .number { animation: numberPulse 4s ease-in-out infinite; }
.rule { position: relative; height: 2px; background: var(--line); margin: 20px 0 0; }
.rule::after {
  content: ""; position: absolute; inset: 0 auto 0 0; width: var(--done, 0%);
  background: var(--accent); animation: draw 1.1s .15s cubic-bezier(.2,.8,.2,1) both;
}
.rule::before {
  content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: .18; animation: sweep 9s linear infinite;
}
body[data-activity="live"] .rule::before { animation-duration: 3.2s; opacity: .34; }
.scope { margin: 14px 0 0; font-size: 13px; color: var(--ink-2); display: flex; gap: 9px; align-items: baseline; flex-wrap: wrap; }
.kind { font: 9px var(--mono); letter-spacing: .2em; color: var(--muted); border: 1px solid var(--line-2); padding: 1px 6px; }
.signed { font: 10px var(--mono); color: var(--ok); }
.quiet { color: var(--muted); }

.spine { list-style: none; margin: 26px 0 0; padding: 0; position: relative; }
.spine::before { content: ""; position: absolute; left: 4px; top: 8px; bottom: 8px; width: 1px; background: var(--line-2); }
body[data-activity="live"] .spine::before {
  background: linear-gradient(180deg, transparent, var(--accent) 16%, transparent 36%);
  background-size: 100% 260%; background-repeat: no-repeat; animation: flow 3.4s linear infinite; opacity: .6;
}
.seg { position: relative; padding-left: 26px; animation: rise .45s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i) * 50ms + .08s); }
.seg + .seg { margin-top: 1px; }
.seg-head { display: flex; align-items: baseline; gap: 11px; width: 100%; text-align: left; padding: 10px 0; }
.dot { position: absolute; left: 0; top: 17px; width: 9px; height: 9px; transform: rotate(45deg); border: 1px solid var(--line-2); background: var(--bg); transition: transform .3s, box-shadow .3s, background .3s; }
.seg.done .dot { background: var(--ok); border-color: var(--ok); }
.seg.live .dot { background: var(--accent); border-color: var(--accent); animation: pulse 1.9s ease-in-out infinite; }
body[data-activity="idle"] .seg.live .dot { animation-duration: 6s; }
body[data-activity="standby"] .seg.live .dot { animation-duration: 9s; }
.seg-head:hover .dot { transform: rotate(45deg) scale(1.5); }
.seg-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-2); transition: color .25s; }
.seg.open .seg-name, .seg-head:hover .seg-name { color: var(--ink); }
.seg.done .seg-name { color: var(--muted); }
.seg-meta { font: 11px var(--mono); color: var(--accent); letter-spacing: .06em; }
.seg.done .seg-meta { color: var(--ok); }
.seg-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .45s cubic-bezier(.2,.8,.2,1); }
.seg.open .seg-body { grid-template-rows: 1fr; }
.seg-inner { overflow: hidden; }

.items { list-style: none; margin: 2px 0 14px; padding: 0; }
.item { border-top: 1px solid var(--line); }
.item:last-child { border-bottom: 1px solid var(--line); }
.row { display: flex; align-items: baseline; gap: 9px; width: 100%; text-align: left; padding: 8px 4px; color: var(--ink-2); font-size: 13px; transition: background .2s; }
.row:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); }
.row-text { flex: 1; min-width: 0; }
.mark { width: 12px; flex: none; font: 11px var(--mono); color: var(--ok); }
.row-tag { font: 10px var(--mono); color: var(--muted); flex: none; }
.item.done .row-text { color: var(--ink); }
.item.gate.bad .row-text { color: var(--bad); }
.item.gate.ok .row-text { color: var(--ink); }
.shape { width: 14px; flex: none; font: 12px var(--mono); color: var(--muted); }
.gate.ok .shape { color: var(--ok); }
.gate.bad .shape { color: var(--bad); }
.res { font-style: normal; color: var(--muted); font-size: 11px; margin-left: 6px; }
.fold { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .3s cubic-bezier(.2,.8,.2,1); }
.item.open .fold { grid-template-rows: 1fr; }
.fold-in { overflow: hidden; }
.ev { margin: 0 4px 8px 25px; padding: 8px 11px; border-left: 2px solid var(--line-2); color: var(--ink-2); font: 11px/1.7 var(--mono); }
.ev p { margin: 0; overflow-wrap: anywhere; }
.quiet { font-size: 12px; color: var(--muted); }

.thread { margin-top: 30px; border-top: 1px solid var(--line); padding-top: 14px; }
.thread-title { margin: 0 0 8px; font: 11px var(--mono); letter-spacing: .22em; color: var(--muted); }
.thread-title span { letter-spacing: .06em; color: var(--ink-2); margin-left: 8px; }
.waits { list-style: none; margin: 0 0 10px; padding: 0; font-size: 12px; color: var(--ink-2); }
.waits li { display: flex; gap: 8px; padding: 3px 0; }
.rounds { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.rounds li { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 10px; font-size: 12px; }
.rounds time { font: 11px var(--mono); color: var(--muted); }
.rounds p { margin: 0; color: var(--ink-2); }
.thread-foot { margin: 12px 0 0; font: 10px var(--mono); color: var(--muted); letter-spacing: .08em; }

/* right: the numbers, the next move, the switches */
.meta { border-left: 1px solid var(--line); padding: 22px 18px; display: flex; flex-direction: column; gap: 20px; }
.counts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 6px; }
.counts div { display: flex; flex-direction: column; gap: 2px; }
.counts b { font: 20px var(--mono); font-weight: 500; color: var(--ink); }
.counts span { font: 10px var(--mono); color: var(--muted); letter-spacing: .08em; }
.counts .warn b { color: var(--bad); }
.next { border-left: 2px solid var(--accent); padding-left: 12px; }
.next-label { margin: 0; font: 10px var(--mono); letter-spacing: .2em; color: var(--muted); }
.next-text { margin: 5px 0 0; font-size: 15px; color: var(--ink); }
.next-note { margin: 4px 0 0; font-size: 12px; color: var(--ink-2); }
.next-cmd { margin-top: 8px; font-size: 11px; color: var(--muted); }
.next-cmd summary { cursor: pointer; font-family: var(--mono); letter-spacing: .06em; }
.next-cmd code { display: block; margin-top: 6px; padding: 7px 9px; background: var(--panel); border: 1px solid var(--line); font: 10.5px/1.6 var(--mono); color: var(--ink-2); overflow-wrap: anywhere; }
.trail-label { margin: 0 0 6px; font: 10px var(--mono); letter-spacing: .2em; color: var(--muted); }
.trail ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 11px; }
.trail li { display: grid; grid-template-columns: 74px minmax(0, 1fr) auto; gap: 6px; color: var(--ink-2); }
.trail time { font-family: var(--mono); color: var(--muted); }
.trail em { font-style: normal; font-family: var(--mono); color: var(--muted); }
.trail-all { margin-top: 8px; font: 11px var(--mono); color: var(--muted); }
.trail-all summary { cursor: pointer; letter-spacing: .08em; }
.trail-all ol { margin-top: 6px; max-height: 220px; overflow: auto; }
.theme { text-align: left; font: 10px var(--mono); letter-spacing: .16em; color: var(--muted); padding: 2px 0; }
.theme:hover { color: var(--accent); }
.foot { margin-top: auto; display: flex; flex-direction: column; gap: 4px; font: 10px var(--mono); color: var(--muted); letter-spacing: .06em; }
.activity { display: inline-flex; align-items: center; gap: 7px; }
.activity i { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }
body[data-activity="live"] .activity i { animation: beat 1.5s ease-in-out infinite; }
body[data-activity="idle"] .activity i, body[data-activity="standby"] .activity i { animation: breathe 7s ease-in-out infinite; opacity: .6; }
body[data-activity="standby"] .stage { opacity: .82; }
body[data-activity="standby"] .code::after { content: ""; }

@keyframes rise { from { transform: translateY(9px); } to { transform: none; } }
@keyframes draw { from { width: 0; } }
@keyframes pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 18%, transparent); } }
@keyframes flow { from { background-position: 0 -140%; } to { background-position: 0 140%; } }
@keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
@keyframes mark { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(.84); } }
@keyframes beat { 0%, 100% { transform: scale(.8); opacity: .45; } 45% { transform: scale(1.2); opacity: 1; } }
@keyframes breathe { 0%, 100% { transform: scale(.9); opacity: .5; } 50% { transform: scale(1.1); opacity: .85; } }
@keyframes blink { 50% { opacity: 0; } }
@keyframes numberPulse { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }

@media (max-width: 1080px) {
  .app { grid-template-columns: 200px minmax(0, 1fr); }
  .meta { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--line); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .foot { flex-direction: row; justify-content: space-between; grid-column: 1 / -1; }
}
@media (max-width: 760px) {
  .app { grid-template-columns: minmax(0, 1fr); }
  .nav { border-right: 0; border-bottom: 1px solid var(--line); padding: 16px; }
  .nav-list { flex-direction: row; overflow-x: auto; gap: 8px; }
  .sess-pick { border-left: 0; border-bottom: 2px solid transparent; white-space: nowrap; }
  .sess-pick[aria-current="true"] { border-bottom-color: var(--accent); border-left-color: transparent; }
  .stage { padding: 22px 18px; }
  .number { font-size: 50px; }
  .meta { display: flex; flex-direction: column; padding: 18px; }
  .counts { grid-template-columns: repeat(2, 1fr); }
  .next-cmd code { font-size: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
</style>
</head>
<body data-activity="${activity}">
<div class="app">
  <aside class="nav">
    <div class="brand"><span class="mark" aria-hidden="true"></span>治理台</div>
    <p class="nav-hint">会话</p>
    <div class="nav-list">
      ${sessions
        .map((session) => {
          const progress = sessionProgress(session);
          return `<button class="sess-pick" type="button" data-pick="${escape(session.id)}" aria-current="${focused?.id === session.id ? "true" : "false"}">
            <span class="id">${escape(session.id)}</span>
            <span class="name">${escape(session.title)}</span>
            <span class="meta">${escape(session.status === "archived" ? "已归档" : session.state)} · ${progress.segmentsDone}/${progress.segments || 0} 段</span>
          </button>`;
        })
        .join("")}
      ${sessions.length ? "" : `<p class="quiet">还没有会话。</p>`}
    </div>
    <div class="nav-foot">
      <button class="theme" type="button" id="theme" aria-label="切换明暗主题">明 / 暗</button>
      <span class="clock" id="clock">${nowStamp.slice(11)}</span>
      <span>${escape(nowStamp.slice(0, 10))}</span>
    </div>
  </aside>

  <main class="stage">
    ${sessions.map((session) => sessionSection(session, focused?.id === session.id, now)).join("")}
    ${sessions.length ? "" : `<section class="sess"><header class="sess-head"><span class="code">STANDBY</span><h1 class="title">还没有在推进的交付物</h1></header><div class="focus"><p class="scope quiet">任何工作都从一个会话开始。</p></div></section>`}
  </main>

  ${aside(doc, sessions, now)}
</div>
<script>
(() => {
  const root = document.documentElement;
  const saved = localStorage.getItem("governance-theme");
  if (saved) root.dataset.theme = saved;

  const picks = [...document.querySelectorAll("[data-pick]")];
  const sections = [...document.querySelectorAll(".sess")];
  const show = (id) => {
    for (const section of sections) section.hidden = section.dataset.session !== id;
    for (const pick of picks) pick.setAttribute("aria-current", String(pick.dataset.pick === id));
    history.replaceState(null, "", location.pathname + "#" + id);
  };
  for (const pick of picks) pick.addEventListener("click", () => show(pick.dataset.pick));
  const fromHash = () => {
    const id = location.hash.slice(1);
    if (id && picks.some((pick) => pick.dataset.pick === id)) show(id);
  };
  fromHash();
  window.addEventListener("hashchange", fromHash);

  for (const head of document.querySelectorAll(".seg-head")) {
    head.addEventListener("click", () => {
      const seg = head.closest(".seg");
      const open = seg.classList.toggle("open");
      head.setAttribute("aria-expanded", String(open));
    });
  }

  for (const row of document.querySelectorAll("[data-toggle]")) {
    row.addEventListener("click", () => {
      const item = row.closest(".item");
      const open = item.classList.toggle("open");
      row.setAttribute("aria-expanded", String(open));
    });
  }

  const clock = document.getElementById("clock");
  const tick = () => {
    if (!clock) return;
    const now = new Date();
    clock.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  };
  tick();
  setInterval(tick, 1000);

  const theme = document.getElementById("theme");
  const flip = () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem("governance-theme", next);
  };
  theme?.addEventListener("click", flip);
  document.addEventListener("keydown", (event) => {
    if (event.key === "t" || event.key === "T") flip();
  });
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

export function writeView(root = process.env.NOEMA_STATE_ROOT || process.cwd(), now = new Date()) {
  const doc = loadState(root);
  const output = path.join(root, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, renderView(doc, now));
  const session = focusSession(doc);
  return {
    output,
    state: session?.state ?? null,
    progress: session ? sessionProgress(session) : null,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const result = writeView();
  const progress = result.progress;
  const counts = progress
    ? `段 ${progress.segmentsDone}/${progress.segments} · 任务 ${progress.tasksDone}/${progress.tasks} · 判据 ${progress.acceptanceDone}/${progress.acceptance}`
    : "没有在推进的会话";
  console.log(
    `工作台：${path.relative(process.cwd(), result.output)} · 状态 ${result.state ?? "无会话"} · ${counts}`,
  );
}
