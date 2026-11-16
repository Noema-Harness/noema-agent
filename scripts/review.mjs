#!/usr/bin/env node
// 只读审核视图：把 DECISIONS 里需要用户动作的条目聚到一屏。
// 不新增文件、不复制内容；条目本身仍是唯一权威源（D-20261116-review-inbox）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENTRY_STAGE_MARKS,
  acceptanceItems,
  decisionEntries,
  decisionMeta,
} from "./maintenance.mjs";

export function summarizeReview(text) {
  const groups = { decide: [], accept: [], running: [], closed: [] };
  for (const entry of decisionEntries(text)) {
    const meta = decisionMeta(entry);
    if (!meta) continue;
    const items = acceptanceItems(entry.body);
    const item = {
      id: entry.id,
      title: entry.title,
      stage: meta.stage,
      blocker: meta.blocker,
      issue: meta.issue,
      checked: items.filter((entry) => entry.checked).length,
      total: items.length,
    };
    if (meta.stage === "决策中") groups.decide.push(item);
    else if (meta.stage === "待验收") groups.accept.push(item);
    else if (meta.stage === "执行中") groups.running.push(item);
    else groups.closed.push(item);
  }
  return groups;
}

function issueLink(issue) {
  return issue ? ` · https://github.com/Noema-Harness/noema-agent/issues/${issue}` : "";
}

export function formatReview(groups) {
  const lines = [];
  const section = (label, mark, items, note) => {
    lines.push(`${mark} ${label}（${items.length}）`);
    if (!items.length) lines.push("  无");
    for (const item of items) {
      const progress = item.total ? `（${item.checked}/${item.total} 项已勾选）` : "";
      lines.push(`  ${item.id} ${item.title}${progress}${issueLink(item.issue)}`);
      const details = [`${mark} ${item.stage}`];
      if (item.blocker && item.blocker !== "无") details.push(`阻塞：${item.blocker}`);
      lines.push(`    ${details.join(" · ")}`);
    }
    if (note) lines.push(`  ${note}`);
    lines.push("");
  };
  section("需要你决定", ENTRY_STAGE_MARKS.决策中, groups.decide);
  section(
    "待你验收",
    ENTRY_STAGE_MARKS.待验收,
    groups.accept,
    "勾选条目里的验收项，然后运行 npm run decisions:sync 收口。",
  );
  section(
    "执行中",
    ENTRY_STAGE_MARKS.执行中,
    groups.running,
    "不打扰：只在需要决定或被阻塞时出现。",
  );
  lines.push(`✅ 已收口 ${groups.closed.length} 条`);
  return lines.join("\n");
}

function main(argv) {
  const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
  const file = path.join(root, "docs", "DECISIONS.md");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const groups = summarizeReview(text);
  if (argv.includes("--json")) {
    console.log(JSON.stringify(groups, null, 2));
    return 0;
  }
  console.log(formatReview(groups));
  return 0;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
