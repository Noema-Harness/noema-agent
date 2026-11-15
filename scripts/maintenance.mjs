import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveGitExecutable } from "./git-exec.mjs";

// 文档与计划不是事后补写的报告，而是交付门槛的一部分：交付前、提交前都必须
// 通过这里。`docs` 校验五份权威文档与代码事实同步，`plan` 校验 OpenSpec 只有
// 一个活动变更且任务清单仍是活的，`precommit` 在代码提交时同时要求计划/状态
// 更新并阻止未决的用户决策被顺手实现，`milestone` 校验一次里程碑的四个条件。
//
// 入口：`npm run docs:check`、`npm run plan:check`、`npm run milestone:check`、
// `.githooks/pre-commit`。
// 不变量：一个事实一个权威源；待用户决定的问题未答前不实现相关产品行为。
// 三层分工：PRODUCT.md=产品定义（不承载计划）；OpenSpec change=本轮增量与执行约定；
// GitHub Project=唯一的计划源（能力、排序、阶段、状态、验收口径都在卡片上）。
// 计划不在常驻文档里镜像，所以本脚本只校验 change 指向卡片的链接格式，不校验看板状态。
//
// 边界不靠关键字穷举：每份文档头部的 `Does not own` 写明它不拥有什么，写错内容属于
// 评审问题；这里只校验机械可判的事实（文档集合、三行头、版本/基线、钩子、引用存在）。

const DOCS_PREFIX = "docs/";
const CODE_PREFIXES = ["apps/desktop/src/", "scripts/"];
const PRODUCT_CODE_PREFIX = "apps/desktop/src/";
const PLAN_PREFIXES = ["docs/", "openspec/changes/"];
const ARCHIVE_PREFIX = "openspec/changes/archive/";
const DECISION_HEADING = "## 待用户决定";
const MAX_PENDING_DECISIONS = 3;
const USER_TASK_PREFIX = "[用户]";
const USER_CONFIRMATION = /用户确认：\d{4}-\d{2}-\d{2}/u;
const PLAN_LINK = /^Plan:\s*https:\/\/github\.com\/\S+/mu;
const GOVERNANCE_PLAN = /^Plan:\s*none\b/mu;

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

// 本地日期（YYYY-MM-DD）。交付日期按用户所在时区算，不能用 UTC 日期。
export function localToday(now) {
  const date = now ?? new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// 取 markdown 中某个二级标题下的正文，直到下一个二级标题。
function sectionBody(text, heading) {
  if (text === null) return null;
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## /u.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

// 变更指向哪里：卡片链接=推进某张能力卡；none=纯机制/文档治理；null=没写清楚。
export function planTarget(proposalText) {
  if (GOVERNANCE_PLAN.test(proposalText ?? "")) return "governance";
  if (PLAN_LINK.test(proposalText ?? "")) return "card";
  return null;
}

export function pendingDecisions(designText) {
  const body = sectionBody(designText, DECISION_HEADING);
  if (body === null) return null;
  return [...body.matchAll(/^\s*- \[ \]\s*(.+)$/gmu)].map((match) => match[1].trim());
}

export function activeChanges(root) {
  const changesRoot = path.join(root, "openspec", "changes");
  return directoryNames(changesRoot).filter((name) => name !== "archive");
}

// `git` is injected so tests can run without a repository.
export function checkDocuments(root, git, options = {}) {
  const errors = [];
  const notices = [];
  const inCi = options.ci ?? Boolean(process.env.CI);
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
    errors.push(
      `版本不一致：package.json ${packageVersion}，apps/desktop/package.json ${desktopVersion}`,
    );
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

  const product = readText(path.join(root, "docs", "PRODUCT.md"));
  if (product === null) {
    errors.push("缺少权威文档：docs/PRODUCT.md");
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

  const openspecConfig = readText(path.join(root, "openspec", "config.yaml"));
  if (openspecConfig === null) {
    errors.push("缺少 openspec/config.yaml");
  } else {
    for (const match of openspecConfig.matchAll(/docs\/[A-Za-z0-9_/-]+\.md/gu)) {
      if (!fs.existsSync(path.join(root, match[0]))) {
        errors.push(
          `openspec/config.yaml 引用了不存在的文档 ${match[0]}；文档已合并或删除，配置要跟着改`,
        );
      }
    }
  }
  return { errors, notices };
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

export function skipSpecs(root, change) {
  const config = readText(path.join(root, "openspec", "changes", change, ".openspec.yaml")) ?? "";
  return /skip_specs:\s*true/u.test(config);
}

// 任务里的 `[用户]` 行必须由用户确认才能勾选；这是“测试分工”的落地点：
// 视觉、语气、交互手感这类判断留在用户那边，我只负责准备证据。
function checkUserAcceptanceTasks(change, tasksText, errors) {
  if (tasksText === null) return [];
  const userTasks = [];
  for (const line of tasksText.split(/\r?\n/u)) {
    const match = /^\s*- \[( |x)\]\s*\[用户\](.*)$/u.exec(line);
    if (!match) continue;
    userTasks.push(match[2].trim());
    if (match[1] === "x" && !USER_CONFIRMATION.test(match[2])) {
      errors.push(
        `活动变更 ${change} 的用户验收项已勾选但缺少「（用户确认：YYYY-MM-DD）」：${match[2].trim()}；只有用户确认后才勾`,
      );
    }
  }
  return userTasks;
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
  let remaining = null;
  let planKind = null;
  if (change) {
    const directory = path.join(root, "openspec", "changes", change);
    for (const name of ["proposal.md", "design.md", "tasks.md"]) {
      if (!fs.existsSync(path.join(directory, name))) {
        errors.push(`活动变更 ${change} 缺少 ${name}`);
      }
    }

    const proposal = readText(path.join(directory, "proposal.md"));
    planKind = planTarget(proposal);
    if (planKind === null) {
      errors.push(
        `活动变更 ${change} 的 proposal.md 缺少「Plan: <卡片链接>」或「Plan: none」：规划只在 GitHub Project 一处，变更必须说清推进哪张卡；纯机制/文档治理写 none`,
      );
    } else if (planKind === "governance") {
      notices.push(planKindNotice(change));
    }

    const tasks = readText(path.join(directory, "tasks.md"));
    if (tasks !== null) {
      const open = countTasks(tasks, "open");
      remaining = open;
      if (open === 0) {
        errors.push(
          `活动变更 ${change} 的全部任务已完成：先跑 npm run milestone:check，归档该变更后再开新变更，否则计划不再指导开发`,
        );
      }
      notices.push(`活动变更 ${change}：${countTasks(tasks, "done")} 完成 / ${open} 未完成`);
      const userTasks = checkUserAcceptanceTasks(change, tasks, errors);
      if (userTasks.length) {
        notices.push(`用户验收项 ${userTasks.length} 项（未确认前不算交付）`);
      }
    }
    const design = readText(path.join(directory, "design.md"));
    if (design !== null) {
      const decisions = pendingDecisions(design);
      if (decisions === null) {
        errors.push(
          `活动变更 ${change} 的 design.md 缺少「${DECISION_HEADING}」小节；未定问题必须在这里列出`,
        );
      } else {
        pending = decisions;
        if (decisions.length > MAX_PENDING_DECISIONS) {
          errors.push(
            `待用户决定 ${decisions.length} 项，超过每轮 ${MAX_PENDING_DECISIONS} 项的上限：超出的实现细节由维护者决定并写进「实现选择」，不要把决策成本转回用户`,
          );
        }
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
        const output = `${error.stdout ?? ""}${error.stderr ?? ""}`
          .trim()
          .split(/\r?\n/u)
          .slice(-8);
        errors.push(`openspec validate --all --strict 未通过：\n${output.join("\n")}`);
      }
    }
  }
  return { errors, notices, change, pending, remaining, planKind };
}

// 里程碑不是“感觉做得差不多了”，而是四个可检查的条件同时成立：
// 任务全完成（含用户验收确认）、没有未决决策、规格增量存在或有理由跳过、
// STATUS 更新到今天。全量 check 由这里提示，而不是靠即时判断。
export function checkMilestone(root, options = {}) {
  const errors = [];
  const notices = [];
  const git = options.git ?? ((args) => runGit(root, args));
  const today = options.today ?? localToday();
  const active = activeChanges(root);
  if (active.length !== 1) {
    errors.push(`里程碑要求恰好 1 个活动变更，当前 ${active.length} 个`);
    return { errors, notices };
  }
  const change = active[0];
  const directory = path.join(root, "openspec", "changes", change);
  const tasks = readText(path.join(directory, "tasks.md"));
  if (tasks === null) {
    errors.push(`活动变更 ${change} 缺少 tasks.md`);
  } else {
    const open = countTasks(tasks, "open");
    if (open > 0) errors.push(`还有 ${open} 个任务未完成，不能归档为里程碑`);
    for (const line of tasks.split(/\r?\n/u)) {
      const match = /^\s*- \[x\]\s*\[用户\](.*)$/u.exec(line);
      if (match && !USER_CONFIRMATION.test(match[1])) {
        errors.push(`用户验收项缺少「（用户确认：YYYY-MM-DD）」：${match[1].trim()}`);
      }
    }
  }
  const design = readText(path.join(directory, "design.md"));
  const decisions = design === null ? null : pendingDecisions(design);
  if (design !== null && decisions === null) {
    errors.push(`活动变更 ${change} 的 design.md 缺少「${DECISION_HEADING}」`);
  }
  if (decisions?.length) {
    errors.push(`还有 ${decisions.length} 项待用户决定，里程碑不能通过：${decisions.join("；")}`);
  }
  const specs = markdownFilesUnder(path.join(directory, "specs"));
  if (specs.length === 0) {
    if (skipSpecs(root, change)) {
      notices.push("本变更为纯文档/治理变更（skip_specs: true），不要求规格增量");
    } else {
      errors.push(`活动变更 ${change} 没有 specs 增量：行为变更必须写规格 delta 后再归档`);
    }
  } else {
    notices.push(`规格增量 ${specs.length} 个文件，归档时合并进 openspec/specs`);
  }
  const status = readText(path.join(root, "docs", "STATUS.md")) ?? "";
  const updated = /最后更新：(\d{4}-\d{2}-\d{2})/u.exec(status)?.[1];
  if (updated !== today) {
    errors.push(
      `docs/STATUS.md 最后更新是 ${updated ?? "缺失"}，今天交付必须更新 STATUS 的版本/基线/验证/下一步`,
    );
  }
  if (!git(["status", "--porcelain"]).text.trim() && !options.allowUnstaged) {
    notices.push("工作树干净：归档前确认 npm run check 已通过，并把计数写进 STATUS");
  }
  notices.push("下一步：npm run check 全绿 → 归档变更（合并规格增量）→ 更新 STATUS → 开下一个变更");
  return { errors, notices };
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
      (name) =>
        !name.startsWith(ARCHIVE_PREFIX) && PLAN_PREFIXES.some((prefix) => name.startsWith(prefix)),
    );
    if (!planned.length) {
      errors.push(
        "代码改动必须同时更新 docs/ 或 openspec/changes/ 里的计划与状态：先勾任务或记录证据，再提交",
      );
    }
    const productCode = code.filter((name) => name.startsWith(PRODUCT_CODE_PREFIX));
    if (plan.pending.length && productCode.length) {
      errors.push(
        `活动变更仍有待用户决定的问题，相关产品行为不能实现：${plan.pending.join("；")}；工具与文档改动不受此限`,
      );
    }
    if (productCode.length && plan.planKind === "governance") {
      errors.push(
        `活动变更 ${plan.change} 写的是 Plan: none（治理变更），但这次提交含产品代码：产品行为必须有对应卡片与规格增量`,
      );
    }
    if (productCode.length && plan.change && skipSpecs(root, plan.change)) {
      errors.push(
        `活动变更 ${plan.change} 标记了 skip_specs，但这次提交含产品代码：行为变更必须在变更里写 specs 增量`,
      );
    }
    if (!productCode.length && plan.pending.length) {
      plan.notices.push(`工具/治理改动不受未决产品决策阻塞：${plan.pending.join("；")}`);
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
  return result.text
    .split("\u0000")
    .filter(Boolean)
    .map((name) => name.replaceAll("\\", "/"));
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
    if (command === "docs")
      return report(
        "docs-check",
        checkDocuments(root, (args) => runGit(root, args)),
      );
    if (command === "plan") return report("plan-check", checkPlan(root));
    if (command === "milestone") return report("milestone-check", checkMilestone(root));
    if (command === "precommit") return report("precommit-check", checkPrecommit(root));
    throw new Error("Usage: node scripts/maintenance.mjs docs|plan|milestone|precommit");
  })();
  process.exit(output);
}

function planKindNotice(change) {
  return `活动变更 ${change} 是治理变更（Plan: none）：不对应能力卡，不能提交产品代码`;
}
