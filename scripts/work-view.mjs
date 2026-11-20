// Read-only console for one governance session: what is left to do, what a
// reviewer found, and whether it can be signed. It renders state.json and
// nothing else; every action still goes through `npm run state`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  focusSession,
  listSessions,
  nextAction,
  openFindings,
  sessionProgress,
  validateState,
} from "../governance/core/state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEW_PATH = path.join(".work", "review", "work-view.html");

const STATE_TAG = { 讨论: "DISCUSS", 执行: "EXECUTE", 验收: "ACCEPT" };
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

function readState(root = ROOT) {
  const file = path.join(root, "governance", "data", "state.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function activityOf(session) {
  const stamps = [session.since];
  for (const task of session.tasks) stamps.push(task.createdAt, task.doneAt);
  for (const finding of session.findings) stamps.push(finding.createdAt, finding.resolvedAt);
  for (const review of session.reviews) stamps.push(review.at);
  const latest = stamps
    .filter(Boolean)
    .map((one) => Date.parse(one))
    .filter((one) => Number.isFinite(one))
    .sort((a, b) => b - a)[0];
  if (!latest) return "idle";
  const minutes = (Date.now() - latest) / 60000;
  if (minutes <= 10) return "live";
  if (minutes <= 6 * 60) return "idle";
  return "standby";
}

function taskRow(task) {
  const done = task.status === "已完成";
  const evidence = task.evidence.map((one) => `<li>${esc(one)}</li>`).join("");
  return `<li class="task${done ? " done" : ""}" data-task="${esc(task.id)}" data-phase="${esc(task.phase ?? "")}">
  <span class="mark" aria-hidden="true">${done ? "✓" : "○"}</span>
  <div class="body">
    <p class="text">${esc(task.text)}${task.phase ? `<span class="phase">${esc(task.phase)}</span>` : ""}</p>
    <p class="standard">${esc(task.standard)}</p>
    ${evidence ? `<ul class="evidence">${evidence}</ul>` : ""}
  </div>
  <span class="id">${esc(task.id)}</span>
</li>`;
}

function findingRow(finding) {
  const tail = finding.status === "未处置" ? "" : ` · ${esc(finding.status)}`;
  const note = finding.note ? `<p class="note">${esc(finding.note)}${tail}</p>` : "";
  return `<li class="finding ${finding.status === "未处置" ? "open" : "closed"}" data-finding="${esc(finding.id)}">
  <span class="mark" aria-hidden="true">${finding.status === "未处置" ? "◇" : "◆"}</span>
  <div class="body">
    <p class="text">${esc(finding.text)}<span class="phase">${finding.scope === "段" ? `段 · ${esc(finding.phase)}` : "总体"}</span></p>
    ${note}
  </div>
  <span class="id">${esc(finding.id)}</span>
</li>`;
}

function groupTasks(tasks) {
  const phases = [];
  for (const task of tasks) {
    const key = task.phase ?? "";
    if (!phases.some((one) => one.key === key)) phases.push({ key, tasks: [] });
    phases.find((one) => one.key === key).tasks.push(task);
  }
  return phases;
}

function sessionBlock(doc, session, focused) {
  const progress = sessionProgress(session);
  const action = nextAction({ ...doc, focus: session.id });
  const open = openFindings({ ...doc, focus: session.id });
  const thread = session.threads.find((one) => one.id === session.threadId) ?? null;
  const rounds = (thread?.rounds ?? []).slice(-5);
  const groups = groupTasks(session.tasks);
  const dismissed = session.status === "archived";

  const scopeLine = session.scope
    ? `<p class="scope"><span class="kind">${esc(session.scope.kind)}</span>${esc(session.scope.text)}${
        session.sign ? `<span class="signed">已签收 ${esc(session.sign.date)}</span>` : ""
      }</p>`
    : `<p class="scope empty">还没有范围：<code>npm run state -- scope "这一轮要交付什么"</code></p>`;

  const taskGroups = groups
    .map((group) => {
      const head = group.key
        ? `<h3 class="phase-head">${esc(group.key)}<span>${group.tasks.filter((one) => one.status === "已完成").length}/${group.tasks.length}</span></h3>`
        : "";
      return `${head}<ul class="tasks">${group.tasks.map(taskRow).join("")}</ul>`;
    })
    .join("");

  const findingList = session.findings.length
    ? `<ul class="findings">${session.findings.map(findingRow).join("")}</ul>`
    : `<p class="quiet">还没有审查发现。</p>`;

  const roundsBlock = rounds.length
    ? `<section class="rounds"><h3>讨论轮次</h3><ol>${rounds
        .map(
          (round) =>
            `<li><span class="date">${esc(round.date.slice(0, 10))}</span>${esc(round.summary)}${
              round.draft ? `<p class="draft">方案：${esc(round.draft)}</p>` : ""
            }${
              round.waits?.length
                ? `<p class="waits">悬着：${round.waits.map(esc).join("；")}</p>`
                : ""
            }</li>`,
        )
        .join(
          "",
        )}</ol>${thread.waits.length ? `<p class="waits">待裁 ${thread.waits.length}：${thread.waits.map(esc).join("；")}</p>` : ""}</section>`
    : "";

  return `<section class="session${focused ? " current" : ""}" data-session="${esc(session.id)}"${
    focused || !doc.focus ? "" : " hidden"
  }>
  <header class="head">
    <p class="tag">${esc(STATE_TAG[session.state] ?? session.state)}${dismissed ? " · ARCHIVED" : ""}</p>
    <h2>${esc(session.title)}</h2>
    ${scopeLine}
  </header>
  <div class="columns">
    <section class="work">
      <h3>任务 <span>${progress.tasksDone}/${progress.tasks}</span></h3>
      ${taskGroups || `<p class="quiet">还没有列任务：<code>npm run state -- tasks plan tasks.txt</code></p>`}
      <h3>发现 <span>${progress.openFindings}/${progress.findings}</span></h3>
      ${findingList}
      ${roundsBlock}
    </section>
    <aside class="side">
      <dl class="counts">
        <div><dt>阶段</dt><dd>${progress.phasesReviewed}/${progress.phases}</dd></div>
        <div><dt>总体审查</dt><dd>${progress.overallReviewed ? "已做" : "未做"}</dd></div>
        <div><dt>签收</dt><dd>${progress.signed ? "已签" : "未签"}</dd></div>
      </dl>
      <section class="next">
        <h3>下一步 · ${esc(action.who === "user" ? "你" : "agent")}</h3>
        <p class="label">${esc(action.label)}</p>
        <details><summary>agent 会执行什么</summary><code>${esc(action.command)}</code></details>
      </section>
      ${open.length ? `<p class="hint">${open.length} 条发现等你决定：已修 / 延期 / 接受。</p>` : ""}
    </aside>
  </div>
</section>`;
}

function page(doc, now) {
  const rows = listSessions(doc);
  const focused = focusSession(doc);
  const shown = focused ?? [...doc.sessions].reverse().find((one) => one.tasks.length > 0) ?? null;
  const activity = focused ? activityOf(focused) : "standby";
  const chips = rows
    .map(
      (row) =>
        `<button class="chip" data-pick="${esc(row.id)}"${
          doc.focus === row.id ? ' aria-current="true"' : ""
        }>${esc(row.id)}<span>${esc(row.title)}</span><em>${row.tasksDone}/${row.tasks}</em></button>`,
    )
    .join("");
  const body = doc.sessions.length
    ? doc.sessions.map((session) => sessionBlock(doc, session, doc.focus === session.id)).join("")
    : `<section class="blank"><p>还没有会话。</p><code>npm run state -- start "要交付什么"</code></section>`;

  return `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>治理台${shown ? ` · ${esc(shown.title)}` : ""}</title>
<style>
:root{--bg:#f2ece0;--ink:#17150f;--muted:#6b6457;--rule:#cbc0a8;--accent:#a8371c;--good:#2f6b4a;--wait:#8a5a12}
html[data-theme="dark"]{--bg:#15171a;--ink:#f1ece1;--muted:#9a9384;--rule:#34332e;--accent:#d9a441;--good:#63c08d;--wait:#d9a441}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 "Noto Serif SC",Songti SC,Georgia,serif;min-height:100vh;display:flex;flex-direction:column}
code{font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
header.top{display:flex;align-items:center;gap:18px;padding:14px 20px;border-bottom:1px solid var(--rule)}
.mark-brand{font-family:ui-monospace,Consolas,monospace;font-size:12px;letter-spacing:.2em;color:var(--muted)}
.chips{display:flex;gap:6px;overflow:auto;flex:1}
.chip{display:flex;gap:8px;align-items:baseline;background:none;border:1px solid transparent;border-radius:2px;color:inherit;font:inherit;padding:4px 8px;cursor:pointer}
.chip span{max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}
.chip em{font-style:normal;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--muted)}
.chip[aria-current="true"]{border-color:var(--accent)}
.chip:hover{border-color:var(--rule)}
button.theme{background:none;border:1px solid var(--rule);color:inherit;width:28px;height:28px;border-radius:50%;cursor:pointer}
.clock{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--muted)}
main{flex:1;padding:24px 20px 40px;max-width:1240px;width:100%;margin:0 auto}
.session .head .tag{margin:0;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;letter-spacing:.18em;color:var(--accent)}
.session .head h2{margin:6px 0 4px;font-size:clamp(26px,3vw,38px);line-height:1.15}
.scope{margin:4px 0 0;color:var(--muted)}
.scope .kind{display:inline-block;margin-right:8px;padding:0 6px;border:1px solid var(--rule);border-radius:2px;font-size:11.5px;color:var(--ink)}
.scope .signed{margin-left:10px;color:var(--good);font-size:12.5px}
.scope.empty code{color:var(--muted)}
.columns{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:36px;margin-top:22px}
h3{margin:0 0 10px;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;letter-spacing:.16em;color:var(--muted)}
h3 span{color:var(--ink);margin-left:6px}
.tasks,.findings{list-style:none;margin:0 0 26px;padding:0;display:grid;gap:10px}
.phase-head{display:flex;justify-content:space-between;margin:18px 0 8px;font-family:inherit;font-size:13px;letter-spacing:.04em;color:var(--ink)}
.task,.finding{display:grid;grid-template-columns:20px minmax(0,1fr) 44px;gap:10px;padding:10px 12px;border:1px solid var(--rule);border-radius:2px;background:color-mix(in srgb,var(--bg) 88%,var(--rule))}
.task .mark,.finding .mark{font-family:ui-monospace,Consolas,monospace;color:var(--muted)}
.task.done .mark{color:var(--good)}
.finding.open .mark{color:var(--wait)}
.task .text,.finding .text{margin:0;font-size:14.5px}
.task .standard{margin:2px 0 0;font-size:13px;color:var(--muted)}
.task .evidence,.finding .note{margin:6px 0 0;padding-left:0;list-style:none;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--muted)}
.task .evidence li::before{content:"· "}
.phase,.id{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--muted)}
.phase{margin-left:8px;padding:0 5px;border:1px solid var(--rule);border-radius:2px}
.id{text-align:right;align-self:start}
.side{display:grid;gap:22px;align-content:start}
.counts{display:grid;gap:6px;margin:0}
.counts div{display:flex;justify-content:space-between;border-bottom:1px dotted var(--rule);padding-bottom:4px}
.counts dt{margin:0;font-size:12.5px;color:var(--muted)}
.counts dd{margin:0;font-family:ui-monospace,Consolas,monospace;font-size:13px}
.next .label{margin:0 0 6px;font-size:15px}
.next details summary{cursor:pointer;color:var(--muted);font-size:12px}
.next code{display:block;margin-top:6px;padding:8px;border-left:2px solid var(--accent);background:color-mix(in srgb,var(--bg) 85%,var(--rule));overflow-wrap:anywhere}
.hint{margin:0;font-size:12.5px;color:var(--wait)}
.rounds ol{margin:0;padding-left:0;list-style:none;display:grid;gap:6px;font-size:13.5px}
.rounds .date{margin-right:8px;color:var(--muted);font-family:ui-monospace,Consolas,monospace;font-size:11px}
.waits{margin:8px 0 0;font-size:12.5px;color:var(--wait)}
.quiet,.empty{margin:0;color:var(--muted);font-size:13.5px}
footer{display:flex;justify-content:space-between;gap:12px;padding:10px 20px;border-top:1px solid var(--rule);font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--muted)}
@media (max-width:900px){.columns{grid-template-columns:minmax(0,1fr)}header.top{flex-wrap:wrap}}
@media (prefers-reduced-motion:no-preference){.session.current .head .tag::after{content:"·";margin-left:6px;color:var(--accent);animation:pulse 2.2s infinite}}
@keyframes pulse{0%,100%{opacity:.25}50%{opacity:1}}
</style>
</head>
<body data-activity="${activity}">
<header class="top">
  <span class="mark-brand">治理台</span>
  <div class="chips">${chips}</div>
  <button class="theme" id="theme" type="button" aria-label="切换明暗">◐</button>
  <span class="clock" id="clock">${now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
</header>
<main>${body}</main>
<footer><span>${focused ? `${focusSession(doc).state}` : "没有在推进的会话"} · ${activity}</span><span>state.json · v5</span></footer>
<script>
const root = document.documentElement;
const saved = localStorage.getItem("governance-theme");
if (saved) root.dataset.theme = saved;
document.querySelectorAll("[data-pick]").forEach((chip) => {
  chip.addEventListener("click", () => {
    const id = chip.dataset.pick;
    document.querySelectorAll(".session").forEach((block) => {
      block.hidden = block.dataset.session !== id;
    });
    document.querySelectorAll("[data-pick]").forEach((one) => one.removeAttribute("aria-current"));
    chip.setAttribute("aria-current", "true");
  });
});
const theme = document.getElementById("theme");
theme?.addEventListener("click", () => {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("governance-theme", root.dataset.theme);
});
const clock = document.getElementById("clock");
setInterval(() => {
  if (clock) clock.textContent = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}, 1000);
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "t") theme?.click();
});
</script>
</body>
</html>
`;
}

export function renderView(root = process.env.NOEMA_STATE_ROOT || ROOT, now = new Date()) {
  const doc = readState(root);
  const errors = validateState(doc);
  if (errors.length) throw new Error(`状态数据不合规：${errors.join("；")}`);
  return page(doc, now);
}

export function writeView(root = process.env.NOEMA_STATE_ROOT || ROOT, now = new Date()) {
  const html = renderView(root, now);
  const target = path.join(root, VIEW_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html, "utf8");
  return { file: target, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = writeView();
  const doc = readState();
  const session = focusSession(doc);
  const progress = session ? sessionProgress(session) : null;
  console.log(
    session
      ? `治理台：${path.relative(ROOT, result.file)} · 状态 ${session.state} · 任务 ${progress.tasksDone}/${progress.tasks} · 发现 ${progress.openFindings}/${progress.findings}`
      : `治理台：${path.relative(ROOT, result.file)} · 没有在推进的会话`,
  );
}
