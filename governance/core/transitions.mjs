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