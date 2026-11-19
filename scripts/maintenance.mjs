// 提交门与文档门的全部机械判定。此文件只回答「生成物是否自洽」，
// 不承载治理规则文本（规则在 governance/，命令在 docs/OPERATIONS.md）。
//
// 入口：`npm run docs:check`、`npm run check`（里程碑）、`.githooks/pre-commit`。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openFindings, upgradeState, validateState } from "../governance/core/state.mjs";
import { resolveGitExecutable } from "./git-exec.mjs";
import { checkSkill } from "./skill-sync.mjs";

const DOCS_PREFIX = "docs/";
const PRODUCT_CODE_PREFIX = "apps/desktop/src/";
const GOVERNANCE_WORDS = [
  "治理",
  "门槛",
  "门禁",
  "条目",
  "决议",
  "阶段",
  "待裁",
  "批次",
  "开工清单",
  "验收项",
];

export function localToday(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function markdownFilesUnder(directory) {
  const files = [];
  const walk = (current) => {
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) files.push(full);
    }
  };
  walk(directory);
  return files;
}

function runGit(root, args) {
  try {
    const text = execFileSync(resolveGitExecutable(), args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true, text };
  } catch (error) {
    return { ok: false, text: error?.stdout ?? "" };
  }
}

function stagedPaths(root, git) {
  const result = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  if (!result.ok) return [];
  return result.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replaceAll("\\", "/"));
}

/** docs/ 新增内容里出现治理词时只提示：治理规则应当写在 governance/，别回流。 */
export function findGovernanceWordsInDocs(diffText) {
  const hits = [];
  let file = "";
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    if (!file.startsWith(DOCS_PREFIX) || file === "docs/DECISIONS.md") continue;
    const word = GOVERNANCE_WORDS.find((candidate) => line.includes(candidate));
    if (word) hits.push({ file, word });
  }
  return hits;
}

/** 内核是通用层：出现项目专名或仓库路径就说明分层失败。 */
export function findCoreBoundaryProblems(files) {
  const problems = [];
  for (const { name, text } of files) {
    const rules = [
      { pattern: /\bnoema\b/iu, why: "Noema 专名" },
      { pattern: /apps[/\\]desktop/u, why: "仓库路径 apps/desktop" },
      { pattern: /(^|[^\w])docs[/\\]/u, why: "仓库路径 docs/" },
      { pattern: /\.work[/\\]/u, why: "仓库路径 .work/" },
    ];
    text.split("\n").forEach((line, index) => {
      for (const rule of rules) {
        if (rule.pattern.test(line)) problems.push({ name, line: index + 1, why: rule.why });
      }
    });
  }
  return problems;
}

function governanceCoreFiles(root) {
  const dir = path.join(root, "governance", "core");
  let names = [];
  try {
    names = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"));
  } catch {
    return [];
  }
  return names.map((name) => ({
    name: path.posix.join("governance", "core", name),
    text: readText(path.join(dir, name)) ?? "",
  }));
}

/** 「用户预期会不会变」判不了机器，但「改的是产品行为、还是测试/文档」判得了。 */
export function changeScope(staged) {
  if (!staged.length) return null;
  const behavior = staged.filter((name) => name.startsWith(PRODUCT_CODE_PREFIX));
  const tooling = staged.filter(
    (name) => name.startsWith("scripts/") || name.startsWith("governance/"),
  );
  const rest = staged.filter((name) => !behavior.includes(name) && !tooling.includes(name));
  const parts = [];
  if (behavior.length) parts.push(`产品行为 ${behavior.length} 个文件`);
  if (tooling.length) parts.push(`治理工具 ${tooling.length} 个文件`);
  if (rest.length) parts.push(`文档/测试/其他 ${rest.length} 个文件`);
  const scope = behavior.length ? "行为路径" : "自由执行路径";
  const rule = behavior.length
    ? "先在会话里把范围写定（state -- scope），再改；改完回验收态对照范围"
    : "不需要范围与验收，过提交门即可";
  return { scope, notice: `本次改动（${parts.join("、")}）→ ${scope}：${rule}` };
}

// 状态数据是治理的唯一真相：机器每次过门都真的读一遍，不只信任文件存在。
export function checkState(root) {
  const errors = [];
  const raw = readJson(path.join(root, "governance", "data", "state.json"));
  if (raw === null) {
    errors.push("缺少 governance/data/state.json：先用 npm run state 记录当前状态");
    return { errors, state: null };
  }
  let doc;
  try {
    doc = upgradeState(raw);
  } catch (error) {
    errors.push(`governance/data/state.json 无法升级：${error.message}`);
    return { errors, state: null };
  }
  for (const problem of validateState(doc)) errors.push(`状态数据：${problem}`);
  return { errors, state: doc };
}

export function checkDocuments(root, git) {
  const errors = [];
  const notices = [];
  const config = readJson(path.join(root, "scripts", "workspace.config.json")) ?? {};
  const registered = config.currentDocuments ?? [];
  const inCi = Boolean(process.env.CI);
  for (const name of registered) {
    const text = readText(path.join(root, name));
    if (text === null) {
      errors.push(`缺少登记的文档：${name}`);
      continue;
    }
    if (!name.startsWith(DOCS_PREFIX)) continue;
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

  const docDiff = git(["diff", "--unified=0", "HEAD", "--", "docs"]);
  if (docDiff.ok) {
    for (const hit of findGovernanceWordsInDocs(docDiff.text).slice(0, 3)) {
      notices.push(
        `${hit.file} 新增内容出现治理词「${hit.word}」：确认它只是指针；治理规则写进 governance/`,
      );
    }
  }

  const stateCheck = checkState(root);
  errors.push(...stateCheck.errors);

  const coreProblems = findCoreBoundaryProblems(governanceCoreFiles(root));
  for (const problem of coreProblems.slice(0, 5)) {
    errors.push(
      `${problem.name}:${problem.line} 出现${problem.why}：内核是通用层，项目路径与专名放适配层（scripts/）`,
    );
  }

  const packageVersion = readJson(path.join(root, "package.json"))?.version;
  const desktopVersion = readJson(path.join(root, "apps", "desktop", "package.json"))?.version;
  if (packageVersion !== desktopVersion) {
    errors.push(
      `版本不一致：package.json ${packageVersion}，apps/desktop/package.json ${desktopVersion}`,
    );
  }
  const status = readText(path.join(root, "docs", "STATUS.md")) ?? "";
  const recordedVersion = /源码版本：`([^`]+)`/u.exec(status)?.[1];
  if (!recordedVersion) errors.push("docs/STATUS.md 缺少「源码版本：`x.y.z`」");
  else if (recordedVersion !== packageVersion) {
    errors.push(
      `docs/STATUS.md 源码版本 ${recordedVersion} 与 package.json ${packageVersion} 不一致`,
    );
  }
  const baseline = /当前源码基线：`([0-9a-f]{7,40})/u.exec(status)?.[1];
  if (!baseline) errors.push("docs/STATUS.md 缺少「当前源码基线：`<sha>`」");
  else if (!git(["merge-base", "--is-ancestor", baseline, "HEAD"]).ok) {
    errors.push(`docs/STATUS.md 基线 ${baseline} 不是 HEAD 的祖先：基线写错或仓库被重写`);
  }
  if (!/最后更新：\d{4}-\d{2}-\d{2}/u.test(status)) {
    errors.push("docs/STATUS.md 缺少「最后更新：YYYY-MM-DD」");
  }

  if (inCi) {
    notices.push("CI 环境不检查本地提交钩子：协作方不需要安装 core.hooksPath");
  } else {
    const hooksPath = git(["config", "--get", "core.hooksPath"]).text.trim();
    if (hooksPath !== ".githooks") {
      errors.push(
        `git core.hooksPath 是「${hooksPath || "(未设置)"}」，文档门槛未安装；执行：git config core.hooksPath .githooks`,
      );
    }
  }
  if (!fs.existsSync(path.join(root, ".githooks", "pre-commit"))) {
    errors.push("缺少 .githooks/pre-commit：提交前门槛被删除");
  }
  const skill = checkSkill(root, { ci: inCi });
  errors.push(...skill.errors);
  notices.push(...skill.notices);

  const documentedScripts = new Set(
    Object.keys(readJson(path.join(root, "package.json"))?.scripts ?? {}),
  );
  const documented = ["AGENTS.md", "README.md", "CONTRIBUTING.md", "docs/OPERATIONS.md"];
  const workflowDir = path.join(root, ".github", "workflows");
  if (fs.existsSync(workflowDir)) {
    for (const entry of fs.readdirSync(workflowDir)) {
      if (entry.endsWith(".yml") || entry.endsWith(".yaml")) {
        documented.push(path.posix.join(".github", "workflows", entry));
      }
    }
  }
  for (const name of documented) {
    const text = readText(path.join(root, name));
    if (text === null) continue;
    for (const match of text.matchAll(/(?<![a-z])npm run ([a-z][a-z0-9:_-]*)/gu)) {
      const script = match[1];
      if (documentedScripts.has(script)) continue;
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      const lineEnd = text.indexOf("\n", match.index);
      const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      if (line.includes("--workspace")) continue;
      errors.push(`${name} 引用了不存在的脚本 npm run ${script}：改 package.json 时同步文档与 CI`);
    }
  }
  return { errors, notices };
}

export function checkPrecommit(root, options = {}) {
  const git = options.git ?? ((args) => runGit(root, args));
  const docs = checkDocuments(root, git);
  const errors = [...docs.errors];
  const notices = [...docs.notices];
  const staged = options.stagedPaths ?? stagedPaths(root, git);
  const code = staged.filter((name) => name.startsWith(PRODUCT_CODE_PREFIX));
  if (code.length) {
    const state = checkState(root).state;
    if (!state) {
      errors.push("产品代码改动需要一个可读的状态文件：npm run state");
    } else if (!state.work?.scope) {
      errors.push(
        `产品行为 ${code.length} 个文件没有范围：先写 npm run state -- scope "这次做什么"（小修用 --kind 修复），再提交`,
      );
    } else {
      notices.push(
        `产品行为 ${code.length} 个文件，落在范围「${state.work.scope.text}」内（${state.work.scope.kind}）`,
      );
    }
  }
  const scope = changeScope(staged);
  if (scope) notices.unshift(scope.notice);
  return { errors, notices, staged };
}

export function runMaintenance(argv, root = process.cwd()) {
  const git = (args) => runGit(root, args);
  const [command] = argv;
  const report = (result, label) => {
    for (const notice of result.notices ?? []) console.log(`notice: ${notice}`);
    if (result.errors.length > 0) {
      for (const error of result.errors) console.error(`error: ${error}`);
      console.error(`${label}: 失败（${result.errors.length} 项）`);
      return 1;
    }
    console.log(`${label}: OK`);
    return 0;
  };
  if (command === "docs") return report(checkDocuments(root, git), "docs-check");
  if (command === "precommit") return report(checkPrecommit(root), "precommit-check");
  console.error("用法：maintenance.mjs <docs|precommit>");
  return 2;
}

if (process.argv[1] && process.argv[1].endsWith("maintenance.mjs")) {
  process.exitCode = runMaintenance(process.argv.slice(2));
}
