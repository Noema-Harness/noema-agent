// 里程碑与提交门的入口：把分散的检查步骤串成一条链。
//
// `npm run check` = 里程碑（本地全量）；CI 跑同一条链，避免「本地过、CI 不过」。
// 只保留能被机器判定的结构检查；规则文本在 governance/，命令在 OPERATIONS。

import { execFileSync, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const nodeStep = (script, args = []) => ({ kind: "node", script, args });
const npmStep = (name) => ({ kind: "npm", name });

export const PROFILES = {
  commit: [nodeStep("scripts/maintenance.mjs", ["precommit"])],
  milestone: [
    nodeStep("scripts/workspace.mjs", ["check"]),
    nodeStep("scripts/branches.mjs", ["check"]),
    nodeStep("scripts/maintenance.mjs", ["docs"]),
    nodeStep("scripts/figure.mjs", ["check"]),
    nodeStep("scripts/source-structure.mjs"),
    npmStep("lint"),
    npmStep("typecheck"),
    npmStep("tools:test"),
    npmStep("test"),
  ],
};
PROFILES.ci = PROFILES.milestone;

export const INVARIANTS = ["意图可追", "变更可逆", "结果可验", "事实唯一", "成本受控"];

// 规则登记表：id | 不变量 | 防住什么 | 证据 | 门槛级别 | 落点
const RULE_TABLE = [
  "source-boundary|事实唯一|产品代码绕过约定目录，别人找不到入口|真实触发过：新增模块被 source:check 拦住|block|source:check",
  "workspace-root-dirs|成本受控|仓库根目录膨胀成杂物间|真实触发过：新目录未登记被 workspace:check 拦住|block|workspace:check",
  "status-today|事实唯一|STATUS 的版本与基线停在旧提交|真实触发过：交付前 docs:check 报不一致|block|docs:check",
];

export const RULES = RULE_TABLE.map((line) => {
  const [id, invariant, prevents, evidence, level, where] = line.split("|");
  return { id, invariant, prevents, evidence, level, where };
});

export function profileNames() {
  return Object.keys(PROFILES);
}

function label(step) {
  return step.kind === "node" ? step.script : `npm run ${step.name}`;
}

function run(step) {
  if (step.kind === "node") {
    execFileSync(process.execPath, [step.script, ...step.args], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    return;
  }
  execSync(`npm run ${step.name} --silent`, { cwd: root, stdio: "inherit", env: process.env });
}

export function profileScripts(name) {
  return (PROFILES[name] ?? []).filter((step) => step.kind === "node").map((step) => step.script);
}

export function main(argv = process.argv.slice(2)) {
  const name = argv[0];
  const steps = PROFILES[name];
  if (!steps) {
    console.error(`用法：governance.mjs <${profileNames().join("|")}>`);
    return 2;
  }
  for (const step of steps) {
    console.log(`governance: ${label(step)}`);
    run(step);
  }
  console.log(`governance: ${name} OK`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("governance.mjs")) {
  process.exitCode = main();
}