// 治理入口：同一批规则按“什么时候该跑”分成三种 profile。
// 原则：一个传感器只接一次线；越贵的检查越靠后（提交时只跑秒级项，收口时才跑全量）。
// - commit：提交前只跑文档与计划（约 0.3s）
// - milestone：一个切口收口时跑全部本地检查（约 40s，含全量测试）
// - ci：远端里程碑验证，与 milestone 相同；CI 不在每轮跑
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

const nodeStep = (script, args = []) => ({ kind: "node", script, args });
const npmStep = (name) => ({ kind: "npm", name });

export const PROFILES = {
  commit: [nodeStep("scripts/maintenance.mjs", ["precommit"])],
  milestone: [
    nodeStep("scripts/workspace.mjs", ["check"]),
    nodeStep("scripts/branches.mjs", ["check"]),
    nodeStep("scripts/maintenance.mjs", ["docs"]),
    nodeStep("scripts/figure.mjs", ["check"]),
    nodeStep("scripts/maintenance.mjs", ["plan"]),
    nodeStep("scripts/source-structure.mjs"),
    npmStep("lint"),
    npmStep("typecheck"),
    npmStep("tools:test"),
    npmStep("test"),
  ],
};

// CI 跑的就是里程碑，不另起一套；两条路径同源，避免“本地过、CI 不过”。
PROFILES.ci = PROFILES.milestone;

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

function main() {
  const name = process.argv[2] ?? "milestone";
  const steps = PROFILES[name];
  if (!steps) {
    console.error(`governance: unknown profile ${name}; use ${profileNames().join("|")}`);
    return 2;
  }
  for (const step of steps) {
    if (step.kind === "node" && !fs.existsSync(path.join(root, step.script))) {
      console.error(`governance: ${name} missing ${step.script}`);
      return 2;
    }
  }
  const started = Date.now();
  for (const step of steps) {
    try {
      run(step);
    } catch {
      console.error(`governance: ${name} failed at ${label(step)}`);
      return 1;
    }
  }
  console.log(`governance: ${name} OK (${Date.now() - started}ms)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
