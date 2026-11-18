// 治理内核：规则包与恢复卡。
//
// 规则包是“提示层”：检查项带 gate:<id>，必须绑定真实登记的门；恢复卡只放指针
// （阶段、条目、上一轮结论、下一步）。本模块不知道门从哪里来、规则包放在哪，
// 已知门 id 列表与所有标签都由适配层注入。

/** 取规则包正文里出现的 gate id（去重、保序）。 */
export function gateIds(packText) {
  const seen = [];
  for (const match of String(packText).matchAll(/gate:([a-z0-9-]+)/gu)) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

/** 规则包引用了未登记的门时返回缺失列表；空数组表示通过。 */
export function missingGates(packText, knownIds) {
  const known = new Set(knownIds);
  return gateIds(packText).filter((id) => !known.has(id));
}

/**
 * 恢复卡的文本装配。所有面向用户的字串由调用方给出，保证内核不写死项目语汇。
 * entries：{id, stage, blocker} 列表；round：{number, conclusion} 或 null。
 */
export function resumeCardText({
  heading = "## 恢复卡",
  phaseLabel,
  stageHint,
  entries = [],
  id = null,
  round = null,
  commitsSince = 0,
  nextAction,
  entryLabel = "条目",
  roundLabel = "上一轮",
}) {
  const lines = [heading];
  lines.push(`- 当前阶段：${phaseLabel}${stageHint ? `（${stageHint}）` : ""}`);
  const target = id ? entries.find((item) => item.id === id) : entries.length === 1 ? entries[0] : null;
  if (target) {
    lines.push(`- ${entryLabel}：${target.id}（${target.stage}${target.blocker ? `；阻塞：${target.blocker}` : ""}）`);
  } else if (entries.length === 0) {
    lines.push(`- ${entryLabel}：没有活动条目`);
  } else {
    lines.push(`- ${entryLabel}：${entries.length} 条活动条目，用 --entry <id> 指定`);
    for (const item of entries) lines.push(`  - ${item.id}（${item.stage}）`);
  }
  lines.push(
    `- ${roundLabel}：${round ? `第 ${round.number} 轮${round.conclusion ? `——${round.conclusion}` : ""}` : "没有轮次记录"}`,
  );
  lines.push(`- 下一步：${nextAction}`);
  if (commitsSince) {
    lines.push(`- 自上次记录以来 ${commitsSince} 个新提交：先 git log 看是否涉及本条目`);
  }
  return lines.join("\n");
}