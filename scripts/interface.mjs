#!/usr/bin/env node
// 治理接口（M14）：三个动词——record / move / check。
// 旧命令（stage、acceptance、transition、decision）保留为别名，内部转到同一份实现。
import fs from "node:fs";
import path from "node:path";
import { main as stageMain, loadPack } from "./stage.mjs";
import { main as acceptanceMain } from "./acceptance.mjs";
import { main as transitionMain } from "./transition.mjs";
import { main as decisionMain } from "./decision.mjs";
import { RULES } from "./governance.mjs";
import { VERBS, route } from "../governance/core/interface.mjs";

const RECORD_KINDS = {
  round: (rest) => ["round", ...rest],
  pending: (rest) => ["edit", "--ask", ...rest],
  settle: (rest) => ["settle", ...rest],
  acceptance: (rest) => ["acceptance", ...rest],
  field: (rest) => ["edit", ...rest],
};

const CHECK_KINDS = {
  stage: (rest, root) => stageMain(rest, root),
  acceptance: (rest, root) => acceptanceMain(rest, root),
  transition: (rest, root) => transitionMain(rest, root),
};

export function usage() {
  return [
    "用法：",
    "  npm run governance -- record <round|pending|settle|acceptance|field> --entry <D-…> …",
    "  npm run governance -- move --entry <D-…> --stage <阶段> --approval <原话> …",
    "  npm run governance -- move --restore --from <commit>（经命令恢复条目文件）",
    "  npm run governance -- check <stage|acceptance|transition> …",
    "  npm run governance -- audit [--accept]（规则/门/命令计数；净零检查）",
    "",
    "旧别名仍可用：npm run stage / npm run acceptance / npm run transition / npm run decision。",
  ].join("\n");
}

/** S5 净零审计：规则数、门数、命令数；新增要求必须在基线里写清净额。 */
export function audit(root = process.cwd(), argv = []) {
  const rules = RULES;
  const gates = new Set();
  for (const phase of ["discussion", "execution", "acceptance"]) {
    const pack = loadPack(root, phase);
    for (const match of String(pack?.text ?? "").matchAll(/gate:([a-z0-9-]+)/gu))
      gates.add(match[1]);
  }
  const current = {
    rules: rules.length,
    gates: gates.size,
    commands: Object.keys(RECORD_KINDS).length + 3,
  };
  const baselineFile = path.join(root, "governance", "rules-baseline.json");
  let baseline = null;
  try {
    baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  } catch {
    baseline = null;
  }
  console.log(
    `governance audit：规则 ${current.rules} 条、门 ${current.gates} 个、命令 ${current.commands} 个`,
  );
  if (argv.includes("--accept") || !baseline) {
    fs.writeFileSync(baselineFile, `${JSON.stringify(current, null, 2)}\n`, "utf8");
    console.log(`基线已写 ${path.relative(root, baselineFile)}（规则/门/命令数）`);
    return 0;
  }
  const changed = Object.entries(current).filter(([key, value]) => baseline[key] !== value);
  if (!changed.length) {
    console.log("净额检查：没有新增要求");
    return 0;
  }
  for (const [key, value] of changed) {
    console.error(
      `净额检查：${key} 从 ${baseline[key]} 变成 ${value}——新要求必须写清净额并合并旧要求`,
    );
  }
  console.error("确认这次净增是必需的，跑 npm run governance -- audit --accept 记录基线");
  return 1;
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  if (!argv.length) {
    console.log(usage());
    return 2;
  }
  const parsed = route(argv);
  if (parsed.error) {
    console.error(`interface：${parsed.error}`);
    return 2;
  }
  const { verb, kind, rest } = parsed;
  if (verb === "check") {
    const run = CHECK_KINDS[kind];
    return run(rest, root);
  }
  if (verb === "record") {
    return decisionMain(RECORD_KINDS[kind](rest), root);
  }
  if (verb === "move") {
    if (argv.includes("--restore")) return decisionMain(["restore", ...argv.slice(1)], root);
    return decisionMain(["advance", ...argv.slice(1)], root);
  }
  if (verb === "audit") return audit(root, rest);
  console.error(`interface：未知动词「${verb}」；可用 ${Object.keys(VERBS).join(" / ")}`);
  return 2;
}

if (process.argv[1] && process.argv[1].endsWith("interface.mjs")) {
  process.exitCode = main();
}
