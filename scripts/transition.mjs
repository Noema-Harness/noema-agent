// 过渡文档入口：打印模板、生成骨架、校验结构。
// 模板只放骨架与判据；文档本身落在 .work/review/（待审不入库）。
import fs from "node:fs";
import path from "node:path";
import { localToday } from "./maintenance.mjs";

const KINDS = {
  design: { file: "governance/noema/workflow/transition/design.md", label: "设计方案", needsNoPending: true },
  closeout: { file: "governance/noema/workflow/transition/closeout.md", label: "收口" },
  kickoff: { file: "governance/noema/workflow/transition/kickoff.md", label: "开工清单", needsNoPending: true },
  handoff: { file: "governance/noema/workflow/transition/handoff.md", label: "执行交接" },
  report: { file: "governance/noema/workflow/transition/report.md", label: "验收报告" },
};
const PLACEHOLDER = "（待填）";

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function templateHeadings(text) {
  return [...String(text).matchAll(/^## (.+)$/gmu)].map((match) => match[1].trim());
}

export function checkTransition(text, kind, root = process.cwd()) {
  const meta = KINDS[kind];
  const errors = [];
  const template = readText(path.join(root, meta.file));
  if (template === null) return { errors: [`缺少模板 ${meta.file}`] };
  for (const heading of templateHeadings(template)) {
    if (!new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu").test(text)) {
      errors.push(`缺少「## ${heading}」一节`);
    }
  }
  if (String(text).includes(PLACEHOLDER)) {
    errors.push(`还有没填的「${PLACEHOLDER}」：填完再提交审核`);
  }
  if (meta.needsNoPending) {
    const section = /## [^\n]*待确认项[^\n]*\n([\s\S]*?)(?=\n## |$)/u.exec(text)?.[1] ?? "";
    if (!/待确认项/u.test(text) && kind === "design") {
      errors.push("设计方案缺少「## 9 待确认项」一节");
    } else if (/待确认项/u.test(text) && !/^\s*-\s*无\s*$/mu.test(section)) {
      errors.push("「待确认项」必须写「- 无」才能提交批准：有未定项先回讨论");
    }
  }
  return { errors };
}

export function scaffold(root, kind, { slug, entry, date }) {
  const meta = KINDS[kind];
  const template = readText(path.join(root, meta.file));
  if (template === null) throw new Error(`缺少模板 ${meta.file}`);
  if (!readText(path.join(root, "docs", "DECISIONS.md"))?.includes(entry ?? "")) {
    throw new Error(`--entry ${entry ?? "(空)"} 不在 docs/DECISIONS.md 里：过渡文档必须挂到一条条目`);
  }
  const name = `${date}-${slug ?? entry}-${kind}.md`;
  const target = path.join(root, ".work", "review", name);
  const body = [
    `# ${meta.label}：${entry}`,
    "",
    `> 待审稿，不进仓库。来源条目：${entry}。填完后按判据自检，再请用户确认。`,
    "",
    template
      .replace(/^#\s+.*$/mu, "")
      .replace(/^## (.+)$/gmu, (_, heading) => `## ${heading}\n\n${PLACEHOLDER}`)
      .trim(),
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
  return path.relative(root, target).replaceAll("\\", "/");
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const positional = argv.filter((token) => !token.startsWith("--"));
  const kind = positional[0];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
    flags[token.slice(2)] = value;
  }
  if (!KINDS[kind]) {
    console.error(`transition：未知类型 ${kind ?? "(空)"}；可用 ${Object.keys(KINDS).join(" | ")}`);
    return 2;
  }
  const meta = KINDS[kind];
  const template = readText(path.join(root, meta.file));
  if (template === null) {
    console.error(`transition：缺少模板 ${meta.file}`);
    return 2;
  }
  if (typeof flags.check === "string") {
    const text = readText(path.resolve(root, flags.check));
    if (text === null) {
      console.error(`transition：读不到 ${flags.check}`);
      return 1;
    }
    const { errors } = checkTransition(text, kind);
    if (errors.length) {
      for (const error of errors) console.error(`transition：${error}`);
      return 1;
    }
    console.log(`transition：${flags.check} 结构通过（${meta.label}）`);
    return 0;
  }
  if (flags.write === true) {
    try {
      const written = scaffold(root, kind, {
        slug: typeof flags.slug === "string" ? flags.slug : undefined,
        entry: typeof flags.entry === "string" ? flags.entry : undefined,
        date: typeof flags.date === "string" ? flags.date : localToday(),
      });
      console.log(`transition：已生成 ${written}`);
      console.log(`下一步：填写各节（${PLACEHOLDER} 全部替换），然后 npm run transition -- ${kind} --check ${written}`);
      return 0;
    } catch (error) {
      console.error(`transition：${error.message}`);
      return 1;
    }
  }
  console.log(template.trim());
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("transition.mjs")) {
  process.exitCode = main();
}