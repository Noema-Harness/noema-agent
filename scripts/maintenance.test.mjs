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
  findGovernanceWordsInDocs,
  findCoreBoundaryProblems,
  checkMilestone,
  checkPlatform,
  checkPlan,
  checkPrecommit,
  checkRange,
  localToday,
  reviewQueue,
  changeScope,
  stagedPaths,
} from "./maintenance.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const DOCS = ["PRODUCT.md", "ARCHITECTURE.md", "DECISIONS.md", "OPERATIONS.md", "STATUS.md"];
const HEADER = "Authority: 测试\nUpdate when: 测试\nDoes not own: 测试\n";
const TODAY = localToday();
const BOARD = "https://github.com/orgs/Noema-Harness/projects/1";

const LIFECYCLE = (stage = "执行中", batch = "changes/stage-probe") => {
  const waiting = stage === "决策中";
  const decision = waiting ? ["- 要定：x"] : ["- 决定：x（用户确认：2026-11-16）"];
  const execution = waiting ? ["- 未开始：定案后进入执行"] : [`- 批次：${batch}`];
  const acceptance = waiting
    ? ["- 未开始：定案后进入验收"]
    : stage === "已收口"
      ? ["- [x] x — 手测", "- 用户确认：2026-11-16"]
      : ["- [ ] x — 手测"];
  return [
    `- **阶段**：${stage}`,
    "- **来源**：用户 2026-11-16 要求做探针",
    "- **阻塞**：无",
    "- **结构**：无",
    "#### 1 决策",
    ...decision,
    "#### 2 执行",
    ...execution,
    "#### 3 验收",
    ...acceptance,
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
    assert.match(
      checkPlan(root, { skipSpecValidation: true }).errors.join("\n"),
      /本地同时只能推进 1 个/u,
    );
    // The platform gate refuses a tree that still carries an unclosed change.
    assert.match(checkPlatform(root).errors.join("\n"), /平台不允许未收口 change/u);

    fs.rmSync(path.join(root, "openspec/changes/stage-two"), { recursive: true });
    // 平台门在 PR 上只允许本 PR 新开的 change：base 上已有的未收口要先收口，
    // 不能靠 PR 顺手带过去。
    const ownDiff = () => ({ ok: true, text: "openspec/changes/stage-probe/proposal.md\n" });
    assert.deepEqual(checkPlatform(root, { base: "origin/main", git: ownDiff }).errors, []);
    const foreignDiff = () => ({ ok: true, text: "openspec/changes/other/proposal.md\n" });
    assert.match(
      checkPlatform(root, { base: "origin/main", git: foreignDiff }).errors.join("\n"),
      /PR 不能携带别人的变更/u,
    );

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
    // 只有本变更引用了它，才算“相关产品行为不能实现”。
    const designPath = path.join(root, `${change}/design.md`);
    const originalDesign = fs.readFileSync(designPath, "utf8");
    write(root, `${change}/design.md`, "# design\n\n## 用户决策\n\n- 见 D-20261116-awaiting\n");
    const blocked = checkPrecommit(root, { git, stagedPaths: ["apps/desktop/src/main/main.ts"] });
    assert.match(blocked.errors.join("\n"), /必须同时更新 docs\/ 或 openspec\/changes\//u);
    assert.match(blocked.errors.join("\n"), /本变更引用的决议未获用户确认/u);

    // 不引用它就不挡：恢复设计后，只有“没带计划”的错。
    write(root, `${change}/design.md`, originalDesign);
    const unrelated = checkPrecommit(root, { git, stagedPaths: ["apps/desktop/src/main/main.ts"] });
    assert.doesNotMatch(unrelated.errors.join("\n"), /未获用户确认/u);
    assert.match(unrelated.errors.join("\n"), /必须同时更新 docs\/ 或 openspec\/changes\//u);

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

test("unrelated pending decisions do not block a milestone", () =>
  withRoot((holder) => {
    const root = makeRoot(holder);
    const change = "openspec/changes/stage-probe";
    write(
      root,
      `${change}/tasks.md`,
      "# tasks\n\n- [x] 第一项\n- [x] 更新卡片正文：现在能做什么 + 手测步骤\n",
    );
    write(root, `${change}/design.md`, "# design\n\n## 用户决策\n\n- 无\n");
    write(root, `${change}/specs/probe/spec.md`, "# spec\n");
    write(
      root,
      "docs/DECISIONS.md",
      `# DECISIONS\n\n${HEADER}## D-20261116-stage-probe 探针条目\n\n${LIFECYCLE("执行中", "changes/stage-probe")}\n\n## D-20261116-unrelated 别的议题\n\n${LIFECYCLE("决策中", "无")}\n`,
    );
    const result = checkMilestone(root, { git: fakeGit(), today: TODAY });
    assert.equal(
      result.errors.join("\n").includes("D-20261116-unrelated"),
      false,
      result.errors.join("\n"),
    );
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
    assert.match(decided.errors.join("\n"), /本变更引用的决议未获用户确认/u);
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

test("a product change does not need a decision entry", () =>
  withRoot((holder) => {
    const root = makeRoot(holder, {
      tasks: "# tasks\n\n- [x] 第一项\n- [x] 更新卡片正文：现在能做什么 + 手测步骤\n",
    });
    const change = "openspec/changes/stage-probe";
    write(root, `${change}/design.md`, "# design\n\n## 用户决策\n\n- 无\n");
    write(root, `${change}/specs/probe/spec.md`, "# spec\n");
    write(root, "docs/DECISIONS.md", `# DECISIONS\n\n${HEADER}`);
    write(
      root,
      "docs/STATUS.md",
      `# STATUS\n\n${HEADER}\n源码版本：\`0.7.6\`\n\n当前源码基线：\`f592a9b\`\n\n最后更新：${TODAY}\n`,
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

    // A PR whose base still carries an unclosed change is refused explicitly.
    const blocked = checkRange(root, {
      git,
      files: ["apps/desktop/src/main/main.ts", "openspec/changes/stage-two/tasks.md"],
    });
    assert.match(blocked.errors.join("\n"), /main 上还有未收口 change/u);

    // Once the base tree is clean, the same diff is judged on its own plan pairing.
    fs.rmSync(path.join(root, "openspec/changes/stage-probe"), { recursive: true });
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

    // 别的议题待确认不挡本变更：设计里只引用了已确认的 stage-probe。
    const product = checkPrecommit(root, {
      git,
      stagedPaths: ["apps/desktop/src/main/main.ts", "openspec/changes/stage-probe/tasks.md"],
    });
    assert.doesNotMatch(product.errors.join("\n"), /未获用户确认/u);
    assert.match(product.notices.join("\n"), /与本变更无关/u);

    // 引用到待确认的议题时才挡。
    write(
      root,
      "openspec/changes/stage-probe/design.md",
      "# design\n\n## 用户决策\n\n- 见 D-20261116-awaiting\n",
    );
    const referenced = checkPrecommit(root, {
      git,
      stagedPaths: ["apps/desktop/src/main/main.ts", "openspec/changes/stage-probe/tasks.md"],
    });
    assert.match(referenced.errors.join("\n"), /本变更引用的决议未获用户确认/u);

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

test("a decision in progress writes only the decision layer", () => {
  const filled = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("决策中").replace(
      "- 未开始：定案后进入执行",
      "- 批次：changes/probe",
    )}`,
  );
  assert.match(filled.errors.join("\n"), /还在决策中，「#### 2 执行」却已经有内容/u);

  const accepted = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("决策中").replace(
      "- 未开始：定案后进入验收",
      "- [ ] x — 手测",
    )}`,
  );
  assert.match(accepted.errors.join("\n"), /还在决策中，「#### 3 验收」却已经有内容/u);

  const quiet = checkDecisionEntries(`## D-20261116-probe\n\n${LIFECYCLE("决策中")}`);
  assert.equal(quiet.errors.join("\n"), "");

  const vague = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("决策中").replace("- 要定：x", "- 纪要：先讨论")}`,
  );
  assert.match(vague.errors.join("\n"), /没有「- 要定：」/u);
});

test("a reopened entry keeps its execution and acceptance history in the decision stage", () => {
  const reopened = `## D-20261116-probe

- **阶段**：决策中
- **来源**：用户 2026-11-16 要求做探针
- **阻塞**：无
- **结构**：无
#### 1 决策
- 要定：补齐 E12/E19
- 决定：先做验收页（用户确认：2026-11-16）
#### 2 执行
- 批次：changes/stage-probe
- 完成：批次一已归档
#### 3 验收
- [ ] x — 手测
- 重开：验收不过，回决策补齐范围（2026-11-16）
`;
  const kept = checkDecisionEntries(reopened);
  assert.equal(kept.errors.join("\n"), "");

  const cleared = checkDecisionEntries(reopened.replace(/^- 重开：.*\n/mu, ""));
  assert.match(cleared.errors.join("\n"), /还在决策中，「#### 2 执行」却已经有内容/u);
  assert.match(cleared.errors.join("\n"), /还在决策中，却已经写了「- 决定：」/u);
});

test("entry history only grows: a removed completion line fails the check", () => {
  const previous = `## D-20261116-probe\n\n${LIFECYCLE("待验收")}\n- 完成：批次一已归档\n`;
  const lost = checkDecisionEntries(`## D-20261116-probe\n\n${LIFECYCLE("待验收")}\n`, {
    previous,
  });
  assert.match(lost.errors.join("\n"), /的「完成」行从 1 条变成 0 条/u);

  const rewritten = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("待验收")}\n- 完成：批次一已归档并补齐证据\n`,
    { previous },
  );
  assert.equal(rewritten.errors.join("\n"), "");

  const dropped = checkDecisionEntries(`## D-20261116-other\n\n${LIFECYCLE("待验收")}\n`, {
    previous,
  });
  assert.match(dropped.errors.join("\n"), /带历史记录却被整条删除/u);
});

test("an entry past the decision stage points at its batch", () => {
  const missing = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("执行中").replace("- 批次：changes/stage-probe", "- 找到了：改了三处")}`,
  );
  assert.match(missing.errors.join("\n"), /没有批次指针/u);
});

test("an entry only carries the four allowed fields", () => {
  const extra = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("执行中").replace(
      "- **结构**：无",
      "- **结构**：无\n- **状态**：待定",
    )}`,
  );
  assert.match(extra.errors.join("\n"), /字段「状态」不在允许列表/u);
});

test("a wrong stage mark hides the entry, so the gate rejects it", () => {
  const text = `## D-20261116-probe\n\n${LIFECYCLE("决策中")}`;
  const wrong = checkDecisionEntries(text.replace("## D-20261116-probe", "## 💬 D-20261116-probe"));
  assert.match(wrong.errors.join("\n"), /阶段标记只能是/u);
  const fine = checkDecisionEntries(`## ⏳ D-20261116-probe\n\n${LIFECYCLE("决策中")}`);
  assert.deepEqual(fine.errors, []);
});

test("a decision entry must come from the user, not from the agent", () => {
  const agentSourced = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("执行中").replace(
      "- **来源**：用户 2026-11-16 要求做探针",
      "- **来源**：维护者判断",
    )}`,
  );
  assert.match(agentSourced.errors.join("\n"), /不是用户指令/u);

  const noSource = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("执行中").replace("- **来源**：用户 2026-11-16 要求做探针\n", "")}`,
  );
  assert.match(noSource.errors.join("\n"), /缺少「\*\*来源\*\*：…」/u);

  const noConfirmation = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("执行中").replace("（用户确认：2026-11-16）", "")}`,
  );
  assert.match(noConfirmation.errors.join("\n"), /没有写用户确认/u);

  const quoted = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("执行中").replace(
      "（用户确认：2026-11-16）",
      "（用户原话：「就按这个做，可以开始执行」，2026-11-16）",
    )}`,
  );
  assert.equal(quoted.errors.join("\n"), "");

  const shortQuote = checkDecisionEntries(
    `## D-20261116-probe\n\n${LIFECYCLE("执行中").replace(
      "（用户确认：2026-11-16）",
      "（用户原话：「可以」，2026-11-16）",
    )}`,
  );
  assert.match(shortQuote.errors.join("\n"), /没有写用户确认/u);
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

test("a pending acceptance is a notice, not a lock on new work", () =>
  withRoot((holder) => {
    const root = makeRoot(holder, { change: false });
    write(
      root,
      "docs/DECISIONS.md",
      `# DECISIONS\n\n${HEADER}\n## D-20261116-awaiting 等待验收\n\n${LIFECYCLE("待验收", "changes/first-cut")}`,
    );

    const quiet = checkPlan(root, { skipSpecValidation: true });
    assert.deepEqual(quiet.errors, []);
    assert.match(quiet.notices.join("\n"), /待验收 1 项/u);

    // Decisions park thinking; they must not stop the next cut from opening.
    const change = "openspec/changes/second-cut";
    write(root, `${change}/proposal.md`, `# proposal\n\nPlan: ${BOARD}\n\n## 本轮内容\n\n- 验证\n`);
    write(
      root,
      `${change}/design.md`,
      "# design\n\n## 用户可观察的改变\n\n- x\n\n## 手测步骤\n\n1. x\n\n## 用户决策\n\n- 无\n",
    );
    write(root, `${change}/tasks.md`, "# tasks\n\n- [ ] 第一项\n");
    const stillOpen = checkPlan(root, { skipSpecValidation: true });
    assert.deepEqual(stillOpen.errors, []);
    assert.match(stillOpen.notices.join("\n"), /不限制新的变更/u);
  }));

test("governance vocabulary in docs is a pointer notice, not a rule copy", () => {
  const diff = [
    "diff --git a/docs/STATUS.md b/docs/STATUS.md",
    "+++ b/docs/STATUS.md",
    "@@ -1 +1,2 @@",
    "+## 治理机制记录",
    "+规则见 governance/README.md",
    "diff --git a/docs/DECISIONS.md b/docs/DECISIONS.md",
    "+++ b/docs/DECISIONS.md",
    "@@ -1 +1,2 @@",
    "+治理规则条目：决策中只写决策层",
    "diff --git a/apps/desktop/src/app.ts b/apps/desktop/src/app.ts",
    "+++ b/apps/desktop/src/app.ts",
    "@@ -1 +1,2 @@",
    "+// 治理机制",
  ].join("\n");

  const hits = findGovernanceWordsInDocs(diff);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, "docs/STATUS.md");
  assert.equal(hits[0].word, "治理机制");
});

test("the governance core keeps project names and repo paths out", () => {
  const clean = findCoreBoundaryProblems([
    {
      name: "governance/core/entries.mjs",
      text: "export function readEntry(text, id) {\n  return [text, id];\n}",
    },
  ]);
  assert.deepEqual(clean, []);
  const dirty = findCoreBoundaryProblems([
    {
      name: "governance/core/packs.mjs",
      text: "const file = 'docs/STATUS.md';\n// Noema 专用\n",
    },
  ]);
  assert.equal(dirty.length, 2);
  assert.match(dirty.map((item) => item.why).join("\n"), /仓库文档路径/u);
  assert.match(dirty.map((item) => item.why).join("\n"), /Noema 专名/u);
});


test("change scope tells behavior work from free execution", () => {
  const free = changeScope(["docs/PRODUCT.md", "apps/desktop/test/main/chat/a.test.mjs"]);
  assert.equal(free.scope, "自由执行路径");
  assert.match(free.notice, /不需要条目与阶段/u);

  const behavior = changeScope(["apps/desktop/src/main/main.ts"]);
  assert.equal(behavior.scope, "行为路径");
  assert.match(behavior.notice, /产品行为 1 个文件/u);
  assert.match(behavior.notice, /活动变更与规格增量/u);

  const records = changeScope(["docs/DECISIONS.md", "governance/data/decisions.json"]);
  assert.equal(records.scope, "自由执行路径");
  assert.match(records.notice, /只经 npm run governance -- record\|move 写入/u);

  assert.equal(changeScope([]), null);
});
