// 验收页装配：从条目文本读出已定 E 与验收层勾选行，按 E 分节并标出未覆盖项。
// 纯文本，不认识项目路径与命令。
const E_LINE = /^- \*\*(E\d+) ([^*]+)\*\*[：；]?[\s]*(.*)$/u;
const ITEM_LINE = /^- \[([ xX])\] (.*)$/u;
const DATE = /(\d{4}-\d{2}-\d{2})/u;

export function decisionsOf(decisionText) {
  const decisions = [];
  for (const line of String(decisionText).split("\n")) {
    const match = E_LINE.exec(line);
    if (!match) continue;
    decisions.push({
      id: match[1],
      title: match[2].trim(),
      detail: match[3].trim(),
      date: DATE.exec(match[3])?.[1] ?? null,
    });
  }
  return decisions;
}

export function acceptanceItemsOf(acceptanceText) {
  const items = [];
  for (const line of String(acceptanceText).split("\n")) {
    const match = ITEM_LINE.exec(line);
    if (!match) continue;
    const text = match[2].trim();
    items.push({
      text,
      checked: match[1].toLowerCase() === "x",
      es: eRefs(text),
    });
  }
  return items;
}

/** 验收项可以写单个 E，也可以写区间（E1–E10）；区间展开成逐个 E，覆盖才不靠人肉清点。 */
function eRefs(text) {
  const ids = new Set();
  for (const match of String(text).matchAll(/\bE(\d+)\s*[–\-~—至到]\s*E?(\d+)\b/gu)) {
    const from = Number(match[1]);
    const to = Number(match[2]);
    for (let n = Math.min(from, to); n <= Math.max(from, to); n += 1) ids.add(`E${n}`);
  }
  for (const match of String(text).matchAll(/\bE\d+\b/gu)) ids.add(match[0]);
  return [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

export function assembleAcceptance(entry) {
  const decisions = decisionsOf(entry.decisionText ?? "");
  const items = acceptanceItemsOf(entry.acceptanceText ?? "");
  const known = new Set(decisions.map((decision) => decision.id));
  const covered = new Set(items.flatMap((item) => item.es).filter((id) => known.has(id)));
  const uncovered = decisions.map((decision) => decision.id).filter((id) => !covered.has(id));
  return {
    decisions,
    items,
    covered: [...covered],
    uncovered,
    unmapped: items.filter((item) => item.es.length === 0),
  };
}

export function buildAcceptancePage({ entry, today, source = null }) {
  const report = assembleAcceptance(entry);
  const lines = [];
  lines.push(`# 验收页：${entry.id} ${entry.title}`);
  lines.push("");
  lines.push(`日期：${today}｜阶段：${entry.stage}${source ? `｜来源：${source}` : ""}`);
  lines.push("");
  lines.push(`## 决定（${report.decisions.length} 项）`);
  lines.push("");
  for (const decision of report.decisions) {
    lines.push(`- ${decision.id} ${decision.title}${decision.date ? `（${decision.date}）` : ""}`);
  }
  if (report.decisions.length === 0) lines.push("- 无：条目还没有已定 E 行");
  lines.push("");
  lines.push("## 验收项（按 E 分节）");
  lines.push("");
  for (const decision of report.decisions) {
    const related = report.items.filter((item) => item.es.includes(decision.id));
    if (related.length === 0) continue;
    lines.push(`### ${decision.id} ${decision.title}`);
    lines.push("");
    for (const item of related) lines.push(`- [${item.checked ? "x" : " "}] ${item.text}`);
    lines.push("");
  }
  if (report.unmapped.length > 0) {
    lines.push("### 未映射验收项（没有写 E 编号）");
    lines.push("");
    for (const item of report.unmapped) lines.push(`- [${item.checked ? "x" : " "}] ${item.text}`);
    lines.push("");
  }
  lines.push(`## 未覆盖的 E（${report.uncovered.length} 项）`);
  lines.push("");
  if (report.uncovered.length === 0) lines.push("- 无：每个已定 E 都有验收项指向它");
  else for (const id of report.uncovered) lines.push(`- ${id}`);
  lines.push("");
  const open = report.items.filter((item) => !item.checked);
  lines.push("## 手测步骤");
  lines.push("");
  if (open.length === 0)
    lines.push("- 验收项已全部勾选；按条目「已定细则」里的手测步骤复跑一遍即可");
  else {
    lines.push(
      "- 逐条执行下面未勾选的验收项；带 `[用户]` 的请用户本人操作，带 `[机制]` 的由维护者跑命令",
    );
    for (const item of open) lines.push(`  - ${item.text}`);
  }
  lines.push("");
  const blocked = report.uncovered.length > 0;
  lines.push("## 结论");
  lines.push("");
  lines.push(
    blocked
      ? `- 不能收口：还有 ${report.uncovered.length} 个已定 E 没有验收项（${report.uncovered.join("、")}）`
      : open.length > 0
        ? `- 可以移交用户验收：${open.length} 条未勾选`
        : "- 可以收口：验收项已全部勾选、每个已定 E 都有验收项",
  );
  lines.push("");
  return { text: lines.join("\n"), report };
}
