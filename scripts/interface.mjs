#!/usr/bin/env node
// 治理接口（M14）：三个动词——record / move / check。
// 旧命令（stage、acceptance、transition、decision）保留为别名，内部转到同一份实现。
import { main as stageMain } from "./stage.mjs";
import { main as acceptanceMain } from "./acceptance.mjs";
import { main as transitionMain } from "./transition.mjs";
import { main as decisionMain } from "./decision.mjs";

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
    "  npm run governance -- check <stage|acceptance|transition> …",
    "",
    "旧别名仍可用：npm run stage / npm run acceptance / npm run transition / npm run decision。",
  ].join("\n");
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const [verb, target, ...rest] = argv;
  if (!verb) {
    console.log(usage());
    return 2;
  }
  if (verb === "check") {
    const run = CHECK_KINDS[target];
    if (!run) {
      console.error(
        `interface：未知的 check 目标「${target ?? "(空)"}」；可用 stage/acceptance/transition`,
      );
      return 2;
    }
    return run(rest, root);
  }
  if (verb === "record") {
    const build = RECORD_KINDS[target];
    if (!build) {
      console.error(
        `interface：未知的 record 对象「${target ?? "(空)"}」；可用 round/pending/settle/acceptance/field`,
      );
      return 2;
    }
    return decisionMain(build(rest), root);
  }
  if (verb === "move") {
    return decisionMain(["advance", ...argv.slice(1)], root);
  }
  console.error(`interface：未知动词「${verb}」；可用 record/move/check`);
  return 2;
}

if (process.argv[1] && process.argv[1].endsWith("interface.mjs")) {
  process.exitCode = main();
}
