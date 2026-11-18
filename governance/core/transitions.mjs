// 治理内核：过渡文档的结构规则。
//
// 过渡文档（设计方案 / 收口 / 开工清单 / 执行交接 / 验收报告）共用：
// 模板节必须齐全、不留占位符、需要批准的文档「待确认项」必须写「- 无」。
// 模板路径、类型名、落盘位置由适配层提供。

export const PLACEHOLDER = "（待填）";

export function templateHeadings(text) {
  return [...String(text).matchAll(/^## (.+)$/gmu)].map((match) => match[1].trim());
}

function escapeHeading(heading) {
  return heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * 校验一份过渡文档：text 待检文档，template 模板正文。
 * needsNoPending：设计方案与开工清单在批准前必须没有未定项。
 */
export function checkTransitionText(text, template, { needsNoPending = false, label = "" } = {}) {
  const errors = [];
  for (const heading of templateHeadings(template)) {
    if (!new RegExp(`^## ${escapeHeading(heading)}$`, "mu").test(text)) {
      errors.push(`缺少「## ${heading}」一节`);
    }
  }
  if (String(text).includes(PLACEHOLDER)) {
    errors.push(`还有没填的「${PLACEHOLDER}」：填完再提交审核`);
  }
  if (needsNoPending) {
    const section = /## [^\n]*待确认项[^\n]*\n([\s\S]*?)(?=\n## |$)/u.exec(text)?.[1] ?? "";
    if (!/待确认项/u.test(text)) {
      errors.push(`${label || "本文档"}缺少「待确认项」一节`);
    } else if (!/^\s*-\s*无\s*$/mu.test(section)) {
      errors.push("「待确认项」必须写「- 无」才能提交批准：有未定项先回讨论");
    }
  }
  return { errors };
}

/** 由模板生成骨架正文：去掉模板的一级标题，每个二级标题下留占位符。 */
export function scaffoldText({ label, entry, template, placeholder = PLACEHOLDER }) {
  return [
    `# ${label}：${entry}`,
    "",
    `> 待审稿，不进仓库。来源条目：${entry}。填完后按判据自检，再请用户确认。`,
    "",
    template
      .replace(/^#\s+.*$/mu, "")
      .replace(/^## (.+)$/gmu, (_, heading) => `## ${heading}\n\n${placeholder}`)
      .trim(),
    "",
  ].join("\n");
}

/** 过渡文档的唯一性与就地更新（M16）：同一 kind 只允许一份，回工改那一份。 */
export const DOC_SINGLETON_KINDS = ["design", "closeout", "kickoff", "handoff", "report"];

/** 从文件名（日期-主题-<kind>.md）取 kind；不认识的返回 null。 */
export function transitionKindOf(fileName) {
  const match = /-([a-z]+)\.md$/u.exec(String(fileName));
  return match && DOC_SINGLETON_KINDS.includes(match[1]) ? match[1] : null;
}

/** 同类过渡文档出现多份的分组（零份/一份不出现在结果里）。 */
export function duplicateTransitionDocs(fileNames) {
  const groups = new Map();
  for (const name of fileNames) {
    const kind = transitionKindOf(name);
    if (!kind) continue;
    groups.set(kind, [...(groups.get(kind) ?? []), name]);
  }
  return [...groups]
    .filter(([, files]) => files.length > 1)
    .map(([kind, files]) => ({ kind, files: [...files].sort((a, b) => a.localeCompare(b)) }));
}

/**
 * 选本次 --write 的落点：同类只有一份时更新那一份；没有则新建；
 * 出现多份时报错，先合并再写。
 */
export function pickTransitionTarget(fileNames, kind) {
  const mine = fileNames
    .filter((name) => transitionKindOf(name) === kind)
    .sort((a, b) => a.localeCompare(b));
  if (mine.length > 1) {
    return {
      target: mine[mine.length - 1],
      duplicates: mine,
      error: `同类过渡文档有 ${mine.length} 份（${mine.join("、")}）：先合并到一份再写；确认要另开一份时用 --new "<理由>"`,
    };
  }
  return { target: mine[0] ?? null, duplicates: mine, error: null };
}
