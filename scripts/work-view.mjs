// Renders the current agent state, scope and the staged work list into a
// static, read-only HTML page. Adapter layer: reads governance/data/state.json
// and writes .work/review/work-view.html. The state model itself lives in
// governance/core/state.mjs.
import fs from "node:fs";
import path from "node:path";

import {
  activeThread,
  emptyState,
  logOf,
  upgradeState,
  validateState,
  workProgress,
} from "../governance/core/state.mjs";

const STATE_PATH = "governance/data/state.json";
const OUTPUT_PATH = ".work/review/work-view.html";

function escape(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function badge(status) {
  const tone =
    status === "已完成" || status === "通过"
      ? "ok"
      : status === "不通过"
        ? "bad"
        : status === "未验"
          ? "wait"
          : "todo";
  return `<span class="badge ${tone}">${escape(status)}</span>`;
}

function taskRow(task) {
  const box = task.status === "已完成" ? "☑" : "☐";
  const evidence =
    task.evidence.length > 0
      ? `<div class="evidence">${task.evidence.map((one) => `<code>${escape(one)}</code>`).join(" ")}</div>`
      : "";
  return `<li class="${task.status === "已完成" ? "done" : ""}"><span class="box">${box}</span><span class="text">${escape(task.text)}</span><span class="id">${escape(task.id)}</span>${evidence}</li>`;
}

const LAYER_LABEL = { D: "确定性", C: "判据", R: "审查发现", H: "签收" };

function acceptanceRow(item) {
  const evidence =
    item.evidence.length > 0
      ? `<div class="evidence">${item.evidence.map((one) => `<code>${escape(one)}</code>`).join(" ")}</div>`
      : "";
  const layer = item.layer ?? "D";
  return `<li>${badge(item.status)}<span class="layer layer-${layer}">${layer} ${LAYER_LABEL[layer] ?? ""}</span><span class="text">${escape(item.text)}</span><span class="id">${escape(item.id)}</span>${evidence}</li>`;
}

function reviewBlock(review) {
  if (!review) return "";
  const rows = [
    ["验什么", review.what],
    ["可能漏", review.gap],
    ["拆/并", review.split],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<li><b>${label}</b> ${escape(value)}</li>`)
    .join("");
  return rows ? `<div class="review"><h3>进入时重审</h3><ul>${rows}</ul></div>` : "";
}

function phaseCard(phase) {
  const open = phase.status === "进行中" ? "" : " dim";
  return `<section class="phase${open}">
  <header><h2>${escape(phase.id)} ${escape(phase.name)}</h2>${badge(phase.status)}</header>
  ${phase.goal ? `<p class="goal">${escape(phase.goal)}</p>` : ""}
  ${reviewBlock(phase.review)}
  <h3>任务 ${phase.tasks.length}</h3>
  <ul class="tasks">${phase.tasks.map(taskRow).join("") || "<li class='empty'>还没有任务</li>"}</ul>
  <h3>阶段验收 ${phase.acceptance.length}（通过 = D + C + H；R 只列发现）</h3>
  <ul class="accept">${phase.acceptance.map(acceptanceRow).join("") || "<li class='empty'>还没写验收项</li>"}</ul>
</section>`;
}

function threadBlock(thread) {
  if (!thread) return "";
  const rounds = thread.rounds
    .slice(-8)
    .map(
      (round) =>
        `<li><span class="n">第 ${round.n} 轮 · ${escape(round.date)}</span>${escape(round.conclusion)}${round.change ? `<span class="diff">${escape(round.change)}</span>` : ""}</li>`,
    )
    .join("");
  return `<section class="thread">
  <h2>讨论：${escape(thread.title)}<span class="id">${escape(thread.id)}</span></h2>
  <p class="meta">${escape(thread.status)}${thread.ending ? ` · ${escape(thread.ending)}` : ""} · 第 ${thread.rounds.length} 轮</p>
  <h3>待裁</h3>
  <ul class="waits">${thread.waits.map((one) => `<li>${escape(one)}</li>`).join("") || "<li class='empty'>无</li>"}</ul>
  <h3>最近轮次</h3>
  <ul class="rounds">${rounds || "<li class='empty'>还没有轮次</li>"}</ul>
</section>`;
}

export function renderView(doc, now = new Date()) {
  const progress = workProgress(doc);
  const percent =
    progress.tasks.total === 0 ? 0 : Math.round((progress.tasks.done / progress.tasks.total) * 100);
  const thread = doc.current.threadId
    ? doc.threads.find((one) => one.id === doc.current.threadId)
    : activeThread(doc);
  const scope = doc.work?.scope;
  const phases = doc.work?.phases ?? [];
  const recent = logOf(doc, { limit: 5 })
    .map(
      (entry) =>
        `<li><span class="n">${escape(entry.date)}</span>${escape(entry.from ?? "起始")} → <b>${escape(entry.to)}</b>（${escape(entry.obligation)}）：${escape(entry.reason)}</li>`,
    )
    .join("");
  const state = doc.current.state;
  const hint =
    state === "讨论"
      ? "把这次讨论记下来（state -- round）；有结论就定案（设计稿 + 范围/清单）。执行期的账本折叠在下面。"
      : state === "执行"
        ? "推进当前阶段的未完成任务；阶段收尾时处置审查发现（accept resolve），再进验收。"
        : "把 D/C/H 判完、R 发现处置完，再用 state -- sign 记录你的原话。";
  const fold = (label, inner, open) =>
    `<details class="fold"${open ? " open" : ""}><summary>${escape(label)}</summary>${inner}</details>`;
  const progressHtml = `<div class="bar"><i style="width:${percent}%"></i></div>
  <p class="meta">任务 ${progress.tasks.done}/${progress.tasks.total}（${percent}%）· 阶段 ${progress.phases.done}/${progress.phases.total} · 验收通过 ${progress.acceptance.passed}/${progress.acceptance.total}${progress.acceptance.findings > 0 ? ` · 审查发现 ${progress.acceptance.findings}（未处置 ${progress.acceptance.openFindings}）` : ""}${progress.acceptance.failed > 0 ? ` · <b>不通过 ${progress.acceptance.failed}</b>` : ""}</p>`;
  const phasesHtml =
    phases.map(phaseCard).join("") ||
    `<p class="empty">还没有阶段：npm run state -- phase add --name "…"</p>`;
  const threadHtml = thread
    ? threadBlock(thread)
    : `<section class="thread"><h2>讨论</h2><p class="empty">当前没有活动会话；进入讨论会自动恢复最近一次归档会话。</p></section>`;
  const logHtml = `<h3>最近切换</h3><ul>${recent || "<li class='empty'>还没有切换记录</li>"}</ul>`;
  const scopeHtml = scope
    ? `<div class="scope"><b>范围</b> ${escape(scope.text)}<div class="meta">立于 ${escape(scope.since)}${scope.signed ? ` · 已签收（${escape(scope.signed.date)}）：${escape(scope.signed.text)}` : ""}</div></div>`
    : `<div class="scope meta">还没有声明范围</div>`;

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Noema 工作台</title>
<style>
:root { color-scheme: light; }
body { margin: 0; padding: 28px 32px 60px; font: 14px/1.6 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; color: #24211d; background: #faf9f6; }
h1 { font-size: 20px; margin: 0 0 6px; }
h2 { font-size: 15px; margin: 0; display: flex; gap: 10px; align-items: baseline; }
h3 { font-size: 12px; color: #7a7570; margin: 14px 0 6px; letter-spacing: .04em; }
.head { display: flex; gap: 18px; align-items: baseline; margin-bottom: 18px; }
.state { font-size: 22px; font-weight: 600; }
.meta, .goal { color: #6f6a65; margin: 4px 0 0; }
.scope { margin: 6px 0 28px; padding: 10px 14px; background: #fff; border: 1px solid #e6e1d8; border-radius: 8px; }
.bar { height: 6px; background: #eae5dc; border-radius: 3px; overflow: hidden; margin: 8px 0 2px; max-width: 420px; }
.bar > i { display: block; height: 100%; background: #7d9a7a; }
.badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #f0ece4; color: #6f6a65; }
.badge.ok { background: #e5efe3; color: #3f6a3a; }
.badge.bad { background: #f7e3e0; color: #8a3d34; }
.badge.wait { background: #f4eede; color: #7d6220; }
.phase { background: #fff; border: 1px solid #e6e1d8; border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
.phase.dim { opacity: .55; }
.phase header { display: flex; justify-content: space-between; align-items: baseline; }
ul { margin: 0; padding: 0; list-style: none; }
.tasks li, .accept li { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; padding: 3px 0; }
.tasks .box { color: #7d9a7a; }
.tasks li.done .text { color: #8f8a84; text-decoration: line-through; }
.id { font-size: 11px; color: #a49f98; }
.evidence code { font-size: 11px; background: #fface6; background: #f3efe7; padding: 0 4px; border-radius: 3px; color: #6f6a65; }
.layer { display: inline-block; min-width: 3.6em; margin-right: 6px; padding: 1px 5px; border-radius: 4px; font-size: 10px; letter-spacing: .04em; }
.layer-D { background: #e8eef7; color: #34506f; }
.layer-C { background: #e9f2e9; color: #335533; }
.layer-R { background: #f7f0e2; color: #6b5426; }
.layer-H { background: #f3e8f2; color: #5c3560; }
.review ul { margin: 4px 0 8px; padding-left: 18px; }
.review li { font-size: 12px; color: #5c5750; }
.thread { margin-top: 26px; padding: 16px 18px; background: #fff; border: 1px solid #e6e1d8; border-radius: 10px; }
.rounds li, .waits li, .log li { padding: 3px 0; }
.rounds .n, .log .n { font-size: 11px; color: #a49f98; margin-right: 8px; }
.diff { font-size: 11px; color: #7d6220; margin-left: 8px; }
.log { margin-top: 18px; color: #6f6a65; }
footer { margin-top: 30px; font-size: 11px; color: #a49f98; }
.empty { color: #a49f98; }
.empty { color: #a49f98; }
.now { margin: 0 0 16px; padding: 9px 14px; background: #f2f5ee; border-left: 3px solid #7d9a7a; border-radius: 6px; }
.fold { margin-top: 18px; }
.fold > summary { cursor: pointer; font-size: 12px; color: #6f6a65; letter-spacing: .04em; padding: 4px 0; }
.fold > summary:hover { color: #24211d; }
<div class="head"><span class="state">${escape(state)}</span><span class="meta">自 ${escape(doc.current.since)} · 生成于 ${escape(now.toISOString())}</span></div>
<p class="now"><b>现在该做</b> ${escape(hint)}</p>
${scopeHtml}
${state === "讨论" ? fold("讨论会话", threadHtml, true) + fold("执行期账本：阶段 · 任务 · 验收", progressHtml + phasesHtml, false) : ""}
${state === "执行" ? fold("阶段 · 任务", progressHtml + phasesHtml, true) + fold("讨论会话（已归档/未活动）", threadHtml, false) : ""}
${state === "验收" ? fold("阶段验收：D 可跑 · C 可复核 · R 待处置 · H 签收", progressHtml + phasesHtml, true) + fold("讨论会话（已归档/未活动）", threadHtml, false) : ""}
${fold("最近切换", logHtml, false)}
<footer>只读视图：运行 npm run work:view 重新生成。状态与清单只走 npm run state，不计入账本。</footer>
</body></html>`;
}

export function writeView(root = process.cwd(), output = OUTPUT_PATH, now = new Date()) {
  const file = path.join(root, STATE_PATH);
  const doc = fs.existsSync(file)
    ? upgradeState(JSON.parse(fs.readFileSync(file, "utf8")))
    : emptyState(now);
  const errors = validateState(doc);
  if (errors.length > 0) throw new Error(`状态数据不合规：${errors.join("；")}`);
  const target = path.join(root, output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderView(doc, now), "utf8");
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
