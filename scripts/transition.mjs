// 过渡文档入口（Noema 适配层）：打印模板、生成骨架、校验结构。
// 模板只放骨架与判据；文档本身落在 .work/review/（待审不入库）。
// 结构规则在 governance/core/transitions.mjs；这里只做模板路径、落盘与 CLI。
import fs from "node:fs";
import path from "node:path";
import { localToday } from "./maintenance.mjs";
import {
  checkTransitionText,
  scaffoldText,
  PLACEHOLDER,
  pickTransitionTarget,
} from "../governance/core/transitions.mjs";
import { readEntry } from "../governance/core/entries.mjs";
import { buildHandoffPage, buildReportPage } from "../governance/core/handoff.mjs";

const KINDS = {
  design: {
    file: "governance/noema/workflow/transition/design.md",
    label: "设计方案",
    needsNoPending: true,
  },
  closeout: { file: "governance/noema/workflow/transition/closeout.md", label: "收口" },
  kickoff: {
    file: "governance/noema/workflow/transition/kickoff.md",
    label: "开工清单",
    needsNoPending: true,
  },
  handoff: { file: "governance/noema/workflow/transition/handoff.md", label: "执行交接" },
  report: { file: "governance/noema/workflow/transition/report.md", label: "验收报告" },
};

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function checkTransition(text, kind, root = process.cwd()) {
  const meta = KINDS[kind];
  const template = readText(path.join(root, meta.file));
  if (template === null) return { errors: [`缺少模板 ${meta.file}`] };
  return checkTransitionText(text, template, {
    needsNoPending: Boolean(meta.needsNoPending),
    label: meta.label,
  });
}

export function scaffold(root, kind, { slug, entry, date, createNew = false, reason = null }) {
  const meta = KINDS[kind];
  const template = readText(path.join(root, meta.file));
  if (template === null) throw new Error(`缺少模板 ${meta.file}`);
  const decisions = readText(path.join(root, "docs", "DECISIONS.md")) ?? "";
  if (!decisions.includes(entry ?? "")) {
    throw new Error(
      `--entry ${entry ?? "(空)"} 不在 docs/DECISIONS.md 里：过渡文档必须挂到一条条目`,
    );
  }
  const reviewDir = path.join(root, ".work", "review");
  fs.mkdirSync(reviewDir, { recursive: true });
  const pick = pickTransitionTarget(fs.readdirSync(reviewDir), kind);
  if (pick.error) {
    if (!createNew) throw new Error(pick.error);
    if (!reason) throw new Error(`${pick.error}；--new 必须带理由`);
  }
  const reuse = Boolean(pick.target && !createNew);
  const name = reuse ? pick.target : `${date}-${slug ?? entry}-${kind}.md`;
  const target = path.join(reviewDir, name);
  let body;
  if (kind === "handoff" || kind === "report") {
    // 交接与报告是生成物：内容取自条目，不让人手填（E19/E20）。
    const entryData = readEntry(decisions, entry);
    body =
      kind === "handoff"
        ? buildHandoffPage({ entry: entryData, today: date })
        : buildReportPage({ entry: entryData, today: date });
  } else {
    body = scaffoldText({ label: meta.label, entry, template });
  }
  if (reuse) {
    body = `<!-- 修订：${date} 就地更新，未新建文件${reason ? `；理由：${reason}` : ""} -->\n\n${body}`;
  }
  fs.writeFileSync(target, body, "utf8");
  return {
    written: path.relative(root, target).replaceAll("\\", "/"),
    generated: kind === "handoff" || kind === "report",
    updated: reuse,
    duplicates: pick.duplicates,
  };
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
        createNew: flags.new === true || typeof flags.new === "string",
        reason: typeof flags.new === "string" ? flags.new : null,
      });
      console.log(
        written.updated
          ? `transition：已就地更新 ${written.written}（同类只保留一份，未新建文件）`
          : `transition：已生成 ${written.written}`,
      );
      if (written.generated) {
        console.log(
          `下一步：npm run transition -- ${kind} --check ${written.written}（内容由条目生成，不需要手填）`,
        );
      } else {
        console.log(
          `下一步：填写各节（${PLACEHOLDER} 全部替换），然后 npm run transition -- ${kind} --check ${written.written}`,
        );
      }
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
