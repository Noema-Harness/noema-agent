import test from "node:test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  activeChanges,
  checkDocuments,
  checkDecisionEntries,
  decisionEntries,
  decisionMeta,
  checkMilestone,
  checkPlan,
  checkPrecommit,
  checkRange,
  localToday,
  reviewQueue,
  stagedPaths,
} from "./maintenance.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const DOCS = ["PRODUCT.md", "ARCHITECTURE.md", "DECISIONS.md", "OPERATIONS.md", "STATUS.md"];
const HEADER = "Authority: 测试\nUpdate when: 测试\nDoes not own: 测试\n";
const TODAY = localToday();
const BOARD = "https://github.com/orgs/Noema-Harness/projects/1";

const LIFECYCLE = (stage = "执行中", batch = "changes/stage-probe") => {
  const decision = stage === "决策中" ? ["- 要定：x"] : ["- 决定：x（用户确认：2026-11-16）"];
  return [
    `- **阶段**：${stage}`,
    "- **来源**：测试",
    "- **阻塞**：无",
    "- **结构**：无",
    "#### 1 决策",
    ...decision,
    "#### 2 执行",
    `- 批次：${batch}`,
    "#### 3 验收",
    "- x — 手测 — 待验收",
    "",
  ].join("\n");
};

function fakeGit({
  baseline = true,
  hooksPath = ".githooks",
  dirty = false,
  committedPlan = true,
  committedDecisions = "",
} = {}) {
  return (args) => {
    if (args[0] === "merge-base") return { ok: baseline, text: "" };
    if (args[0] === "show") return { ok: true, text: committedDecisions };
    if (args[0] === "ls-tree") {
      return { ok: true, text: committedPlan ? "openspec/changes/stage-probe/proposal.md\n" : "" };
    }
    if (args[0] === "config") return { ok: true, text: `${hooksPath}\n` };
    if (args[0] === "status") return { ok: true, text: dirty ? " M docs/STATUS.md\n" : "" };
    return { ok: true, text: "" };
  };
}

function write(root, name, content) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function makeRoot(holder, overrides = {}) {
  const root = path.join(holder, "repository");
  write(
    root,
    "scripts/workspace.config.json",
    JSON.stringify({
      currentDocuments: DOCS.map((name) => `docs/${name}`),
    }),
  );
  for (const name of DOCS) write(root, `docs/${name}`, `# ${name}\n\n${HEADER}`);
  write(
    root,
    "docs/DECISIONS.md",
    `# DECISIONS\n\n${HEADER}\n## D-20261116-stage-probe 探针条目\n\n${LIFECYCLE("执行中", `changes/${overrides.name ?? "stage-probe"}`)}`,
  );
  write(root, "package.json", JSON.stringify({ version: "0.7.6" }));
  write(root, "apps/desktop/package.json", JSON.stringify({ version: "0.7.6" }));
  write(
    root,
    "docs/STATUS.md",
    `# STATUS\n\n${HEADER}\n源码版本：\`${overrides.version ?? "0.7.6"}\`\n\n当前源码基线：\`f592a9b\`\n\n最后更新：${overrides.updated ?? TODAY}\n`,
  );
  if (overrides.product !== false) {
    write(
      root,
      "docs/PRODUCT.md",
      `# PRODUCT\n\n${HEADER}\n${overrides.product ?? "产品定义。\n"}`,
    );
  }
  write(root, ".githooks/pre-commit", "#!/bin/sh\n");
  write(root, "openspec/config.yaml", "context: 见 docs/STATUS.md 与 docs/PRODUCT.md\n");
  if (overrides.change !== false) {
    const change = `openspec/changes/${overrides.name ?? "stage-probe"}`;
    write(root, `${change}/proposal.md`, `# proposal\n\nPlan: ${BOARD}\n\n## 本轮内容\n\n- 验证\n`);
    write(
      root,
      `${change}/design.md`,
      `# design\n\n## 用户可观察的改变\n\n- 探针行为\n\n## 手测步骤\n\n1. 打开探针\n\n## 用户决策\n\n${overrides.decisions ?? "- 无"}\n`,
    );
    write(root, `${change}/tasks.md`, `# tasks\n\n${overrides.tasks ?? "- [ ] 第一项\n"}`);
    if (overrides.skipSpecs) write(root, `${change}/.openspec.yaml`, "skip_specs: true\n");
  }
  return root;
}

function withRoot(run) {
  const runs = path.join(repositoryRoot, ".work", "runs");
  fs.mkdirSync(runs, { recursive: true });
  const holder = fs.mkdtempSync(path.join(runs, "maintenance-tooling-"));
  try {
    run(holder);
  } finally {
    fs.rmSync(holder, { recursive: true });
  }
}

test("maintenance tooling enforces document, plan and commit gates", () =>
  withRoot((holder) => {
    const root = makeRoot(holder);
    const git = fakeGit();
    assert.deepEqual(checkDocuments(root, git).errors, []);
    assert.deepEqual(checkPlan(root, { skipSpecValidation: true }).errors, []);
    assert.equal(activeChanges(root).length, 1);

    // A shipped version that left STATUS behind must fail the gate.
    write(
      root,
      "docs/STATUS.md",
      `# STATUS\n\n${HEADER}\n源码版本：\`0.7.3\`\n\n当前源码基线：\`f592a9b\`\n\n最后更新：${TODAY}\n`,
    );
    assert.match(
      checkDocuments(root, git).errors.join("\n"),
      /源码版本 0.7.3 与 package.json 0.7.6 不一致/u,
    );
    write(
      root,
      "docs/STATUS.md",
      `# STATUS\n\n${HEADER}\n源码版本：\`0.7.6\`\n\n当前源码基线：\`f592a9b\`\n\n最后更新：${TODAY}\n`,
    );

    // An unregistered document is a second source of truth.
    write(root, "docs/NOTES.md", "# notes\n");
    assert.match(checkDocuments(root, git).errors.join("\n"), /未登记文档 docs\/NOTES.md/u);
    fs.rmSync(path.join(root, "docs", "NOTES.md"));

    // Removing a header drops the ownership contract.
    write(root, "docs/OPERATIONS.md", "# OPERATIONS\n");
    assert.match(checkDocuments(root, git).errors.join("\n"), /缺少文档头 Authority:/u);
    write(root, "docs/OPERATIONS.md", `# OPERATIONS\n\n${HEADER}`);

    // CI runners have no local hook; the gate must not fail there.
    const localHookErrors = checkDocuments(root, fakeGit({ hooksPath: "" }), { ci: false }).errors;
    const ciErrors = checkDocuments(root, fakeGit({ hooksPath: "" }), { ci: true }).errors;
    assert.equal(ciErrors.length, localHookErrors.length - 1);
    assert.ok(!ciErrors.some((error) => /core\.hooksPath/u.test(error)));

    // The document gate must be installed as a real git hook.
    assert.match(
      checkDocuments(root, fakeGit({ hooksPath: "" }), { ci: false }).errors.join("\n"),
      /core.hooksPath 是「\(未设置\)」/u,
    );
    assert.deepEqual(
      checkDocuments(root, fakeGit({ baseline: false })).errors.map((error) =>
        error.replace(/f592a9b/u, "base"),
      ),
      ["docs/STATUS.md 基线 base 不是 HEAD 的祖先：基线写错或仓库被重写"],
    );

    // OpenSpec config must not point at deleted documents.
    write(root, "openspec/config.yaml", "context: 见 docs/CURRENT_CONTEXT.md\n");
    assert.match(
      checkDocuments(root, git).errors.join("\n"),
      /引用了不存在的文档 docs\/CURRENT_CONTEXT.md/u,
    );
    write(root, "openspec/config.yaml", "context: 见 docs/STATUS.md\n");

    // Only one planned stage at a time.
    write(root, "openspec/changes/stage-two/proposal.md", "# probe\n");
    for (const name of ["design.md", "tasks.md"])
      write(root, `openspec/changes/stage-two/${name}`, "# probe\n");
    assert.match(checkPlan(root, { skipSpecValidation: true }).errors.join("\n"), /必须至多 1 个/u);
    assert.equal(
      checkPlan(root, { skipSpecValidation: true, allowActive: ["stage-probe"] })
        .errors.join("\n")
        .includes("必须至多 1 个"),
      false,
    );
    fs.rmSync(path.join(root, "openspec/changes/stage-two"), { recursive: true });

    // A finished task list no longer guides development.
    const change = "openspec/changes/stage-probe";
    write(root, `${change}/tasks.md`, "# tasks\n\n- [x] 第一项\n");
    assert.match(
      checkPlan(root, { skipSpecValidation: true }).errors.join("\n"),
      /全部任务已完成/u,
    );
    write(root, `${change}/tasks.md`, "# tasks\n\n- [ ] 第一项\n- [ ] 第二项\n");
    assert.equal(
      checkPlan(root, { skipSpecValidation: true })
        .notices.join("\n")
        .includes("0 完成 / 2 未完成"),
      true,
    );

    // A decision that still waits for the user blocks product code from being committed.
    const decisionsPath = path.join(root, "docs", "DECISIONS.md");
    const originalDecisions = fs.readFileSync(decisionsPath, "utf8");
    write(
      root,
      "docs/DECISIONS.md",
      `# DECISIONS\n\n${HEADER}## D-20261116-awaiting 等待确认的探针\n\n${LIFECYCLE("决策中", "无")}\n`,
    );
    assert.equal(reviewQueue(fs.readFileSync(decisionsPath, "utf8")).decide.length, 1);
    const blocked = checkPrecommit(root, { git, stagedPaths: ["apps/desktop/src/main/main.ts"] });
    assert.match(blocked.errors.join("\n"), /必须同时更新 docs\/ 或 openspec\/changes\//u);
    assert.match(blocked.errors.join("\n"), /还有未获用户确认的决议/u);

    // Code ships only with a plan update and no decision waiting for the user.
    write(root, "docs/DECISIONS.md", originalDecisions);
    const committed = checkPrecommit(root, {
      git,
      stagedPaths: ["apps/desktop/src/main/main.ts", "openspec/changes/stage-probe/tasks.md"],
    });
    assert.deepEqual(committed.errors, []);
    // Archive-only edits do not count as a plan update.
    const archived = checkPrecommit(root, {
      git,
      stagedPaths: [
        "apps/desktop/src/main/main.ts",
        "openspec/changes/archive/2026-11-15-old/tasks.md",
      ],
    });
    assert.match(archived.errors.join("\n"), /必须同时更新 docs\/ 或 openspec\/changes\//u);
  }));

test("documented commands must exist, so CI cannot reference a removed script", () =>
  withRoot((holder) => {
    const root = makeRoot(holder);
    write(
      root,
      "package.json",
      `${JSON.stringify({ name: "fixture", version: "0.7.6", scripts: { check: "echo" } }, null, 2)}\n`,
    );
    write(root, "README.md", "# README\n\n运行 `npm run workspace:test`。\n");
    const bad = checkDocuments(root, fakeGit());
    assert.match(bad.errors.join("\n"), /不存在的脚本 npm run workspace:test/u);

    write(root, "README.md", "# README\n\n运行 `npm run check`；DSH 侧用 `pnpm run dev:web`。\n");
    assert.deepEqual(checkDocuments(root, fakeGit()).errors, []);
  }));

test("proposals point at the plan card and resident documents stay free of mirrored plans", () =>
  withRoot((holder) => {
    const root = makeRoot(holder);
    const git = fakeGit();

    // Boundaries are stated by each document's header and enforced by review; the gate
    // only checks mechanical facts, so a clean PRODUCT passes without keyword rules.
    assert.deepEqual(checkDocuments(root, git).errors, []);

    // A change must name the card it advances; nothing about ordering or status is mirrored.
    write(
      root,
      "openspec/changes/stage-probe/proposal.md",
      "# proposal\n\n## 本轮内容\n\n- 验证\n",
    );
    assert.match(
      checkPlan(root, { skipSpecValidation: true }).errors.join("\n"),
      /缺少「Plan: <卡片链接>」/u,
    );

    write(
      root,
      "openspec/changes/stage-probe/proposal.md",
      `# proposal\n\nPlan: ${BOARD}\n\n## 本轮内容\n\n- 验证\n`,
    );
    assert.deepEqual(checkPlan(root, { skipSpecValidation: true }).errors, []);
  }));

test("user acceptance needs a confirmation date", () =>
  withRoot((holder) => {
    const root = makeRoot(holder);
    const change = "openspec/changes/stage-probe";

    write(root, `${change}/tasks.md`, "# tasks\n\n- [ ] [用户] 看一遍界面是否自然 → 截图\n");
    const pendingAcceptance = checkPlan(root, { skipSpecValidation: true });
    assert.deepEqual(pendingAcceptance.errors, []);
    assert.equal(pendingAcceptance.notices.join("\n").includes("用户验收项 1 项"), true);

    write(root, `${change}/tasks.md`, "# tasks\n\n- [x] [用户] 看一遍界面是否自然 → 截图\n");
    assert.match(
      checkPlan(root, { skipSpecValidation: true }).errors.join("\n"),
      /用户验收项已勾选但缺少「（用户确认：YYYY-MM-DD）」/u,
    );

    write(
      root,
      `${change}/tasks.md`,
      "# tasks\n\n- [x] [用户] 看一遍界面是否自然 → 截图（用户确认：2026-11-15）\n- [ ] 还要改一处\n",
    );
    assert.deepEqual(checkPlan(root, { skipSpecValidation: true }).errors, []);
  }));

test("a milestone is archivable only when tasks, decisions and evidence line up", () =>
  withRoot((holder) => {
    const root = makeRoot(holder, { tasks: "# tasks\n\n- [ ] 第一项\n" });
    const change = "openspec/changes/stage-probe";
    const blocked = checkMilestone(root, { git: fakeGit(), today: TODAY });
    assert.match(blocked.errors.join("\n"), /还有 1 个任务未完成/u);

    write(
      root,
      `${change}/tasks.md`,
      "# tasks\n\n- [x] 第一项\n- [x] 更新卡片正文：现在能做什么 + 手测步骤\n- [x] 卡片证据：https://github.com/Noema-Harness/noema-agent/issues/138#issuecomment-1\n",
    );
    write(root, `${change}/design.md`, "# design\n\n## 用户决策\n\n- 见 D-20261116-awaiting\n");
    write(
      root,
      "docs/DECISIONS.md",
      `# DECISIONS\n\n${HEADER}## D-20261116-awaiting 等待确认的探针\n\n${LIFECYCLE("决策中", "无")}\n`,
    );
    const decided = checkMilestone(root, { git: fakeGit(), today: TODAY });
    assert.match(decided.errors.join("\n"), /还有 1 项决议未获用户确认/u);
    assert.match(decided.errors.join("\n"), /没有 specs 增量/u);

    // Drop the open decision again before checking the archivable path.
    write(
      root,
      "docs/DECISIONS.md",
      `# DECISIONS\n\n${HEADER}## D-20261116-stage-probe 探针条目\n\n${LIFECYCLE("执行中", "changes/stage-probe")}`,
    );
    write(root, `${change}/design.md`, "# design\n\n## 用户决策\n\n- 无\n");
    write(root, `${change}/specs/probe/spec.md`, "# spec\n");
    const stale = checkMilestone(root, {
      git: fakeGit(),
      today: TODAY,
      // STATUS 未更新
    });
    assert.deepEqual(stale.errors, []);

    write(
      root,
      "docs/STATUS.md",
      `# STATUS\n\n${HEADER}\n源码版本：\`0.7.6\`\n\n当前源码基线：\`f592a9b\`\n\n最后更新：2026-01-01\n`,
    );
    assert.match(
      checkMilestone(root, { git: fakeGit(), today: TODAY }).errors.join("\n"),
      /今天交付必须更新 STATUS/u,
    );
  }));

test("a product change updates the card body before it can be archived", () =>
  withRoot((holder) => {
    const root = makeRoot(holder, { tasks: "# tasks\n\n- [x] 第一项\n" });
    const change = "openspec/changes/stage-probe";
    write(root, `${change}/design.md`, "# design\n\n## 用户决策\n\n- 无\n");
    write(root, `${change}/specs/probe/spec.md`, "# spec\n");
    write(
      root,
      "docs/STATUS.md",
      `# STATUS\n\n${HEADER}\n源码版本：\`0.7.6\`\n\n当前源码基线：\`f592a9b\`\n\n最后更新：${TODAY}\n`,
    );

    const missing = checkMilestone(root, { git: fakeGit(), today: TODAY });
    assert.match(missing.errors.join("\n"), /更新卡片正文/u);

    write(
      root,
      `${change}/tasks.md`,
      "# tasks\n\n- [x] 第一项\n- [x] 更新卡片正文：现在能做什么 + 手测步骤\n",
    );
    assert.deepEqual(checkMilestone(root, { git: fakeGit(), today: TODAY }).errors, []);
  }));

test("a decision id carries its date so parallel branches never renumber", () => {
  const legacy = checkDecisionEntries("## D-20261115-probe\n\n- 状态：决定\n");
  assert.deepEqual(legacy.errors, []);
  const dated = checkDecisionEntries("## D-20261116-probe\n\n- 决定：x\n");
  assert.match(dated.errors.join("\n"), /缺少「\*\*阶段\*\*：…」/u);
});

test("a linked entry keeps its issue number and its id", () => {
  const [entry] = decisionEntries(
    "## [#151](https://github.com/Noema-Harness/noema-agent/issues/151) D-20261116-probe 探针\n\n- **阶段**：执行中\n",
  );
  assert.equal(entry.id, "D-20261116-probe");
  assert.equal(entry.issue, 151);
  assert.equal(decisionMeta(entry).stage, "执行中");
});

test("a product change designs what the user can observe and how to test it", () =>
  withRoot((holder) => {
    const root = makeRoot(holder);
    assert.deepEqual(checkPlan(root, { skipSpecValidation: true }).errors, []);
    write(root, "openspec/changes/stage-probe/design.md", "# design\n\n## 用户决策\n\n- 无\n");
    const errors = checkPlan(root, { skipSpecValidation: true }).errors.join("\n");
    assert.match(errors, /用户可观察的改变/u);
    assert.match(errors, /手测步骤/u);
  }));

test("product code waits until the round's plan is committed", () =>
  withRoot((holder) => {
    const root = makeRoot(holder);
    const staged = ["apps/desktop/src/main/main.ts", "openspec/changes/stage-probe/tasks.md"];
    const blocked = checkPrecommit(root, {
      git: fakeGit({ committedPlan: false }),
      stagedPaths: staged,
    });
    assert.match(blocked.errors.join("\n"), /计划还没有提交/u);
    const allowed = checkPrecommit(root, { git: fakeGit(), stagedPaths: staged });
    assert.doesNotMatch(allowed.errors.join("\n"), /计划还没有提交/u);
  }));

test("the platform range gate applies the commit rules to a PR diff", () =>
  withRoot((holder) => {
    const root = makeRoot(holder);
    const git = fakeGit();

    const bare = checkRange(root, { git, files: ["apps/desktop/src/main/main.ts"] });
    assert.match(bare.errors.join("\n"), /产品代码改动必须同时更新/u);

    const withPlan = checkRange(root, {
      git,
      files: ["apps/desktop/src/main/main.ts", "openspec/changes/stage-probe/tasks.md"],
    });
    assert.deepEqual(withPlan.errors, []);

    const docsOnly = checkRange(root, { git, files: ["docs/OPERATIONS.md"] });
    assert.deepEqual(docsOnly.errors, []);
  }));

test("governance changes declare Plan: none and never ship product code", () =>
  withRoot((holder) => {
    const root = makeRoot(holder, { skipSpecs: true });
    const change = "openspec/changes/stage-probe";
    write(root, `${change}/proposal.md`, "# proposal\n\nPlan: none\n\n## 本轮内容\n\n- 机制维护\n");
    const git = fakeGit();

    const plan = checkPlan(root, { skipSpecValidation: true });
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.planKind, "governance");
    assert.equal(plan.notices.join("\n").includes("治理变更（Plan: none）"), true);

    const tooling = checkPrecommit(root, {
      git,
      stagedPaths: ["scripts/maintenance.mjs", `${change}/tasks.md`],
    });
    assert.deepEqual(tooling.errors, []);

    const product = checkPrecommit(root, {
      git,
      stagedPaths: ["apps/desktop/src/main/main.ts", `${change}/tasks.md`],
    });
    assert.match(product.errors.join("\n"), /Plan: none（治理变更），但这次提交含产品代码/u);

    write(root, `${change}/proposal.md`, "# proposal\n\n## 本轮内容\n\n- 没写计划\n");
    const missing = checkPlan(root, { skipSpecValidation: true });
    assert.equal(missing.planKind, null);
    assert.match(missing.errors.join("\n"), /缺少「Plan:/u);
  }));

test("unanswered decisions block product code but not tooling maintenance", () =>
  withRoot((holder) => {
    const root = makeRoot(holder, {
      decisions: "- 见 D-20261116-stage-probe\n",
      skipSpecs: true,
    });
    const git = fakeGit();
    write(
      root,
      "docs/DECISIONS.md",
      `# DECISIONS\n\n${HEADER}## D-20261116-stage-probe 探针条目\n\n${LIFECYCLE("执行中", "changes/stage-probe")}## D-20261116-awaiting 等待确认的探针\n\n${LIFECYCLE("决策中", "无")}\n`,
    );

    const tooling = checkPrecommit(root, {
      git,
      stagedPaths: ["scripts/maintenance.mjs", "docs/OPERATIONS.md"],
    });
    assert.deepEqual(tooling.errors, []);
    assert.equal(tooling.notices.join("\n").includes("工具/治理改动不受未决产品决策阻塞"), true);

    const product = checkPrecommit(root, {
      git,
      stagedPaths: ["apps/desktop/src/main/main.ts", "openspec/changes/stage-probe/tasks.md"],
    });
    assert.match(product.errors.join("\n"), /还有未获用户确认的决议/u);

    write(root, "openspec/changes/stage-probe/design.md", "# design\n\n## 用户决策\n\n- 无\n");
    const behaviour = checkPrecommit(root, {
      git,
      stagedPaths: ["apps/desktop/src/main/main.ts", "openspec/changes/stage-probe/tasks.md"],
    });
    assert.match(behaviour.errors.join("\n"), /标记了 skip_specs，但这次提交含产品代码/u);
  }));
test("a dated entry puts its stage first and keeps the three sections", () => {
  const missing = checkDecisionEntries("## D-20261116-probe\n\n- 决定：x\n");
  assert.match(missing.errors.join("\n"), /缺少「\*\*阶段\*\*：…」/u);

  const bare = checkDecisionEntries("## D-20261116-probe\n\n- **阶段**：执行中\n\n- 决定：x\n");
  assert.match(bare.errors.join("\n"), /缺少「#### 1 决策」小节/u);

  const unknown = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("执行中").replace("执行中", "已完成")}`,
  );
  assert.match(unknown.errors.join("\n"), /不在 决策中 \/ 执行中 \/ 待验收 \/ 已收口 里/u);

  const late = checkDecisionEntries(`## D-20261116-probe\n\n- **来源**：测试\n${LIFECYCLE()}`);
  assert.match(late.errors.join("\n"), /阶段必须是第一条字段/u);

  const decided = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("决策中").replace("- 要定：x", "- 决定：x")}`,
  );
  assert.match(decided.errors.join("\n"), /还在决策中，却已经写了「- 决定：」/u);

  const closed = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("已收口").replace("- 用户确认：2026-11-16", "")}`,
  );
  assert.match(closed.errors.join("\n"), /已收口，验收末尾应写「- 用户确认：YYYY-MM-DD」/u);
});

test("tooling code pairs with docs, a change or AGENTS.md", () =>
  withRoot((holder) => {
    const root = makeRoot(holder);
    const blocked = checkPrecommit(root, {
      git: fakeGit(),
      stagedPaths: ["scripts/governance.mjs"],
    });
    assert.match(blocked.errors.join("\n"), /AGENTS\.md 或 openspec\/changes\//u);

    const allowed = checkPrecommit(root, {
      git: fakeGit(),
      stagedPaths: ["scripts/governance.mjs", "AGENTS.md"],
    });
    assert.equal(
      allowed.errors.some((line) => /代码改动必须同时更新/u.test(line)),
      false,
    );
  }));

test("a dated change declares which kind of fact it changes", () =>
  withRoot((holder) => {
    const root = makeRoot(holder);
    const change = "openspec/changes/stage-probe";
    write(root, `${change}/.openspec.yaml`, "created: 2026-11-16\nskip_specs: true\n");

    assert.match(
      checkPlan(root, { skipSpecValidation: true }).errors.join("\n"),
      /缺少「## 事实影响」/u,
    );

    write(
      root,
      `${change}/design.md`,
      [
        "# design",
        "",
        "## 事实影响",
        "",
        "- 类别：仅执行",
        "- 依据：只改脚本和文档，产品行为与系统结构不变。",
        "",
        "## 用户可观察的改变",
        "",
        "- 探针行为",
        "",
        "## 手测步骤",
        "",
        "1. 打开探针",
        "",
        "## 用户决策",
        "",
        "- 无",
        "",
      ].join("\n"),
    );
    assert.deepEqual(checkPlan(root, { skipSpecValidation: true }).errors, []);

    write(
      root,
      `${change}/design.md`,
      "# design\n\n## 事实影响\n\n- 类别：随便\n\n- 依据：\n\n## 用户决策\n\n- 无\n",
    );
    const errors = checkPlan(root, { skipSpecValidation: true }).errors.join("\n");
    assert.match(errors, /类别必须是/u);
    assert.match(errors, /缺少 - 依据/u);
  }));

test("the commit gate pairs the declared fact kind with the files it changes", () =>
  withRoot((holder) => {
    const root = makeRoot(holder);
    const change = "openspec/changes/stage-probe";
    write(root, `${change}/.openspec.yaml`, "created: 2026-11-16\nskip_specs: true\n");
    write(
      root,
      `${change}/design.md`,
      [
        "# design",
        "",
        "## 事实影响",
        "",
        "- 类别：仅执行",
        "- 依据：只改脚本。",
        "",
        "## 用户可观察的改变",
        "",
        "- 探针行为",
        "",
        "## 手测步骤",
        "",
        "1. 打开探针",
        "",
        "## 用户决策",
        "",
        "- 无",
        "",
      ].join("\n"),
    );
    const staged = [`${change}/tasks.md`, "apps/desktop/src/main/x.ts"];
    const result = checkPrecommit(root, {
      git: fakeGit(),
      stagedPaths: staged,
      skipPlanCommitOrder: true,
    });
    assert.match(result.errors.join("\n"), /事实影响写的是「仅执行」/u);
  }));

test("stagedPaths counts only a merge's own changes", () => {
  const diff = (merging) => (args) => {
    if (args[0] === "rev-parse") return { ok: merging, text: "" };
    const againstTheirs = args.includes("MERGE_HEAD");
    // 对 HEAD：从 main 带进来的产品代码 + 冲突解决的 STATUS；对 MERGE_HEAD：只有本分支的改动与 STATUS。
    const names = againstTheirs
      ? ["docs/STATUS.md", "apps/desktop/src/main/branch-only.ts"]
      : ["docs/STATUS.md", "apps/desktop/src/main/from-main.ts"];
    return { ok: true, text: names.join("\u0000") + "\u0000" };
  };
  assert.deepEqual(stagedPaths(repositoryRoot, diff(true)), ["docs/STATUS.md"]);
  assert.deepEqual(stagedPaths(repositoryRoot, diff(false)), [
    "docs/STATUS.md",
    "apps/desktop/src/main/from-main.ts",
  ]);
});
