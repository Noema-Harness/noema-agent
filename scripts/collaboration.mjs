// 协作者契约的可执行部分：谁能改维护者路径。
// 事实源是 CONTRIBUTING.md 的「只能维护者改」表；这里只做 PR 判定，不代替维护者审核。
// CI 在 pull_request 上跑；本地可用 `node scripts/collaboration.mjs --actor <登录名> --base origin/main` 预演。
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

export const MAINTAINERS = ["c3115644151"];

// 结尾带 / 的按前缀匹配，否则精确匹配。
export const MAINTAINER_ONLY_PATHS = [
  "AGENTS.md",
  "governance/",
  ".github/",
  ".githooks/",
  "scripts/",
  "package.json",
];

export function isMaintainer(actor, maintainers = MAINTAINERS) {
  return maintainers.includes(actor);
}

function touches(file, prefix) {
  return prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix;
}

export function guardContribution({ actor, files = [], maintainers = MAINTAINERS } = {}) {
  const errors = [];
  const notices = [];
  const changed = files.filter((file) => typeof file === "string" && file.trim());
  if (!changed.length) {
    notices.push("没有检测到改动文件：PR 为空，或差异命令没有输出。");
    return { errors, notices };
  }
  if (isMaintainer(actor, maintainers)) {
    notices.push(`${actor} 是维护者，可以改维护者路径。`);
    return { errors, notices };
  }
  const blocked = changed.filter((file) =>
    MAINTAINER_ONLY_PATHS.some((prefix) => touches(file, prefix)),
  );
  if (blocked.length) {
    errors.push(
      `协作者不能改维护者路径：${blocked.join("、")}。把这些改动留给维护者，或先在 issue 里说明理由。`,
    );
  }
  return { errors, notices };
}

export function changedFiles(base) {
  const output = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    cwd: root,
    encoding: "utf8",
  });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function main() {
  const actor = argument("--actor", process.env.GITHUB_ACTOR ?? null);
  if (!actor) {
    console.error("collaboration: 缺少 --actor（或 GITHUB_ACTOR）");
    return 2;
  }
  const explicit = argument("--files");
  let files;
  try {
    files = explicit
      ? explicit.split(",").map((file) => file.trim())
      : changedFiles(argument("--base", "origin/main"));
  } catch (error) {
    console.error(`collaboration: 无法计算改动文件：${error.message}`);
    return 2;
  }
  const { errors, notices } = guardContribution({ actor, files });
  for (const notice of notices) console.log(`collaboration: ${notice}`);
  for (const error of errors) console.error(`collaboration: ${error}`);
  if (errors.length) return 1;
  console.log(`collaboration: ${actor} 可以改这 ${files.length} 个文件`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
