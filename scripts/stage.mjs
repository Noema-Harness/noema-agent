// 阶段入口（Noema 适配层）：打印当前阶段的规则包、活动条目与恢复卡。
// 规则包只保证“提示出现”，不阻断；检查项里的 gate:<id> 必须真实登记在 RULES。
// 内核部分（gate 抽取、恢复卡装配）在 governance/core/packs.mjs；阶段语义在 core/lifecycle.mjs。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { RULES } from "./governance.mjs";
import { decisionEntries, decisionMeta } from "./maintenance.mjs";
import { missingGates, resumeCardText } from "../governance/core/packs.mjs";
import { PHASES } from "../governance/core/lifecycle.mjs";

const PACKS = {
  discussion: "governance/noema/workflow/discussion.md",
  execution: "governance/noema/workflow/execution.md",
  acceptance: "governance/noema/workflow/acceptance.md",
};
const STAGE_LABEL = { discussion: "讨论", execution: "执行", acceptance: "验收" };
const ACTIVE = new Set(["决策中", "执行中", "待验收"]);

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function loadPack(root, stage) {
  const file = path.join(root, PACKS[stage]);
  const text = readText(file);
  if (text === null) return null;
  return { file: PACKS[stage], text };
}

/** 规则包里的检查项必须绑定真实门，否则提示层会说出不存在的门。 */
export function checkPackGates(packText) {
  return missingGates(packText, RULES.map((rule) => rule.id));
}

function lastRound(entry) {
  const lines = entry.body.split(/\n/u);
  let index = -1;
  let number = null;
  for (let at = 0; at < lines.length; at += 1) {
    const match = /^######\s*第\s*(\d+)\s*轮/u.exec(lines[at]);
    if (match) {
      index = at;
      number = Number(match[1]);
    }
  }
  if (index === -1) return null;
  const stop = lines.findIndex((line, at) => at > index && /^#{1,6} /u.test(line));
  const block = lines.slice(index + 1, stop === -1 ? lines.length : stop);
  const conclusion = block.find((line) => /^- 结论：/u.test(line.trim()));
  return { number, conclusion: conclusion ? conclusion.trim().replace(/^- 结论：/u, "") : null };
}

export function activeEntries(root) {
  const text = readText(path.join(root, "docs", "DECISIONS.md")) ?? "";
  return decisionEntries(text)
    .map((entry) => ({ entry, meta: decisionMeta(entry) }))
    .filter(({ meta }) => meta && ACTIVE.has(meta.stage))
    .map(({ entry, meta }) => ({ id: entry.id, title: entry.title, stage: meta.stage, blocker: meta.blocker }));
}

export function resumeCard(root, { stage, id, entries, lastRound: round, commitsSince }) {
  const target = id ? entries.find((item) => item.id === id) : entries.length === 1 ? entries[0] : null;
  return resumeCardText({
    phaseLabel: `${STAGE_LABEL[stage] ?? stage}`,
    stageHint: "--stage 指定；产物是否齐备见规则包进入条件",
    entries,
    id,
    round,
    commitsSince,
    nextAction: nextAction(stage, target, round),
  });
}

function nextAction(stage, target, round) {
  if (!target) return "先决定这一轮推进哪条条目（npm run review 看队列）";
  if (stage === "discussion") {
    return round?.conclusion?.includes("待定") ?? true
      ? "继续讨论：写这一轮结论与待裁变化（npm run decision -- round）"
      : "给用户裁待裁项，或出下一份过渡文档（npm run transition）";
  }
  if (stage === "execution") return "按当前 change 的 tasks 继续切片；偏差与阶段总结写回条目";
  return "生成验收页（npm run transition -- report），等用户确认后收口；不过就退回执行中并写原因";
}

export function commitsSinceBaseline(root) {
  let base = null;
  try {
    const status = fs.readFileSync(path.join(root, "docs", "STATUS.md"), "utf8");
    base = /当前源码基线：`([0-9a-f]{7,40})/u.exec(status)?.[1] ?? null;
  } catch {
    return 0;
  }
  if (!base) return 0;
  try {
    const out = execFileSync("git", ["rev-list", "--count", `${base}..HEAD`], { cwd: root, encoding: "utf8" });
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const [stage] = argv.filter((token) => !token.startsWith("--"));
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
    flags[token.slice(2)] = value;
  }
  if (!PHASES.includes(stage)) {
    console.error(`stage：未知阶段 ${stage ?? "(空)"}；可用 ${PHASES.join(" | ")}`);
    return 2;
  }
  const pack = loadPack(root, stage);
  if (!pack) {
    console.error(`stage：缺少规则包 ${PACKS[stage]}`);
    return 2;
  }
  const missing = checkPackGates(pack.text);
  console.log(`# 阶段规则包：${STAGE_LABEL[stage]}（${pack.file}）\n`);
  console.log(pack.text.trim());
  if (missing.length) {
    console.error(`\nstage：规则包引用了不存在的门 ${missing.join("、")}：先登记到 scripts/governance.mjs 的 RULES`);
    return 1;
  }
  const entries = activeEntries(root);
  const id = typeof flags.entry === "string" ? flags.entry : null;
  if (id && !entries.some((item) => item.id === id)) {
    console.error(`stage：--entry ${id} 不是活动条目（${entries.map((item) => item.id).join("、") || "无"}）`);
    return 1;
  }
  const text = readText(path.join(root, "docs", "DECISIONS.md")) ?? "";
  const entry = id ? decisionEntries(text).find((item) => item.id === id) : null;
  const card = resumeCard(root, {
    stage,
    id,
    entries,
    lastRound: entry ? lastRound(entry) : null,
    commitsSince: commitsSinceBaseline(root),
  });
  console.log(`\n${card}`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("stage.mjs")) {
  process.exitCode = main();
}