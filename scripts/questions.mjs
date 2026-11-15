// Local discussion ledger: keeps open questions out of the conversation.
//
// The ledger lives under `.work/discussions/` (ignored by git). `LEDGER.md` is
// the only index; every question also has a detail file under `q/`. Decisions
// that are settled must be moved into `docs/DECISIONS.md` or a board card, then
// the row moves to `done` — the ledger never becomes a second source of truth.
//
// Usage:
//   node scripts/questions.mjs            # summary
//   node scripts/questions.mjs --all      # every row
//   node scripts/questions.mjs --json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OPEN_LIMIT = 12;
const STALE_DAYS = 14;

export function parseLedger(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/u)) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 7) continue;
    const id = cells[1];
    if (!/^Q-\d{3,}$/u.test(id)) continue;
    rows.push({
      id,
      topic: cells[2],
      status: cells[3],
      question: cells[4],
      advice: cells[5],
      updated: cells[6],
    });
  }
  return rows;
}

export function summarize(
  items,
  { today = new Date(), staleDays = STALE_DAYS, openLimit = OPEN_LIMIT } = {},
) {
  const counts = { open: 0, parked: 0, done: 0, dropped: 0, other: 0 };
  const open = [];
  const stale = [];
  for (const item of items) {
    if (Object.hasOwn(counts, item.status)) counts[item.status] += 1;
    else counts.other += 1;
    if (item.status !== "open") continue;
    open.push(item);
    const updated = Date.parse(item.updated);
    if (Number.isFinite(updated)) {
      const ageDays = Math.floor((today.getTime() - updated) / 86_400_000);
      if (ageDays >= staleDays) stale.push({ ...item, ageDays });
    }
  }
  const oldest =
    [...open].sort((a, b) => String(a.updated).localeCompare(String(b.updated)))[0] ?? null;
  const notices = [];
  if (counts.open > openLimit) {
    notices.push(`open 已 ${counts.open} 项（上限 ${openLimit}）：先收敛再开新问题`);
  }
  for (const item of stale) notices.push(`${item.id} 已 ${item.ageDays} 天未动（open）`);
  return { counts, oldest, stale, notices, items };
}

function readLedger(root) {
  const file = path.join(root, ".work", "discussions", "LEDGER.md");
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}

function main() {
  const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
  const text = readLedger(root);
  if (text === null) {
    console.log(
      "questions · 没有讨论台账（.work/discussions/LEDGER.md）；需要时按 docs/OPERATIONS.md「问题台账」建",
    );
    return;
  }
  const items = parseLedger(text);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(summarize(items), null, 2));
    return;
  }
  if (process.argv.includes("--all")) {
    for (const item of items)
      console.log(`${item.id} [${item.status}] ${item.topic} — ${item.question}`);
    return;
  }
  const result = summarize(items);
  const { counts } = result;
  console.log(
    `问题台账：open ${counts.open} / parked ${counts.parked} / done ${counts.done} / dropped ${counts.dropped}`,
  );
  if (result.oldest) {
    console.log(
      `建议先处理：${result.oldest.id} ${result.oldest.topic} — ${result.oldest.question}`,
    );
  } else {
    console.log("建议先处理：没有 open 项");
  }
  for (const notice of result.notices) console.log(`questions · ${notice}`);
  console.log(
    "questions · 细节在 .work/discussions/q/<id>.md；定案后迁进 docs/DECISIONS.md 或看板卡片",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
