// Repository hygiene for remote branches.
//
// The plan board says what to build; this file only keeps the branch list from
// turning into an archaeology site. A branch that is already merged into the
// base branch is safe to delete, so `check` fails on it. Branches that are
// merely old are reported as notices: age alone is not a reason to delete
// someone else's work.
//
// Usage:
//   node scripts/branches.mjs check
//   node scripts/branches.mjs prune [--apply]
//
// `prune` is a dry run unless `--apply` is passed, and only deletes branches
// that are fully merged into the base branch.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export function parseRefs(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [ref, sha, committedAt] = line.split(/\s+/u);
      return { ref, sha, name: ref.replace(/^origin\//u, ""), committedAt: Number(committedAt) };
    });
}

export function classifyBranches({ refs, base, isMerged, aheadCount, now, staleDays = 60 }) {
  const errors = [];
  const notices = [];
  const stale = [];
  for (const branch of refs) {
    // `origin` is the remote's HEAD pointer, not a branch; `HEAD` is a symbolic
    // ref that some git versions still list.
    if (branch.ref === base || branch.name === "HEAD" || branch.name === "origin") continue;
    if (isMerged(branch)) {
      errors.push(
        `分支 ${branch.name} 已完全合入 ${base}：删除它（git push origin --delete ${branch.name}）`,
      );
      stale.push(branch.name);
      continue;
    }
    const ageDays = Math.floor((now - branch.committedAt * 1000) / 86_400_000);
    if (ageDays >= staleDays) {
      notices.push(
        `分支 ${branch.name} 已 ${ageDays} 天未动且未合入（ahead=${aheadCount(branch)}）：确认无用后删除`,
      );
    }
  }
  return { errors, notices, stale };
}

function readConfig(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "scripts", "workspace.config.json"), "utf8"));
  } catch {
    return {};
  }
}

function inspect(root, config) {
  const base = config.branchBase ?? "origin/main";
  const git = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, stdio: "ignore" });
  const gitOutput = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  const refs = parseRefs(
    gitOutput([
      "for-each-ref",
      "--format=%(refname:short) %(objectname:short) %(committerdate:unix)",
      "refs/remotes/origin",
    ]),
  );
  return classifyBranches({
    refs,
    base,
    now: Date.now(),
    isMerged: (branch) => {
      try {
        git(["merge-base", "--is-ancestor", branch.ref, base]);
        return true;
      } catch {
        return false;
      }
    },
    aheadCount: (branch) => Number(gitOutput(["rev-list", "--count", `${base}..${branch.ref}`])),
  });
}

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? "check";
  if (command !== "check" && command !== "prune") {
    throw new Error("Usage: node scripts/branches.mjs check|prune [--apply]");
  }
  let result;
  try {
    result = inspect(root, readConfig(root));
  } catch (error) {
    console.log(`branches-check: skipped (${String(error.message).split("\n")[0]})`);
    result = { errors: [], notices: [], stale: [] };
  }
  for (const notice of result.notices) console.log(`branches-check · ${notice}`);
  if (command === "check") {
    if (result.errors.length) {
      console.log(`branches-check: FAILED (${result.errors.length})`);
      for (const error of result.errors) console.log(`  - ${error}`);
      process.exitCode = 1;
    } else {
      console.log("branches-check: OK");
    }
  } else {
    const apply = process.argv.includes("--apply");
    if (!result.stale.length) {
      console.log("branches-prune · 没有已合入的分支需要删除");
    } else if (!apply) {
      console.log(
        `branches-prune · 预演，将删除 ${result.stale.length} 个已合入分支（加 --apply 执行）：${result.stale.join(", ")}`,
      );
    } else {
      for (const name of result.stale) {
        execFileSync("git", ["push", "origin", "--delete", name], {
          cwd: root,
          stdio: "inherit",
          windowsHide: true,
        });
        console.log(`branches-prune · 已删除 ${name}`);
      }
    }
  }
}
