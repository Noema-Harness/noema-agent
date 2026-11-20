// Read-only console for governance/data/state.json.
//
// The page answers one question before anything else: 这一轮能不能放行，卡在谁身上。
// The verdict comes from governance/core/state.mjs `nextAction` — the page never
// invents its own order of gates. Numbers, segments and gates are evidence for it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCEPTANCE_LAYERS,
  BLOCKING_LAYERS,
  currentSegment,
  focusSession,
  listSessions,
  nextAction,
  openFindings,
  sessionProgress,
  activeThread,
} from "../governance/core/state.mjs";
import { loadState } from "./state.mjs";

const LAYER_NAME = { D: "确定性", C: "可复核", R: "发现", H: "人签收" };
const LAYER_GLYPH = { D: "▢", C: "○", R: "◇", H: "△" };
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

function clip(text, max = 72) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function segmentName(segment, index) {
  return segment.name ?? `日常 · ${String(index + 1).padStart(2, "0")}`;
}

function visibleSegments(session) {
  if (!session) return [];
  return session.segments.filter(
    (segment) => segment.labeled || segment.tasks.length > 0 || segment.acceptance.length > 0,
  );
}

function gapsIn(session) {
  const rows = [];
  for (const segment of session.segments) {
    for (const task of segment.tasks) {
      if (task.status !== "已完成")
        rows.push({ kind: "task", id: task.id, text: task.text, segment });
    }
    for (const item of segment.acceptance) {
      const layer = item.layer ?? "D";
      if (layer === "R") {
        if (!item.resolution) rows.push({ kind: "finding", id: item.id, text: item.text, segment });
        continue;
      }
      if (layer === "H") {
        if (item.status !== "通过")
          rows.push({ kind: "human", id: item.id, text: item.text, segment });
        continue;
      }
      if (item.status !== "通过")
        rows.push({ kind: "gate", id: item.id, text: item.text, segment });
    }
  }
  if (!session.scope?.signed)
    rows.push({
      kind: "sign",
      id: session.id,
      text: session.scope?.text ?? "范围没写",
      segment: null,
    });
  return rows;
}

function gapLine(row) {
  if (row.kind === "task") return `任务 ${row.id}`;
  if (row.kind === "finding") return `发现 ${row.id} 未处置`;
  if (row.kind === "human") return `人签收 ${row.id} 等你`;
  if (row.kind === "gate") return `判据 ${row.id} 没核`;
  return "范围还没签";
}

function pickLeadWord(label) {
  return label;
}

function ownerOf(command) {
  if (!command) return null;
  if (/-- sign|accept human/u.test(command)) return "你";
  return "我";
}

// 判定单一来源：state.mjs 的 nextAction。页面只负责排版、翻译谁来做、列出其余缺口。
function verdictOf(doc, session, focused, sessions) {
  if (!session) {
    const archived = (sessions ?? []).filter((one) => one.status === "archived");
    const owed = archived.flatMap((one) => gapsIn(one).map((row) => `${one.id} ${gapLine(row)}`));
    return {
      lead: "没有在推进的会话",
      note: archived.length
        ? `归档里还留着 ${archived.length} 个会话${owed.length ? `，其中 ${owed.length} 处欠着` : "，没有欠项"}。`
        : "琐碎的事不需要会话；要交付什么，才开一个。",
      owner: "你",
      command: 'npm run state -- start "要交付什么"',
      citations: owed.slice(0, 4),
      archived: archived.length > 0,
    };
  }
  if (!focused) {
    const archived = (sessions ?? []).filter((one) => one.status === "archived");
    const owed = archived.flatMap((one) => gapsIn(one).map((row) => ({ session: one, row })));
    const first = owed[0];
    return {
      lead: `${session.id} 已归档`,
      note: owed.length
        ? `归档不撤回；${owed.length} 处还欠着，最近的是 ${first.session.id} 的${gapLine(first.row)}。`
        : "归档时没有欠项，数据只增不减，随时切回。",
      owner: owed.length ? "你" : null,
      command: owed.length ? `npm run state -- switch ${first.session.id}` : null,
      citations: [],
      archived: true,
    };
  }
  const next = nextAction(doc);
  const segment = currentSegment(doc);
  const rest = gapsIn(session).map(gapLine);
  return {
    lead: pickLeadWord(next.label),
    note: clip(next.detail ?? "", 96),
    owner: ownerOf(next.command),
    command: next.command,
    citations: rest.slice(1, 4),
    segment,
  };
}

function layerCell(item) {
  const resolution = item.resolution;
  const tone = resolution
    ? "ok"
    : item.status === "通过"
      ? "ok"
      : item.status === "不通过"
        ? "bad"
        : item.layer === "H"
          ? "wait"
          : "idle";
  const word = resolution
    ? `已处置 · ${resolution.decision}`
    : item.layer === "R"
      ? "未处置"
      : item.status === "通过"
        ? "通过"
        : item.status === "不通过"
          ? "不通过"
          : item.layer === "H"
            ? "等你签收"
            : "未验";
  const note = resolution
    ? `${resolution.decision}${resolution.note ? `：${resolution.note}` : ""}`
    : (item.evidence ?? []).join("｜");
  return `<li class="gate ${tone}" data-layer="${item.layer}">
      <p class="gate-line"><b>${LAYER_GLYPH[item.layer]}</b><i>${LAYER_NAME[item.layer]}</i><em>${word}</em><span>${escapeHtml(clip(item.text, 96))}</span></p>
      ${note ? `<p class="gate-ev">${escapeHtml(clip(note, 140))}</p>` : ""}
    </li>`;
}

function gateBar(segment) {
  if (!segment) return "";
  const rows = ACCEPTANCE_LAYERS.flatMap((layer) =>
    segment.acceptance.filter((item) => (item.layer ?? "D") === layer).map(layerCell),
  ).join("");
  if (!rows) {
    return `<p class="plain">这段是日常段：任务做完就算完，不走四层判据。</p>`;
  }
  const missing = BLOCKING_LAYERS.filter(
    (layer) => !segment.acceptance.some((item) => (item.layer ?? "D") === layer),
  );
  const gap = missing.length
    ? `<p class="plain gate-gap">这一段缺 ${missing.map((layer) => `${layer} 层`).join("、")}判据。</p>`
    : "";
  return `<ul class="gates">${rows}</ul>${gap}`;
}

function tasksOf(segment) {
  const open = segment.tasks.filter((task) => task.status !== "已完成");
  const done = segment.tasks.filter((task) => task.status === "已完成");
  const item = (task, tone) => `<li class="task ${tone}">
      <span class="tick">${task.status === "已完成" ? "✓" : "·"}</span>
      <span class="t-text">${escapeHtml(clip(task.text, 84))}</span>
      ${(task.evidence ?? []).length ? `<span class="t-ev">${escapeHtml(clip(task.evidence.join("｜"), 90))}</span>` : ""}
    </li>`;
  return `${open.map((task) => item(task, "open")).join("")}${
    done.length
      ? `<details class="done"><summary>已完成 ${done.length} 项</summary><ul>${done.map((task) => item(task, "done")).join("")}</ul></details>`
      : ""
  }`;
}

function segmentBlock(segment, index, selected, session, focused) {
  const progress = sessionProgress({ segments: [segment] });
  const done = progress.acceptanceDone;
  const blocking = progress.acceptanceBlocking;
  const open = segment.id === selected;
  const current =
    focused && session.segments.find((one) => one.status === "进行中")?.id === segment.id;
  return `<li class="seg ${TONE[segment.status] ?? "idle"}${open ? " on" : ""}" data-seg="${segment.id}"${current ? ' data-current="true"' : ""}>
      <button class="seg-head" type="button" aria-expanded="${open}" aria-controls="seg-${segment.id}-body">
        <span class="seg-id">${String(index + 1).padStart(2, "0")}</span>
        <span class="seg-name">${escapeHtml(segmentName(segment, index))}</span>
        <span class="seg-count">${segment.labeled ? `${done}/${blocking}` : `${segment.tasks.filter((task) => task.status === "已完成").length}/${segment.tasks.length}`}<small>${segment.labeled ? "判据" : "任务"}</small></span>
        <span class="seg-status">${segment.status}</span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
      <div class="seg-body" id="seg-${segment.id}-body"${open ? "" : " hidden"}>
        ${gateBar(segment)}
        <ul class="tasks">${tasksOf(segment)}</ul>
      </div>
    </li>`;
}

function sessionTabs(sessions, focusedSession, archived) {
  const open = (sessions ?? []).filter((one) => one.status === "open");
  if (open.length <= 1) return "";
  return `<nav class="tabs" aria-label="会话">${open
    .map(
      (one) =>
        `<a class="tab${one.id === focusedSession?.id ? " on" : ""}" href="#" data-session="${one.id}">${one.id} ${escapeHtml(clip(one.title, 18))}</a>`,
    )
    .join("")}${archived ? `<span class="tab quiet">已归档 ${archived}</span>` : ""}</nav>`;
}

function factsLine(progress, openCount) {
  return `<p class="facts"><b>${progress.segmentsDone}/${progress.segments}</b> 段 · <b>${progress.tasksDone}/${progress.tasks}</b> 任务 · <b>${progress.acceptanceDone}/${progress.acceptanceBlocking}</b> 判据 · <b>${openCount}/${progress.findings}</b> 发现</p>`;
}

function waitsBlock(session) {
  const thread =
    activeThread({ focus: session.id, sessions: [session] }) ?? session.threads?.at(-1);
  const waits = thread?.waits ?? [];
  if (waits.length === 0) return "";
  return `<section class="waits"><h2>悬着的问题 <b>${waits.length}</b></h2><ul>${waits
    .map((wait) => `<li>${escapeHtml(clip(wait, 60))}</li>`)
    .join("")}</ul></section>`;
}

function sessionList(doc, sessions, focusedSession) {
  const rows = (sessions ?? [])
    .map(
      (one) =>
        `<li class="sess${one.id === focusedSession?.id ? " on" : ""}"><span class="sess-id">${one.id}</span><span class="sess-title">${escapeHtml(clip(one.title, 26))}</span><span class="sess-state">${one.status === "archived" ? "已归档" : one.state}</span></li>`,
    )
    .join("");
  const trail = (doc.log ?? [])
    .slice(-3)
    .reverse()
    .map(
      (entry) =>
        `<li>${fmtDate(entry.date)} ${escapeHtml(clip(entry.from ?? "", 4))} → ${escapeHtml(clip(entry.to ?? "", 4))}${entry.sessionId ? ` · ${entry.sessionId}` : ""}</li>`,
    )
    .join("");
  return `<section class="sessions"><h2>会话</h2><ul>${rows}</ul></section>${
    trail ? `<section class="trail"><h2>最近切换</h2><ul>${trail}</ul></section>` : ""
  }`;
}

function css() {
  return `
:root{--bg:#f2ece0;--paper:#faf6ec;--ink:#17150f;--dim:#6b6557;--line:#d8cdb8;--accent:#a8371c;--ok:#3f7d4e;--wait:#9a6a12;--bad:#a8371c;--mono:"JetBrains Mono","Cascadia Mono",ui-monospace,monospace;--serif:"Songti SC","Noto Serif CJK SC",Georgia,serif}
@media (prefers-color-scheme: dark){:root{--bg:#15171a;--paper:#1c1f23;--ink:#f0ead9;--dim:#a8a08c;--line:#33373d;--accent:#d9a441;--ok:#7cc28c;--wait:#e0b44f;--bad:#e07a5f}}
:root[data-theme="dark"]{--bg:#15171a;--paper:#1c1f23;--ink:#f0ead9;--dim:#a8a08c;--line:#33373d;--accent:#d9a441;--ok:#7cc28c;--wait:#e0b44f;--bad:#e07a5f}
:root[data-theme="light"]{--bg:#f2ece0;--paper:#faf6ec;--ink:#17150f;--dim:#6b6557;--line:#d8cdb8;--accent:#a8371c;--ok:#3f7d4e;--wait:#9a6a12;--bad:#a8371c}
*{box-sizing:border-box}
body{margin:0;display:flex;flex-direction:column;min-height:100vh;background:var(--bg);color:var(--ink);font:15px/1.65 var(--serif)}
.bar{display:flex;align-items:center;gap:14px;padding:18px 34px;border-bottom:1px solid var(--line)}
.mark{font:600 13px/1 var(--mono);letter-spacing:.18em;text-transform:uppercase}
.bar .where{color:var(--dim);font:12.5px/1 var(--mono)}
.bar .spacer{flex:1}
.tabs{display:flex;gap:8px}
.tab{color:var(--dim);text-decoration:none;font:12.5px/1 var(--mono);padding:6px 10px;border:1px solid var(--line);border-radius:2px}
.tab.on{color:var(--ink);border-color:var(--accent)}
.ghost{border:1px solid var(--line);background:none;color:var(--ink);width:30px;height:30px;border-radius:50%;cursor:pointer;font:13px/1 var(--mono)}
.stage{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 320px;grid-template-areas:"decision rail" "timeline rail";align-content:start}
.stage.bare{grid-template-areas:"decision rail"}
.decision{grid-area:decision;padding:52px 34px 30px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.kicker{color:var(--dim);font:12.5px/1 var(--mono);letter-spacing:.06em}
.lead{margin:14px 0 0;font:600 clamp(34px,3.6vw,54px)/1.12 var(--serif);text-wrap:balance}
.note{margin:10px 0 0;color:var(--dim);max-width:62ch}
.act{margin-top:22px;border-left:3px solid var(--accent);padding:6px 0 6px 14px;max-width:78ch}
.who{font:12px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--accent)}
.cmd{display:flex;align-items:center;gap:10px;margin-top:8px}
.cmd code{font:13.5px/1.5 var(--mono);background:var(--paper);border:1px solid var(--line);padding:6px 10px;overflow-wrap:anywhere;flex:1}
.copy{border:1px solid var(--line);background:none;color:var(--dim);font:12px/1 var(--mono);padding:7px 9px;cursor:pointer;border-radius:2px}
.copy:focus-visible,.seg-head:focus-visible,.ghost:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cites{margin:14px 0 0;color:var(--dim);font:12.5px/1.6 var(--mono)}
.cites li{list-style:none}
.scope-line{margin:26px 0 0;font:12.5px/1.6 var(--mono);color:var(--ink)}
.scope-line b{font-weight:600}
.facts{margin:16px 0 0;font:12.5px/1.6 var(--mono);color:var(--dim)}
.facts b{color:var(--ink);font-weight:600}
.timeline{grid-area:timeline;padding:26px 34px 40px;border-right:1px solid var(--line)}
.timeline h2,.rail h2{margin:0 0 10px;font:12px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.segments{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.seg{border-bottom:1px solid var(--line)}
.seg-head{display:grid;grid-template-columns:34px minmax(0,1fr) auto auto 12px;gap:12px;align-items:center;width:100%;background:none;border:0;color:inherit;text-align:left;padding:14px 2px;cursor:pointer;font:inherit}
.seg-id{font:12.5px/1 var(--mono);color:var(--dim)}
.seg-name{font:600 16px/1.3 var(--serif)}
.seg.live .seg-name{color:var(--ink)}
.seg.done .seg-name,.seg.idle .seg-name{color:var(--dim)}
.seg-count{font:12px/1 var(--mono);color:var(--dim)}
.seg-count small{font-size:10.5px;margin-left:2px}
.seg-status{font:11.5px/1 var(--mono);color:var(--dim)}
.seg.live .seg-status{color:var(--accent)}
.chev{color:var(--dim);transition:transform .2s}
.seg.on .chev{transform:rotate(90deg)}
.seg-head:hover .seg-name{color:var(--accent)}
.seg-body{padding:0 0 16px 46px}
.seg-body[hidden]{display:none}
.gates{list-style:none;margin:0;padding:0}
.gate{padding:9px 0;border-top:1px dashed var(--line)}
.gate-line{display:flex;gap:9px;align-items:baseline;margin:0;flex-wrap:wrap}
.gate-line b{font:13px/1 var(--mono);color:var(--dim)}
.gate-line i{font:12px/1 var(--mono);font-style:normal;color:var(--dim)}
.gate-line em{font:12.5px/1 var(--mono);font-style:normal;padding:2px 6px;border-radius:2px}
.gate-line span{flex:1 1 260px;max-width:72ch}
.gate.ok em{color:var(--ok);border:1px solid currentColor}
.gate.bad em,.gate.wait em{color:var(--bad);border:1px solid currentColor;font-weight:600}
.gate.wait em{color:var(--wait)}
.gate.idle em{color:var(--dim);border:1px solid var(--line)}
.gate-ev{margin:4px 0 0 0;color:var(--dim);font:12px/1.5 var(--mono);max-width:72ch}
.gate-gap{margin:8px 0 0;color:var(--bad);font:12px/1.5 var(--mono)}
.plain{margin:8px 0 0;color:var(--dim);font:12.5px/1.6 var(--mono)}
.tasks{list-style:none;margin:10px 0 0;padding:0}
.task{display:flex;gap:10px;padding:5px 0;align-items:baseline}
.task .tick{width:12px;color:var(--dim);font:12px/1 var(--mono)}
.task.open .tick{color:var(--accent)}
.t-ev{color:var(--dim);font:11.5px/1.4 var(--mono);flex:1 1 100%;margin-left:22px}
.done{margin-top:8px}
.done summary{cursor:pointer;color:var(--dim);font:12px/1 var(--mono);padding:6px 0}
.rail{grid-area:rail;padding:52px 26px 40px;display:flex;flex-direction:column;gap:24px;border-left:1px solid var(--line)}
.rail ul{list-style:none;margin:0;padding:0;font:12.5px/1.7 var(--mono);color:var(--dim)}
.sess{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:8px}
.sess.on .sess-title{color:var(--ink)}
.sess-id{color:var(--dim)}
.sess-state{color:var(--dim);font-size:11.5px}
.waits ul li{border-left:2px solid var(--wait);padding-left:8px;margin-bottom:4px}
.waits h2 b{color:var(--ink)}
.ticker{margin-top:auto;display:flex;align-items:center;gap:16px;padding:14px 34px;border-top:1px solid var(--line);font:12px/1.4 var(--mono);color:var(--dim);flex-wrap:wrap}
.ticker .gen{margin-left:auto}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:900px){.stage{grid-template-columns:1fr}.decision,.timeline{border-right:0;border-bottom:1px solid var(--line)}.rail{padding-top:24px}.lead{font-size:clamp(28px,7vw,40px)}.bar{padding:14px 18px;flex-wrap:wrap}.ticker{padding:12px 18px}}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
`;
}

function script({ selectedId, stamp }) {
  return `
<script>
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const status = $("#status");
const speak = (text) => { if (status) status.textContent = text; };

function openSegment(id, focusHead = false) {
  const item = $$(".seg").find((one) => one.dataset.seg === id);
  if (!item) return;
  for (const one of $$(".seg")) {
    const on = one === item;
    one.classList.toggle("on", on);
    const head = $(".seg-head", one);
    const body = $(".seg-body", one);
    head.setAttribute("aria-expanded", String(on));
    body.hidden = !on;
  }
  if (focusHead) $(".seg-head", item).focus();
  if (id) history.replaceState(null, "", "#" + id);
}

function step(delta) {
  const items = $$(".seg");
  if (!items.length) { speak("这一段还没有验收单元"); return; }
  const index = Math.max(0, items.findIndex((one) => one.classList.contains("on")));
  const next = Math.min(items.length - 1, Math.max(0, index + delta));
  openSegment(items[next].dataset.seg, true);
  speak(items[next].querySelector(".seg-name").textContent);
}

$$(".seg-head").forEach((head) => {
  head.addEventListener("click", () => {
    const item = head.closest(".seg");
    const open = head.getAttribute("aria-expanded") === "true";
    openSegment(open ? null : item.dataset.seg);
  });
  head.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const item = head.closest(".seg");
      const open = head.getAttribute("aria-expanded") === "true";
      openSegment(open ? null : item.dataset.seg);
    }
  });
});

document.addEventListener("keydown", (event) => {
  const tag = (event.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;
  if (event.key === "j" || event.key === "J") { event.preventDefault(); step(1); }
  if (event.key === "k" || event.key === "K") { event.preventDefault(); step(-1); }
  if (event.key === "t" || event.key === "T") {
    const now = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", now);
    localStorage.setItem("governance-theme", now);
    speak(now === "dark" ? "深色" : "浅色");
  }
});

const theme = localStorage.getItem("governance-theme");
if (theme) document.documentElement.setAttribute("data-theme", theme);

$$(".copy").forEach((button) => {
  button.addEventListener("click", async () => {
    const text = $(".cmd code")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    button.textContent = "已复制";
    speak("命令已复制");
  });
});

function tickAges() {
  const now = Date.now();
  $$("[data-since]").forEach((el) => {
    const then = Date.parse(el.dataset.since);
    if (Number.isNaN(then)) return;
    const minutes = Math.max(0, Math.round((now - then) / 60000));
    const text = minutes < 60 ? minutes + " 分钟" : Math.round(minutes / 60) + " 小时";
    el.textContent = text + "前";
  });
  const stamp = $("#age-stamp");
  if (stamp) {
    const then = Date.parse("${stamp}");
    if (!Number.isNaN(then)) {
      const minutes = Math.max(0, Math.round((now - then) / 60000));
      stamp.textContent = minutes === 0 ? "刚生成" : minutes + " 分钟前生成";
    }
  }
}
tickAges();
setInterval(tickAges, 30000);

const initial = location.hash.replace("#", "");
if (initial) openSegment(initial);
window.addEventListener("hashchange", () => {
  const id = location.hash.replace("#", "");
  if (id) openSegment(id);
});
</script>`;
}

function page({ doc, session, focused, sessions, selectedId, now }) {
  const progress = session ? sessionProgress(session) : null;
  const visible = visibleSegments(session);
  const verdict = verdictOf(doc, session, focused, sessions);
  const openCount = session ? (sessionProgress(session).openFindings ?? 0) : 0;
  const archivedCount = (sessions ?? []).filter((one) => one.status === "archived").length;
  const stateWord = session ? (focused ? session.state : "已归档") : "空";
  const scopeText = session?.scope?.text ?? null;
  const scopeKind = session?.scope?.kind ?? null;
  const signed = session?.scope?.signed;
  const title = session ? `治理台 · ${session.id} ${session.title}` : "治理台";
  const since = session?.since ?? null;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${css()}</style>
</head>
<body>
<header class="bar">
  <span class="mark">治理台</span>
  <span class="where">${session ? `${session.id} · ${stateWord}` : "没有会话"} · v4</span>
  ${sessionTabs(sessions, session, archivedCount)}
  <span class="spacer"></span>
  <button class="ghost" type="button" aria-label="切换明暗" title="切换明暗（T）">◐</button>
</header>
<main class="stage${visible.length ? "" : " bare"}">
  <section class="decision">
    <p class="kicker">${session ? `${stateWord} · ${session.id}` : "空"}</p>
    <h1 class="lead">${escapeHtml(verdict.lead)}</h1>
    ${verdict.note ? `<p class="note">${escapeHtml(verdict.note)}</p>` : ""}
    ${
      verdict.command
        ? `<div class="act"><p class="who">${verdict.owner ? `${verdict.owner}的下一步` : "下一步"}</p><p class="cmd"><code>${escapeHtml(verdict.command)}</code><button class="copy" type="button">复制</button></p></div>`
        : `<p class="plain">没有必须由你做的事。下面的账只是留档。</p>`
    }
    ${verdict.citations?.length ? `<ul class="cites">${verdict.citations.map((line) => `<li>还有：${escapeHtml(line)}</li>`).join("")}</ul>` : ""}
    <p class="scope-line">这一轮交付：<b>${scopeText ? escapeHtml(clip(scopeText, 90)) : "还没写"}</b>${scopeKind ? ` · ${scopeKind}` : ""}${signed ? " · 已签收" : ""}</p>
    ${progress ? factsLine(progress, openCount) : ""}
    ${since && focused ? `<p class="plain">开始于 <span data-since="${escapeHtml(since)}">刚刚</span></p>` : ""}
  </section>
  ${
    visible.length
      ? `<section class="timeline"><h2>段 / ${visible.length}</h2><ul class="segments">${visible
          .map((segment, index) => segmentBlock(segment, index, selectedId, session, focused))
          .join("")}</ul></section>`
      : ""
  }
  <aside class="rail">
    ${sessionList(doc, sessions, session)}
    ${session ? waitsBlock(session) : ""}
  </aside>
</main>
<footer class="ticker">
  <span>只读视图 · governance/data/state.json · 写入只经 npm run state</span>
  <span class="gen"><span id="age-stamp">刚生成</span> · ${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}</span>
</footer>
<p class="sr" role="status" id="status"></p>
${script({ selectedId, stamp: now.toISOString() })}
</body>
</html>`;
}

function pickSelected(session) {
  const visible = visibleSegments(session);
  const env = process.env.NOEMA_VIEW_SEGMENT;
  if (env && visible.some((segment) => segment.id === env)) return env;
  const live = visible.find((segment) => segment.status === "进行中");
  if (live) return live.id;
  const done = [...visible].reverse().find((segment) => segment.status === "已完成");
  return done?.id ?? visible.at(-1)?.id ?? null;
}

export function renderView(root = process.env.NOEMA_STATE_ROOT || process.cwd()) {
  const doc = loadState(root);
  const focus = focusSession(doc);
  const sessions = listSessions(doc)
    .map((row) => doc.sessions.find((one) => one.id === row.id))
    .filter(Boolean);
  const session = focus ?? sessions.filter((one) => one.status === "archived").at(-1) ?? null;
  return page({
    doc,
    session,
    focused: Boolean(focus && session && focus.id === session.id),
    sessions,
    selectedId: pickSelected(session),
    now: new Date(),
  });
}

export function writeView(root = process.env.NOEMA_STATE_ROOT || process.cwd()) {
  const target = path.join(root, ".work", "review", "work-view.html");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const html = renderView(root);
  fs.writeFileSync(target, html, "utf8");
  return target;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const target = writeView();
  console.log(target);
}
