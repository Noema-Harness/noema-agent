import fs from "node:fs";
import path from "node:path";
import {
  loadStore,
  parseDecisions,
  renderDecisions,
  saveStore,
  validateStore,
} from "../governance/core/persist.mjs";
import {
  ENTRY_STAGE_MARKS,
  acceptanceItems,
  decisionEntries,
  decisionMeta,
} from "./maintenance.mjs";

export function localToday(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 验收项在 GitHub 上直接勾选；勾完运行 `npm run decisions:sync` 把阶段改成已收口。
// 只有“待验收 + 全部勾选”才自动收口，其它阶段只对齐标题标记，不改变结论。
export function syncDecisions(text, today = localToday()) {
  const blocks = String(text).split(/\n(?=## )/u);
  const changes = [];
  const synced = blocks.map((block) => {
    const id = decisionEntries(block)[0]?.id;
    if (!id) return block;
    const entry = decisionEntries(block)[0];
    const meta = decisionMeta(entry);
    if (!meta) return block;
    const items = acceptanceItems(entry.body);
    const allChecked = items.length > 0 && items.every((item) => item.checked);
    const stage = meta.stage === "待验收" && allChecked ? "已收口" : meta.stage;
    const mark = ENTRY_STAGE_MARKS[stage];
    if (!mark) return block;
    let lines = block.split("\n");
    lines[0] = lines[0].replace(/^## (?:[⏳🔧🔍✅]\s+)?/u, `## ${mark} `);
    if (stage !== meta.stage) {
      lines = lines.map((line) =>
        line.startsWith("- **阶段**：") ? `- **阶段**：${stage}` : line,
      );
      if (stage === "已收口" && !/- 用户确认：\d{4}-\d{2}-\d{2}/u.test(lines.join("\n"))) {
        const start = lines.findIndex((line) => line === "#### 3 验收");
        let insertAt = lines.length;
        if (start >= 0) {
          insertAt = start + 1;
          for (let i = start + 1; i < lines.length; i += 1) {
            if (lines[i].startsWith("## ") || lines[i].startsWith("### ")) break;
            if (lines[i].startsWith("- ")) insertAt = i + 1;
          }
        }
        lines.splice(insertAt, 0, `- 用户确认：${today}`);
      }
    }
    const next = lines.join("\n");
    if (next === block) return block;
    changes.push({ id, from: meta.stage, to: stage });
    return next;
  });
  return { text: synced.join("\n"), changes };
}

async function main() {
  const root = process.cwd();
  const storePath = path.join("governance", "data", "decisions.json");
  const target = path.join(root, "docs", "DECISIONS.md");
  const dryRun = process.argv.includes("--dry-run");
  const { text, changes } = syncDecisions(renderDecisions(loadStore(root, storePath)));
  if (changes.length === 0) {
    console.log("decisions-sync: 没有需要收口的条目");
    return;
  }
  for (const change of changes) {
    console.log(`decisions-sync · ${change.id}：${change.from} → ${change.to}`);
  }
  if (!dryRun) {
    const next = parseDecisions(text);
    const errors = validateStore(next).errors;
    if (errors.length > 0) throw new Error(`数据校验失败：${errors.join("；")}`);
    saveStore(root, next, storePath);
    fs.writeFileSync(target, renderDecisions(next), "utf8");
    const stamp = path.join(root, ".work", "decision-writes", "DECISIONS.json");
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    const sha256 = (await import("node:crypto")).createHash("sha256")
      .update(`${JSON.stringify(next, null, 2)}\n`)
      .digest("hex");
    fs.writeFileSync(
      stamp,
      `${JSON.stringify({ path: "governance/data/decisions.json", sha256, at: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  }
  console.log(`decisions-sync: ${changes.length} 条${dryRun ? "（未写入）" : "已更新"}`);
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/decisions.mjs")) {
  main();
}
