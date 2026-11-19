#!/usr/bin/env node
// 条目数据视图：只回答用户关心的两件事——这次讨论了什么、还有什么待裁决。
import fs from "node:fs";
import path from "node:path";
import { loadStore } from "../governance/core/persist.mjs";

const OUT = path.join(".work", "review", "decisions-view.html");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function linesOf(section) {
  return String(section ?? "").split("\n");
}

// 待裁块：优先取「###### 待裁」小节，回退到「- 要定：」与「- 待裁：」行。
function permissionItems(entry) {
  const decision = linesOf(entry.sections?.decision);
  const items = [];
  let inWaiting = false;
  for (const line of decision) {
    if (/^######\s+待裁/u.test(line)) {
      inWaiting = true;
      continue;
    }
    if (inWaiting && /^#{1,6}\s/u.test(line)) break;
    if (inWaiting && /^- (?:T\d+|\[)/u.test(line)) items.push(line.replace(/^- /u, "").trim());
    if (/^- 要定：/u.test(line)) {
      const rest = line.replace(/^- 要定：/u, "").trim();
      if (rest && !rest.startsWith("无") && !items.includes(rest)) items.push(rest);
    }
    if (/^- 待裁：/u.test(line)) {
      const rest = line.replace(/^- 待裁：/u, "").trim();
      if (rest && rest !== "无" && !rest.startsWith("无（") && !items.includes(rest)) items.push(rest);
    }
  }
  return items;
}

// 讨论经过：抽出「###### 第 N 轮」块，保留日期与正文。
function roundsOf(entry) {
  const lines = linesOf(entry.sections?.decision);
  const rounds = [];
  let current = null;
  for (const line of lines) {
    const match = /^######\s+第\s*(\d+)\s*轮(?:（(.+?)）)?/u.exec(line);
    if (match) {
      current = { number: Number(match[1]), date: match[2] ?? "", lines: [] };
      rounds.push(current);
      continue;
    }
    if (!current) continue;
    if (/^#{1,6}\s/u.test(line)) {
      current = null;
      continue;
    }
    if (line.trim()) current.lines.push(line.trim());
  }
  return rounds;
}

function renderEntry(entry) {
  const waits = permissionItems(entry);
  const rounds = roundsOf(entry);
  const waitHtml =
    waits.length === 0
      ? '<p class="empty">没有待裁决项。</p>'
      : `<ul>${waits.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const roundHtml =
    rounds.length === 0
      ? '<p class="empty">还没有轮次记录。</p>'
      : rounds
          .slice()
          .reverse()
          .map(
            (round) => `<details><summary>第 ${round.number} 轮${round.date ? ` · ${escapeHtml(round.date)}` : ""}</summary><div class="body">${round.lines
              .map((line) => `<p>${escapeHtml(line)}</p>`)
              .join("")}</div></details>`,
          )
          .join("");
  return `<section class="entry">
  <h2>${escapeHtml(entry.title)} <span class="id">${escapeHtml(entry.id)}</span> <span class="stage">${escapeHtml(entry.stage)}</span></h2>
  <div class="cols">
    <div class="col"><h3>待裁决</h3>${waitHtml}</div>
    <div class="col"><h3>讨论经过（${rounds.length} 轮）</h3>${roundHtml}</div>
  </div>
</section>`;
}

function build(store) {
  const legacy = store.entries.filter((entry) => !entry.stage);
  const open = store.entries.filter((entry) => entry.stage && entry.stage !== "已收口");
  const closed = store.entries.filter((entry) => entry.stage === "已收口");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>决策视图</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px 32px; font: 15px/1.6 "Segoe UI", "Microsoft YaHei", sans-serif; color: #24211c; background: #faf8f4; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #7b746a; font-size: 13px; margin-bottom: 24px; }
  .entry { background: #fff; border: 1px solid #e8e2d8; border-radius: 10px; padding: 16px 20px; margin-bottom: 16px; }
  h2 { font-size: 16px; margin: 0 0 12px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .id { color: #9a9186; font-size: 12px; font-family: Consolas, monospace; }
  .stage { margin-left: auto; font-size: 12px; color: #7b746a; border: 1px solid #e8e2d8; border-radius: 999px; padding: 1px 10px; }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 20px; }
  @media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }
  h3 { font-size: 13px; text-transform: none; color: #7b746a; margin: 0 0 8px; font-weight: 600; }
  ul { margin: 0; padding-left: 20px; }
  li { margin: 0 0 6px; }
  details { border-top: 1px solid #f1ece3; padding: 6px 0; }
  details:first-of-type { border-top: 0; }
  summary { cursor: pointer; color: #3b372f; }
  .body p { margin: 6px 0 6px 18px; color: #55504a; }
  .empty { color: #9a9186; margin: 0; }
  .closed { margin-top: 28px; }
</style></head><body>
<h1>决策视图</h1>
<div class="meta">${open.length} 个开放条目 · ${closed.length} 个已收口${legacy.length ? ` · ${legacy.length} 个旧格式条目` : ""} · 数据源 governance/data/decisions.json</div>
${open.map(renderEntry).join("\n")}
<section class="closed"><h2>已收口（${closed.length}）</h2>${closed
    .map((entry) => `<div class="meta">${escapeHtml(entry.title)} · ${escapeHtml(entry.id)}</div>`)
    .join("")}</section>
${legacy.length ? `<section class="closed"><h2>旧格式条目（无阶段，${legacy.length}）</h2>${legacy
    .map((entry) => `<div class="meta">${escapeHtml(entry.title)} · ${escapeHtml(entry.id)}</div>`)
    .join("")}</section>` : ""}
<p class="meta" style="margin-top:28px">只读视图：运行 npm run decisions:view 重新生成；改条目请走 npm run governance -- record|move。</p>
</body></html>
`;
}

const store = loadStore(process.cwd());
const html = build(store);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, "utf8");
console.log(`decisions-view: ${OUT}（${store.entries.length} 个条目）`);