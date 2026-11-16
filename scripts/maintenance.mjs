import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveGitExecutable } from "./git-exec.mjs";
import { checkSkill } from "./skill-sync.mjs";

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
const TOOLING_PLAN_PREFIXES = ["docs/", "openspec/changes/", "AGENTS.md"];
const ARCHIVE_PREFIX = "openspec/changes/archive/";
const DECISION_HEADING = "## 用户决策";
const FACT_HEADING = "## 事实影响";
const FACT_FROM = "2026-11-16";
const FACT_KINDS = ["行为", "结构", "取舍", "仅执行"];
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

// design 的「事实影响」：类别决定这次改动属于哪类事实，配对校验靠它。
function factImpact(designText) {
  const body = designText === null ? null : sectionBody(designText, FACT_HEADING);
  if (body === null) return null;
  const kind = /^-[ \t]*类别[：:][ \t]*(\S+)/mu.exec(body)?.[1] ?? null;
  const basis = /^-[ \t]*依据[：:][ \t]*(\S.*)$/mu.exec(body)?.[1]?.trim() ?? null;
  return { kind, basis };
}

// 2026-11-16 起的新变更必须写事实影响；旧变更在归档时不再补。
function factsRequired(root, change) {
  const meta = readText(path.join(root, "openspec", "changes", change, ".openspec.yaml")) ?? "";
  const created = /created:\s*(\d{4}-\d{2}-\d{2})/u.exec(meta)?.[1] ?? "";
  return created >= FACT_FROM;
}

function checkFactSection(root, change, design, errors) {
  if (design === null || !factsRequired(root, change)) return;
  const impact = factImpact(design);
  if (impact === null) {
    errors.push(
      `活动变更 ${change} 的 design.md 缺少「${FACT_HEADING}」：写 - 类别：${FACT_KINDS.join("|")} 和 - 依据：为什么属于这一类`,
    );
    return;
  }
  if (!FACT_KINDS.includes(impact.kind ?? "")) {
    errors.push(
      `活动变更 ${change} 的「${FACT_HEADING}」类别必须是 ${FACT_KINDS.join("/")}，当前「${impact.kind ?? "空"}」`,
    );
  }
  if (!impact.basis) {
    errors.push(
      `活动变更 ${change} 的「${FACT_HEADING}」缺少 - 依据：写清这次改动为什么属于该类别`,
    );
  }
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
  // 两种写法都算：`- [ ] 问题` 与 `- 问题`；不要要求作者记住一种格式，否则门只会拦格式。
  return [...body.matchAll(/^-[ \t]+(?:\[[ xX]\][ \t]+)?(.+)$/gmu)].map((match) => match[1].trim());
}

export function activeChanges(root) {
  const changesRoot = path.join(root, "openspec", "changes");
  return directoryNames(changesRoot).filter((name) => name !== "archive");
}

// 决定编号 = 日期 + 短名：并行分支各自产出，不抢全局序号（D-20261115-decision-ids）。
// `D-0xx` 是旧编号，保留历史引用，不再新增。
// 标题带阶段标记与可选 GitHub 入口：`## 🔍 [#151](url) D-… 标题`——扫一眼就知道这条在等谁。
export const ENTRY_STAGE_MARKS = { 决策中: "⏳", 执行中: "🔧", 待验收: "🔍", 已收口: "✅" };
const ENTRY_HEADING =
  /^## (?:([⏳🔧🔍✅])\s+)?(?:\[#(\d+)\]\(([^)]+)\)\s+)?(D-(?:\d{3}|\d{8}-[a-z0-9-]+))(?:\s+(.+))?$/u;

// 产品变更必须写清用户能观察到什么、怎么手测；收口时抄进卡片正文。
const OBSERVABLE_SECTIONS = ["## 用户可观察的改变", "## 手测步骤"];

function sectionHasItems(text, heading) {
  const body = sectionBody(text, heading);
  if (body === null) return false;
  return /^\s*(?:-|\d+\.)\s+\S/mu.test(body);
}

export function decisionEntries(text) {
  const entries = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/u)) {
    const head = ENTRY_HEADING.exec(raw);
    if (head) {
      if (current) entries.push(current);
      const number = /^\d{3}$/u.test(head[4].slice(2)) ? Number(head[4].slice(2)) : null;
      current = {
        id: head[4],
        number,
        issue: head[2] ? Number(head[2]) : null,
        emoji: head[1] ?? null,
        title: (head[5] ?? "").trim(),
        body: [],
      };
      continue;
    }
    if (current) current.body.push(raw);
  }
  if (current) entries.push(current);
  return entries.map((entry) => ({
    id: entry.id,
    number: entry.number,
    issue: entry.issue,
    emoji: entry.emoji,
    title: entry.title,
    body: entry.body.join("\n"),
  }));
}

// 日期编号的条目带阶段；D-0xx 旧条目按历史格式处理，不要求新字段。
export const ENTRY_STAGES = ["决策中", "执行中", "待验收", "已收口"];

export function decisionMeta(entry) {
  const read = (label) => {
    const match = new RegExp(`\\*\\*${label}\\*\\*：\\s*(.+)`, "u").exec(entry.body);
    return match ? match[1].trim() : null;
  };
  const stage = read("阶段");
  if (!stage) return null;
  return {
    stage,
    emoji: entry.emoji ?? null,
    issue: entry.issue ?? null,
    source: read("来源"),
    blocker: read("阻塞"),
    structure: read("结构"),
  };
}

// 验收项是可勾选的清单：`- [ ] 怎么验 — 怎么跑`，用户勾完再运行 `npm run decisions:sync` 收口。
export function acceptanceItems(body) {
  const section = sectionBody(body, "#### 3 验收");
  if (section === null) return [];
  return section
    .split(/\r?\n/u)
    .filter((line) => /^- \[[ xX]\]/u.test(line))
    .map((line) => ({ checked: /^- \[[xX]\]/u.test(line), text: line.slice(5).trim() }));
}

// 需要用户动作的条目：决策中（等确认）与待验收（等验收结论，带勾选进度）。
export function reviewQueue(text) {
  const decide = [];
  const accept = [];
  for (const entry of decisionEntries(text)) {
    const meta = decisionMeta(entry);
    if (!meta) continue;
    const items = acceptanceItems(entry.body);
    const item = {
      id: entry.id,
      title: entry.title,
      blocker: meta.blocker,
      issue: meta.issue,
      checked: items.filter((entry) => entry.checked).length,
      total: items.length,
    };
    if (meta.stage === "决策中") decide.push(item);
    else if (meta.stage === "待验收") accept.push(item);
  }
  return { decide, accept };
}

// Decisions are one review inbox: the stage says where the entry stands, and a dated entry
// newer than LIFECYCLE_FROM must also carry the three sections that show how it got there.
const LIFECYCLE_FROM = "20261116";

export function checkDecisionEntries(text, options = {}) {
  const errors = [];
  const notices = [];
  for (const entry of decisionEntries(text)) {
    const dated = entry.id.replace(/^D-/u, "");
    if (!(/^\d{8}-/u.test(dated) && dated.slice(0, 8) >= LIFECYCLE_FROM)) continue;
    checkDatedEntry(entry, errors, notices);
  }
  return { errors, notices };
}

// A dated entry must answer “where is this round, what blocks it”: stage first, then the
// three sections. 决策中 is the only stage without a decision; every other stage implies the
// user already confirmed, and 已收口 records the date of that confirmation plus ticked items.
function checkDatedEntry(entry, errors, notices = []) {
  const meta = decisionMeta(entry);
  if (!meta) {
    errors.push(`${entry.id} 缺少「**阶段**：…」：阶段决定这一条在等你做什么`);
    return;
  }
  if (!ENTRY_STAGES.includes(meta.stage)) {
    errors.push(`${entry.id} 的阶段「${meta.stage}」不在 ${ENTRY_STAGES.join(" / ")} 里`);
  }
  const expectedMark = ENTRY_STAGE_MARKS[meta.stage];
  if (expectedMark && meta.emoji !== expectedMark) {
    notices.push(
      `${entry.id} 标题的阶段标记是「${meta.emoji ?? "无"}」，阶段字段是「${meta.stage}」：运行 npm run decisions:sync 对齐`,
    );
  }
  const stageLine = entry.body.split("\n").find((line) => line.startsWith("- **阶段**："));
  const firstField = entry.body.split("\n").find((line) => line.startsWith("- **"));
  if (stageLine && firstField && stageLine !== firstField) {
    errors.push(`${entry.id} 的阶段必须是第一条字段：它决定用户要不要处理这一条`);
  }
  for (const heading of ["#### 1 决策", "#### 2 执行", "#### 3 验收"]) {
    if (!entry.body.includes(heading)) errors.push(`${entry.id} 缺少「${heading}」小节`);
  }
  const decision = /^\s*- 决定：/mu.test(entry.body);
  if (meta.stage === "决策中" && decision) {
    errors.push(`${entry.id} 还在决策中，却已经写了「- 决定：」：用户确认后再写结论`);
  }
  if (meta.stage !== "决策中" && !decision) {
    errors.push(`${entry.id} 阶段是${meta.stage}，但「#### 1 决策」里缺少「- 决定：」`);
  }
  const items = acceptanceItems(entry.body);
  const unchecked = items.filter((item) => !item.checked).length;
  if (meta.stage === "待验收") {
    if (items.length === 0) {
      errors.push(`${entry.id} 在等验收，但「#### 3 验收」里没有可勾选的「- [ ] 项」`);
    } else if (unchecked === 0) {
      errors.push(
        `${entry.id} 的验收项已全部勾选，阶段还是待验收：运行 npm run decisions:sync 收口`,
      );
    }
  }
  if (meta.stage === "已收口") {
    if (items.length === 0) {
      errors.push(`${entry.id} 已收口，但「#### 3 验收」里没有「- [x] 项」记录验收依据`);
    } else if (unchecked > 0) {
      errors.push(`${entry.id} 已收口，但还有 ${unchecked} 个验收项没勾选`);
    }
    if (!/- 用户确认：\d{4}-\d{2}-\d{2}/u.test(entry.body)) {
      errors.push(`${entry.id} 已收口，验收末尾应写「- 用户确认：YYYY-MM-DD」`);
    }
  }
}

export function checkDocuments(root, git, options = {}) {
  const errors = [];
  const notices = [];
  const inCi = options.ci ?? Boolean(process.env.CI);
  const config = readJson(path.join(root, "scripts", "workspace.config.json")) ?? {};
  const registered = config.currentDocuments ?? [];
  const authoritative = registered.filter((name) => name.startsWith(DOCS_PREFIX));
  if (authoritative.length !== 5) {
    errors.push(
      `docs/ 权威文档应为 5 份，当前登记 ${authoritative.length} 份；改 scripts/workspace.config.json 时同时改 AGENTS.md 文档表`,
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
  const decisions = readText(path.join(root, "docs", "DECISIONS.md")) ?? "";
  const committedDecisions = git(["show", "HEAD:docs/DECISIONS.md"]);
  const decisionReport = checkDecisionEntries(decisions, {
    today: options.today,
    previous: committedDecisions.ok ? committedDecisions.text : "",
  });
  errors.push(...decisionReport.errors);
  notices.push(...decisionReport.notices);
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
  const skill = checkSkill(root, { ci: inCi });
  errors.push(...skill.errors);
  notices.push(...skill.notices);

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
      errors.push(
        `${name} 引用了不存在的脚本 npm run ${script}：改 package.json 时同步文档与 CI（CI 会先在这里失败）`,
      );
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
  // 本地同时只推进一个变更：手上这个没收口就再立项，等于两份计划并排指导开发。
  // 平台另有一条更硬的规则（checkPlatform）：合并进 main 的树必须没有未收口 change。
  // PR 检查会传入 ownChange（本 PR 自己那一刀）：别的活动变更说明 main 上还有
  // 没归档的计划——不是作者的 bug，但要等维护者收口后才能合并。
  const prMode = Object.hasOwn(options, "ownChange");
  const others = prMode ? active.filter((name) => name !== options.ownChange) : [];
  if (active.length > 1) {
    errors.push(
      `本地同时只能推进 1 个活动 OpenSpec 变更，当前 ${active.length} 个：${active.join(", ")}；先把手上这个收口（npm run milestone:check → openspec archive <name> --yes，归档目录不入库）再开下一刀。这是规则，不是 bug`,
    );
  } else if (others.length) {
    errors.push(
      `main 上还有未收口 change：${others.join(", ")}；同一时间只推进一个变更，等维护者归档后才能合并这个 PR。这不是你的 bug，是上一刀没收口`,
    );
  }
  if (active.length === 0) {
    notices.push("当前没有活动变更：下一轮开始前先在 openspec/changes/ 立项");
  }
  const change =
    options.ownChange && active.includes(options.ownChange) ? options.ownChange : active[0];
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
    checkFactSection(root, change, design, errors);
    if (design !== null && pendingDecisions(design) === null) {
      errors.push(
        `活动变更 ${change} 的 design.md 缺少「${DECISION_HEADING}」小节：只列本变更相关的决议编号（D-…）或写“无”；未定问题写在 docs/DECISIONS.md 的条目里`,
      );
    }
    if (design !== null) {
      if (planKind === "card") {
        for (const heading of OBSERVABLE_SECTIONS) {
          if (!sectionHasItems(design, heading)) {
            errors.push(
              `活动变更 ${change} 的 design.md 缺少「${heading}」或内容为空：产品变更要写清用户能观察到的改变与手测步骤，收口时抄进卡片正文`,
            );
          }
        }
      }
    }
  }

  const decisionsText = readText(path.join(root, "docs", "DECISIONS.md")) ?? "";
  const queue = reviewQueue(decisionsText);
  pending = queue.decide.map((item) => item.id);
  if (queue.decide.length) {
    notices.push(
      `待用户确认 ${queue.decide.length} 项：${queue.decide.map((item) => item.id).join(", ")}`,
    );
  }
  if (queue.accept.length && active.length > 0 && !options.skipAcceptGate) {
    errors.push(
      `有 ${queue.accept.length} 项待验收（${queue.accept.map((item) => item.id).join(", ")}）：先请用户确认验收结论，再开新的变更`,
    );
  } else if (queue.accept.length) {
    notices.push(
      `待验收 ${queue.accept.length} 项：${queue.accept.map((item) => item.id).join(", ")}`,
    );
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
function decisionIdsIn(text) {
  const ids = new Set();
  for (const match of String(text ?? "").matchAll(/D-\d{8}-[a-z0-9-]+|D-\d{3}/gu)) {
    ids.add(match[0]);
  }
  return ids;
}

// A milestone only answers for the decisions this change points at: the design's
// 「用户决策」 and the 阻塞 field of the entry that records changes/<name>.
function referencedDecisionIds(designText, decisionsText, change) {
  const heading = String(designText ?? "").indexOf(DECISION_HEADING);
  const section =
    heading === -1
      ? ""
      : String(designText).slice(
          heading + DECISION_HEADING.length,
          (() => {
            const next = String(designText).indexOf("\n## ", heading + DECISION_HEADING.length);
            return next === -1 ? undefined : next;
          })(),
        );
  const ids = decisionIdsIn(section);
  for (const entry of decisionEntries(decisionsText)) {
    if (!entry.body.includes(`changes/${change}`)) continue;
    for (const id of decisionIdsIn(decisionMeta(entry)?.blocker ?? "")) ids.add(id);
  }
  return ids;
}

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
  checkFactSection(root, change, design, errors);
  if (design !== null && pendingDecisions(design) === null) {
    errors.push(`活动变更 ${change} 的 design.md 缺少「${DECISION_HEADING}」`);
  }
  const proposalText = readText(path.join(directory, "proposal.md")) ?? "";
  const planKind = planTarget(proposalText);
  if (planKind === "card") {
    if (!/更新卡片正文/u.test(tasks ?? "")) {
      errors.push(
        `产品变更 ${change} 归档前要在 tasks.md 记一条“更新卡片正文（现在能做什么 + 手测步骤 / 还没做）”：卡片正文是用户同步进度与测试的观察口`,
      );
    }
    const decisionEntriesText = readText(path.join(root, "docs", "DECISIONS.md")) ?? "";
    const related = decisionEntries(decisionEntriesText).find((entry) =>
      entry.body.includes(`changes/${change}`),
    );
    if (!related) {
      errors.push(
        `产品变更 ${change} 没有对应的决议条目：在 docs/DECISIONS.md 建或复用一条日期编号条目，并在「#### 2 执行」记录 changes/${change}`,
      );
    }
  }
  const decidedText = readText(path.join(root, "docs", "DECISIONS.md")) ?? "";
  const queue = reviewQueue(decidedText);
  const referenced = referencedDecisionIds(design, decidedText, change);
  const openReferenced = queue.decide.filter((item) => referenced.has(item.id));
  if (openReferenced.length) {
    errors.push(
      `本变更引用的决议未获用户确认，里程碑不能通过：${openReferenced.map((item) => item.id).join(", ")}；其它未决议题不阻塞这一刀收口`,
    );
  }
  const awaitingReferenced = queue.accept.filter((item) => referenced.has(item.id));
  if (awaitingReferenced.length) {
    errors.push(
      `本变更引用的条目还在待验收（${awaitingReferenced.map((item) => item.id).join(", ")}）：验收结论确认后才算交付`,
    );
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
  const processGate = options.processGate ?? true;
  const plan = checkPlan(root, {
    skipSpecValidation: true,
    skipAcceptGate: processGate === false,
    ...(options.ownChange ? { ownChange: options.ownChange } : {}),
  });
  const errors = [...docs.errors, ...plan.errors];
  const staged = options.stagedPaths ?? stagedPaths(root, git);
  const skipPlanCommitOrder = options.skipPlanCommitOrder ?? false;
  const code = staged.filter((name) => CODE_PREFIXES.some((prefix) => name.startsWith(prefix)));
  if (code.length) {
    const productCode = code.filter((name) => name.startsWith(PRODUCT_CODE_PREFIX));
    const planPrefixes = productCode.length ? PLAN_PREFIXES : TOOLING_PLAN_PREFIXES;
    const planned = staged.filter(
      (name) =>
        !name.startsWith(ARCHIVE_PREFIX) && planPrefixes.some((prefix) => name.startsWith(prefix)),
    );
    if (!planned.length) {
      errors.push(
        productCode.length
          ? "产品代码改动必须同时更新 docs/ 或 openspec/changes/ 里的计划与状态：先勾任务或记录证据，再提交"
          : "工具代码改动必须同时更新 docs/、AGENTS.md 或 openspec/changes/ 里的计划与状态：先勾任务或记录证据，再提交",
      );
    }
    if (processGate && plan.pending.length && productCode.length) {
      errors.push(
        `还有未获用户确认的决议，相关产品行为不能实现：${plan.pending.join(", ")}；工具与文档改动不受此限`,
      );
    }
    if (productCode.length && plan.change && !skipPlanCommitOrder) {
      const committedPlan = git([
        "ls-tree",
        "-r",
        "--name-only",
        "HEAD",
        "--",
        `openspec/changes/${plan.change}`,
      ]).text.trim();
      if (!committedPlan) {
        errors.push(
          `本轮变更 ${plan.change} 的计划还没有提交：先单独提交 openspec/changes/${plan.change}/（proposal/design/tasks），再提交产品代码；计划先于实现，才有可回看的开工依据`,
        );
      }
    }
    if (productCode.length && plan.planKind === "governance") {
      errors.push(
        `活动变更 ${plan.change} 写的是 Plan: none（治理变更），但这次提交含产品代码：产品行为必须有对应卡片与规格增量`,
      );
    }
    if (processGate && productCode.length && plan.change && factsRequired(root, plan.change)) {
      const impact = factImpact(
        readText(path.join(root, "openspec", "changes", plan.change, "design.md")),
      );
      if (impact?.kind === "仅执行") {
        errors.push(
          `活动变更 ${plan.change} 的事实影响写的是「仅执行」，但这次提交含产品代码：改分类，或把代码拆到行为变更里`,
        );
      }
      if (impact?.kind === "结构" && !staged.includes("docs/ARCHITECTURE.md")) {
        errors.push(
          `活动变更 ${plan.change} 的事实影响是「结构」，但这次提交没有更新 docs/ARCHITECTURE.md`,
        );
      }
      if (impact?.kind === "取舍" && !staged.includes("docs/DECISIONS.md")) {
        errors.push(
          `活动变更 ${plan.change} 的事实影响是「取舍」，但这次提交没有更新 docs/DECISIONS.md`,
        );
      }
    }
    if (productCode.length && plan.change && skipSpecs(root, plan.change)) {
      const impact = factsRequired(root, plan.change)
        ? factImpact(readText(path.join(root, "openspec", "changes", plan.change, "design.md")))
        : null;
      const structural = ["结构", "取舍", "仅执行"].includes(impact?.kind);
      if (structural) {
        plan.notices.push(
          `活动变更 ${plan.change} 标记了 skip_specs：事实影响是「${impact.kind}」，这次代码改动不需要规格增量`,
        );
      } else {
        errors.push(
          `活动变更 ${plan.change} 标记了 skip_specs，但这次提交含产品代码，事实影响也不是「结构/取舍/仅执行」：行为变更必须在变更里写 specs 增量`,
        );
      }
    }
    if (!productCode.length && plan.pending.length) {
      plan.notices.push(`工具/治理改动不受未决产品决策阻塞：${plan.pending.join(", ")}`);
    }
    if (!processGate && productCode.length) {
      plan.notices.push(
        "PR 检查不核对事实影响与 docs 配对：docs/ 是维护者路径，由维护者合入时补写并核对",
      );
    }
  }
  const decisionsText = readText(path.join(root, "docs", "DECISIONS.md")) ?? "";
  const queue = reviewQueue(decisionsText);
  if (staged.some((name) => name.startsWith(PRODUCT_CODE_PREFIX))) {
    const blocking = [...queue.decide, ...queue.accept].map((item) => item.id);
    if (blocking.length && processGate) {
      errors.push(
        `决议条目还没有用户确认/验收（${blocking.join(", ")}）：先确认再改产品代码；本机门只是兜底，约束在流程`,
      );
    } else if (blocking.length) {
      plan.notices.push(
        `PR 检查不套用维护者的待决/待验收流程门（${blocking.join(", ")}）：由审核人确认是否相关`,
      );
    }
  }
  return { errors, notices: plan.notices, staged };
}

/**
 * 平台侧的提交门：把 pre-commit 的判定套在一段 PR diff 上。
 *
 * 本机的 .githooks/pre-commit 只能护住装了钩子的维护者；协作者在平台上提交 PR
 * 时没有等价物，于是“代码不带计划”“未确认决议却改产品行为”能绕过。
 * 这里用 git diff <base>...HEAD 的文件清单复用同一套判定（不检查提交顺序：
 * PR 是一个整体，顺序由作者的历史决定，门只问这一批改动是否自带计划与状态）。
 */
export function checkRange(root, options = {}) {
  const git = options.git ?? ((args) => runGit(root, args));
  const base = options.base ?? "origin/main";
  const result = git(["diff", "--name-only", "-z", `${base}...HEAD`]);
  const baseExists = result.ok || result.text.trim().length > 0;
  if (!baseExists && !options.files) {
    return {
      errors: [`无法比较 base「${base}」与 HEAD：确认已 fetch 该分支（git fetch origin ${base}）`],
      notices: [],
      files: [],
    };
  }
  const files = (options.files ?? result.text.split("\u0000"))
    .filter(Boolean)
    .map((name) => name.replaceAll("\\", "/"));
  if (!files.length) {
    return { errors: [], notices: [`范围 ${base}...HEAD 没有改动文件`], files };
  }
  // 平台门：main 的树不允许有未收口 change。PR 自身带的那一个变更可以留在 diff 里
  // （计划与规格证据），但其它活动变更说明 main 上还有没归档的计划——显式报出来，
  // 让作者知道这不是自己的 bug，而是上一刀没收口。
  const own = [
    ...new Set(
      files
        .filter((name) => name.startsWith("openspec/changes/"))
        .map((name) => name.split("/")[2])
        .filter((name) => name && name !== "archive"),
    ),
  ];
  const checked = checkPrecommit(root, {
    git,
    stagedPaths: files,
    skipPlanCommitOrder: true,
    processGate: false,
    ownChange: own[0] ?? null,
  });
  return { ...checked, files };
}

/**
 * 平台树（main 的合并结果）不允许有未收口的 OpenSpec 变更。
 *
 * 本地开发需要 change 目录承载计划；但它一旦合进 main 就成了“没人负责收口的计划”，
 * 下一轮再立项就会变成并行变更。CI 在 push 到 main 与每个 PR 上跑这条，谁留着未收口
 * 的变更谁负责先归档。
 */
export function checkPlatform(root) {
  const unclosed = activeChanges(root);
  if (!unclosed.length) {
    return { errors: [], notices: ["平台树没有未收口 change：下一轮在本地立项"] };
  }
  return {
    errors: [
      `平台不允许未收口 change：${unclosed.join(", ")}；先在本地收口（npm run milestone:check → openspec archive <name> --yes，合并 specs 后删除 openspec/changes/<name>/）再提交或合并。这是规则，不是 bug`,
    ],
    notices: [],
  };
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

// 合并提交只算它自己写的改动：与两个父提交都不同的路径（冲突解决与合并时的手改）。
// 否则从另一侧带进来的、已经过它自己门槛的代码与活动变更会被当成本次新写的产品代码拦下。
export function stagedPaths(root, git) {
  const names = (args) =>
    git(["diff", "--cached", "--name-only", "-z", ...args])
      .text.split("\u0000")
      .filter(Boolean)
      .map((name) => name.replaceAll("\\", "/"));
  const staged = names([]);
  if (!git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok) return staged;
  const theirs = new Set(names(["MERGE_HEAD"]));
  return staged.filter((name) => theirs.has(name));
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

// CI 的 PR run 把 base 分支放在 GITHUB_BASE_REF；本地可用 --base 指定。
function baseFlag(root) {
  const explicit = process.argv.indexOf("--base");
  if (explicit !== -1) return process.argv[explicit + 1];
  const fromCi = process.env.GITHUB_BASE_REF;
  return fromCi ? `origin/${fromCi}` : null;
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
    if (command === "platform") return report("platform-check", checkPlatform(root));
    if (command === "milestone") return report("milestone-check", checkMilestone(root));
    if (command === "precommit") return report("precommit-check", checkPrecommit(root));
    if (command === "range") {
      const base = baseFlag(root) ?? "origin/main";
      return report("range-check", checkRange(root, { base }));
    }
    throw new Error(
      "Usage: node scripts/maintenance.mjs docs|plan|platform|milestone|precommit|range [--base <ref>]",
    );
  })();
  process.exit(output);
}

function planKindNotice(change) {
  return `活动变更 ${change} 是治理变更（Plan: none）：不对应能力卡，不能提交产品代码`;
}
