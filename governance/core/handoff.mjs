// 执行交接与验收报告：从条目文本生成，模板里的固定节必须齐全，内容来自条目事实。
// 纯文本，不认识项目路径与命令。
const COMPLETION = /^- 完成：(.+)$/u;
const BATCH = /^- 批次：(.+)$/u;
const ITEM = /^- \[([ xX])\] (.*)$/u;
const REOPEN = /^- 重开：(.*)（(\d{4}-\d{2}-\d{2})）/u;

function linesOf(text, pattern) {
  const found = [];
  for (const line of String(text ?? "").split("\n")) {
    const match = pattern.exec(line);
    if (match) found.push(match);
  }
  return found;
}

function tagOf(itemText) {
  const match = /^\[(用户|机制|未验证)\]/u.exec(itemText.trim());
  return match ? match[1] : null;
}

export function handoffFacts(entry) {
  const items = linesOf(entry.acceptanceText, ITEM).map((match) => ({
    checked: match[1].toLowerCase() === "x",
    text: match[2].trim(),
    tag: tagOf(match[2]),
  }));
  return {
    batches: linesOf(entry.executionText, BATCH).map((match) => match[1].trim()),
    completions: linesOf(entry.executionText, COMPLETION).map((match) => match[1].trim()),
    items,
    unverified: items.filter((item) => item.tag === "未验证"),
    open: items.filter((item) => !item.checked),
    risks: linesOf(entry.acceptanceText, REOPEN).map(
      (match) => `${match[1].trim()}（${match[2]}）`,
    ),
  };
}

export function buildHandoffPage({ entry, today }) {
  const facts = handoffFacts(entry);
  const list = (values, fallback = "（无）") =>
    values.length === 0 ? fallback : values.map((value) => `- ${value}`).join("\n");
  const lines = [];
  lines.push(`# 执行交接：${entry.id} ${entry.title}`);
  lines.push("");
  lines.push(`日期：${today}｜阶段：${entry.stage}`);
  lines.push("");
  lines.push("## 触发");
  lines.push("");
  lines.push("- 执行段收尾：批次实现完成，准备交接给验收");
  lines.push("");
  lines.push("## 结构");
  lines.push("");
  lines.push(
    "- 交付物清单、证据索引、未验证项、风险、验收步骤、回退方式；内容取自条目，不重复写设计细节（E20）",
  );
  lines.push("");
  lines.push("## 交付物");
  lines.push("");
  lines.push(list(facts.completions));
  lines.push("");
  lines.push("## 证据索引");
  lines.push("");
  lines.push(list(facts.batches));
  lines.push("");
  lines.push("## 未验证项");
  lines.push("");
  lines.push(list(facts.unverified.map((item) => item.text)));
  lines.push("");
  lines.push("## 已知风险");
  lines.push("");
  lines.push(list(facts.risks));
  lines.push("");
  lines.push("## 验收步骤（≤15 分钟）");
  lines.push("");
  lines.push(
    list(
      facts.open.map((item) => `[${item.tag ?? "未标注"}] ${item.text}`),
      "- 验收项已全部勾选；按验收页复跑一遍",
    ),
  );
  lines.push("");
  lines.push("## 回退方式");
  lines.push("");
  lines.push("- 代码回退：`git revert` 对应批次提交");
  lines.push(
    '- 条目回退：验收不过时 `npm run decision -- advance --stage 决策中 --reason "<哪一处不过>"`，历史保留',
  );
  lines.push("");
  lines.push("## 生成方式");
  lines.push("");
  lines.push(`- \`npm run transition -- handoff --entry ${entry.id} --write\` 自动生成，不手写`);
  lines.push("");
  lines.push("## 判据");
  lines.push("");
  lines.push("- 交付物、证据索引、未验证项都不为空或明确写「无」；验收步骤能 15 分钟内跑完");
  lines.push("");
  return lines.join("\n");
}

export function buildReportPage({ entry, today }) {
  const facts = handoffFacts(entry);
  const events = linesOf(entry.decisionText, /^- .*（用户确认：(\d{4}-\d{2}-\d{2})/u).map(
    (match) => match[1],
  );
  const lines = [];
  lines.push(`# 验收报告：${entry.id} ${entry.title}`);
  lines.push("");
  lines.push(`日期：${today}｜阶段：${entry.stage}`);
  lines.push("");
  lines.push("## 触发");
  lines.push("");
  lines.push("- 验收段收口：用户确认后导出报告");
  lines.push("");
  lines.push("## 结构");
  lines.push("");
  lines.push("- 勾选表、用户原话与日期、遗留项、结论");
  lines.push("");
  lines.push("## 验收勾选表");
  lines.push("");
  for (const item of facts.items) lines.push(`- [${item.checked ? "x" : " "}] ${item.text}`);
  if (facts.items.length === 0) lines.push("- （无验收项）");
  lines.push("");
  lines.push("## 用户原话与日期");
  lines.push("");
  const decisions = linesOf(entry.decisionText, /^- \*\*(E\d+) ([^*]+)\*\*[：；]?\s*(.*)$/u);
  for (const match of decisions) lines.push(`- ${match[1]} ${match[2].trim()}：${match[3].trim()}`);
  if (decisions.length === 0) lines.push("- （无已定 E）");
  if (events.length > 0) lines.push(`- 用户确认日期：${[...new Set(events)].join("、")}`);
  lines.push("");
  lines.push("## 遗留项");
  lines.push("");
  const open = facts.open.map((item) => item.text);
  lines.push(open.length === 0 ? "- 无" : open.map((value) => `- ${value}`).join("\n"));
  lines.push("");
  lines.push("## 结论");
  lines.push("");
  lines.push(
    facts.open.length > 0
      ? `- 未收口：还有 ${facts.open.length} 条验收项没勾选`
      : "- 已收口：验收项全部勾选且用户已确认",
  );
  lines.push("");
  lines.push("## 生成方式");
  lines.push("");
  lines.push(`- \`npm run transition -- report --entry ${entry.id} --write\` 自动生成`);
  lines.push("");
  lines.push("## 判据");
  lines.push("");
  lines.push("- 勾选表与条目一致；结论不早于用户确认");
  lines.push("");
  return lines.join("\n");
}
