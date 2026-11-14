import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveGitExecutable } from "./git-exec.mjs";

// 文档与计划不是事后补写的报告，而是交付门槛的一部分：交付前、提交前都必须
// 通过这里。`docs` 校验五份权威文档与代码事实同步，`plan` 校验 OpenSpec 只有
// 一个活动变更且任务清单仍是活的，`precommit` 在代码提交时同时要求计划/状态
// 更新并禁止绕过未决的用户决策。
//
// 入口：`npm run docs:check`、`npm run plan:check`、`.githooks/pre-commit`。
// 不变量：一个事实一个权威源；待用户决定的问题未答前不改代码。

const DOCS_PREFIX = "docs/";
const CODE_PREFIXES = ["apps/desktop/src/", "scripts/"];
const PLAN_PREFIXES = ["docs/", "openspec/changes/"];
const ARCHIVE_PREFIX = "openspec/changes/archive/";
const DECISION_HEADING = "## 待用户决定";

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function readJson(file) {
  const text = readText(file);
  return text ? JSON.parse(text) : null;
}

function directoryNames(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function markdownFilesUnder(directory) {
  const files = [];
  const walk = (current) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(target);
      else if (entry.name.endsWith(".md")) files.push(target);
    }
  };
  walk(directory);
  return files;
}

function countTasks(text, mark) {
  const pattern = mark === "done" ? /^\s*- \[x\]/gimu : /^\s*- \[ \]/gmu;
  return [...text.matchAll(pattern)].length;
}

export function pendingDecisions(designText) {
  const lines = designText.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === DECISION_HEADING);
  if (start === -1) return null;
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## /u.test(line)) break;
    const match = /^\s*- \[ \]\s*(.+)$/u.exec(line);
    if (match) items.push(match[1].trim());
  }
  return items;
}

export function activeChanges(root) {
  const changesRoot = path.join(root, "openspec", "changes");
  return directoryNames(changesRoot).filter((name) => name !== "archive");
}

// `git` is injected so tests can run without a repository.
export function checkDocuments(root, git) {
  const errors = [];
  const config = readJson(path.join(root, ".codex", "workspace.json")) ?? {};
  const registered = (config.currentDocuments ?? []).map((entry) => entry.path);
  const authoritative = registered.filter((name) => name.startsWith(DOCS_PREFIX));
  if (authoritative.length !== 5) {
    errors.push(
      `docs/ 权威文档应为 5 份，当前登记 ${authoritative.length} 份；改 .codex/workspace.json 时同时改 AGENTS.md 文档表`,
    );
  }
  for (const name of authoritative) {
    const text = readText(path.join(root, name));
    if (text === null) {
      errors.push(`缺少权威文档：${name}`);
      continue;
    }
    for (const header of ["Authority:", "Update when:", "Does not own:"]) {
      if (!new RegExp(`^${header}`, "mu").test(text)) {
        errors.push(`${name} 缺少文档头 ${header}（所有权/更新条件/不拥有什么）`);
      }
    }
  }
  const allowed = new Set(registered);
  for (const file of markdownFilesUnder(path.join(root, "docs"))) {
    const name = path.relative(root, file).replaceAll("\\", "/");
    if (!allowed.has(name)) {
      errors.push(`docs/ 出现未登记文档 ${name}；一个事实一个权威源，合并或删除后再提交`);
    }
  }

  const packageVersion = readJson(path.join(root, "package.json"))?.version;
  const desktopVersion = readJson(path.join(root, "apps", "desktop", "package.json"))?.version;
  if (packageVersion !== desktopVersion) {
    errors.push(`版本不一致：package.json ${packageVersion}，apps/desktop/package.json ${desktopVersion}`);
  }
  const status = readText(path.join(root, "docs", "STATUS.md")) ?? "";
  const recordedVersion = /源码版本：`([^`]+)`/u.exec(status)?.[1];
  if (!recordedVersion) {
    errors.push("docs/STATUS.md 缺少「源码版本：`x.y.z`」");
  } else if (recordedVersion !== packageVersion) {
    errors.push(
      `docs/STATUS.md 源码版本 ${recordedVersion} 与 package.json ${packageVersion} 不一致：交付前先更新 STATUS 的版本、基线和证据`,
    );
  }
  const baseline = /当前源码基线：`([0-9a-f]{7,40})/u.exec(status)?.[1];
  if (!baseline) {
    errors.push("docs/STATUS.md 缺少「当前源码基线：`<sha>`」");
  } else if (!git(["merge-base", "--is-ancestor", baseline, "HEAD"]).ok) {
    errors.push(`docs/STATUS.md 基线 ${baseline} 不是 HEAD 的祖先：基线写错或仓库被重写`);
  }
  if (!/最后更新：\d{4}-\d{2}-\d{2}/u.test(status)) {
    errors.push("docs/STATUS.md 缺少「最后更新：YYYY-MM-DD」");
  }

  const hooksPath = git(["config", "--get", "core.hooksPath"]).text.trim();
  if (hooksPath !== ".githooks") {
    errors.push(`git core.hooksPath 是「${hooksPath || "(未设置)"}」，文档门槛未安装；执行：git config core.hooksPath .githooks`);
  }
  if (!fs.existsSync(path.join(root, ".githooks", "pre-commit"))) {
    errors.push("缺少 .githooks/pre-commit：提交前门槛被删除");
  }

  const openspecConfig = readText(path.join(root, "openspec", "config.yaml"));
  if (openspecConfig === null) {
    errors.push("缺少 openspec/config.yaml");
  } else {
    for (const match of openspecConfig.matchAll(/docs\/[A-Za-z0-9_/-]+\.md/gu)) {
      if (!fs.existsSync(path.join(root, match[0]))) {
        errors.push(`openspec/config.yaml 引用了不存在的文档 ${match[0]}；文档已合并或删除，配置要跟着改`);
      }
    }
  }
  return { errors };
}

function resolveOpenspecBinary(env) {
  if (env.OPENSPEC_BIN && fs.existsSync(env.OPENSPEC_BIN)) return env.OPENSPEC_BIN;
  const candidates = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "openspec", "openspec.exe"),
    env.APPDATA && path.join(env.APPDATA, "npm", "openspec.cmd"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const listed = execFileSync("where.exe", ["openspec"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    const found = listed
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line && fs.existsSync(line));
    if (found) return found;
  } catch {
    // No CLI on PATH; plan checks still run without spec validation.
  }
  return null;
}

export function checkPlan(root, options = {}) {
  const errors = [];
  const notices = [];
  const active = activeChanges(root);
  if (active.length > 1) {
    errors.push(
      `活动 OpenSpec 变更必须至多 1 个，当前 ${active.length} 个：${active.join(", ")}；结束的变更移入 openspec/changes/archive/，同一时间只推进一个阶段`,
    );
  }
  if (active.length === 0) {
    notices.push("当前没有活动变更：下一轮开始前先在 openspec/changes/ 立项");
  }
  const change = active[0];
  let pending = [];
  if (change) {
    const directory = path.join(root, "openspec", "changes", change);
    for (const name of ["proposal.md", "design.md", "tasks.md"]) {
      if (!fs.existsSync(path.join(directory, name))) {
        errors.push(`活动变更 ${change} 缺少 ${name}`);
      }
    }
    const tasks = readText(path.join(directory, "tasks.md"));
    if (tasks !== null) {
      const open = countTasks(tasks, "open");
      if (open === 0) {
        errors.push(
          `活动变更 ${change} 的全部任务已完成：归档该变更后再开新变更，否则计划不再指导开发`,
        );
      }
      notices.push(`活动变更 ${change}：${countTasks(tasks, "done")} 完成 / ${open} 未完成`);
    }
    const design = readText(path.join(directory, "design.md"));
    if (design !== null) {
      const decisions = pendingDecisions(design);
      if (decisions === null) {
        errors.push(`活动变更 ${change} 的 design.md 缺少「${DECISION_HEADING}」小节；未定问题必须在这里列出`);
      } else {
        pending = decisions;
        notices.push(
          decisions.length
            ? `待用户决定 ${decisions.length} 项：${decisions.join("；")}`
            : "待用户决定：无",
        );
      }
    }
  }

  if (!options.skipSpecValidation) {
    const binary = resolveOpenspecBinary(process.env);
    if (!binary) {
      notices.push("未找到 openspec CLI，跳过规格校验；安装后本门槛自动生效");
    } else {
      try {
        execFileSync(binary, ["validate", "--all", "--strict"], {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
          timeout: 120000,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim().split(/\r?\n/u).slice(-8);
        errors.push(`openspec validate --all --strict 未通过：\n${output.join("\n")}`);
      }
    }
  }
  return { errors, notices, change, pending };
}

export function checkPrecommit(root, options = {}) {
  const git = options.git ?? ((args) => runGit(root, args));
  const docs = checkDocuments(root, git);
  const plan = checkPlan(root, { skipSpecValidation: true });
  const errors = [...docs.errors, ...plan.errors];
  const staged = options.stagedPaths ?? stagedPaths(root, git);
  const code = staged.filter((name) => CODE_PREFIXES.some((prefix) => name.startsWith(prefix)));
  if (code.length) {
    const planned = staged.filter(
      (name) => !name.startsWith(ARCHIVE_PREFIX) && PLAN_PREFIXES.some((prefix) => name.startsWith(prefix)),
    );
    if (!planned.length) {
      errors.push(
        "代码改动必须同时更新 docs/ 或 openspec/changes/ 里的计划与状态：先勾任务或记录证据，再提交",
      );
    }
    if (plan.pending.length) {
      errors.push(`活动变更仍有待用户决定的问题，不能提交代码：${plan.pending.join("；")}`);
    }
  }
  return { errors, notices: plan.notices, staged };
}

function runGit(root, args) {
  try {
    const text = execFileSync(resolveGitExecutable(), args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, text };
  } catch (error) {
    return { ok: false, text: String(error.stdout ?? "") };
  }
}

function stagedPaths(root, git) {
  const result = git(["diff", "--cached", "--name-only", "-z"]);
  return result.text.split("\u0000").filter(Boolean).map((name) => name.replaceAll("\\", "/"));
}

function report(label, result) {
  for (const notice of result.notices ?? []) console.log(`${label} · ${notice}`);
  if (result.errors.length) {
    console.error(`${label}: FAILED (${result.errors.length})`);
    for (const error of result.errors) console.error(`  - ${error}`);
    return 1;
  }
  console.log(`${label}: OK`);
  return 0;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
  const command = process.argv[2] ?? "docs";
  const output = (() => {
    if (command === "docs") return report("docs-check", checkDocuments(root, (args) => runGit(root, args)));
    if (command === "plan") return report("plan-check", checkPlan(root));
    if (command === "precommit") return report("precommit-check", checkPrecommit(root));
    throw new Error("Usage: node scripts/maintenance.mjs docs|plan|precommit");
  })();
  process.exit(output);
}
