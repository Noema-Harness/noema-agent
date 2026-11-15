import test from "node:test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  activeChanges,
  checkDocuments,
  checkMilestone,
  checkPlan,
  checkPrecommit,
  localToday,
  pendingDecisions,
} from "./maintenance.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const DOCS = ["PRODUCT.md", "ARCHITECTURE.md", "DECISIONS.md", "OPERATIONS.md", "STATUS.md"];
const HEADER = "Authority: 测试\nUpdate when: 测试\nDoes not own: 测试\n";
const TODAY = localToday();
const BOARD = "https://github.com/orgs/Noema-Harness/projects/1";

function fakeGit({ baseline = true, hooksPath = ".githooks", dirty = false } = {}) {
  return (args) => {
    if (args[0] === "merge-base") return { ok: baseline, text: "" };
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
    ".codex/workspace.json",
    JSON.stringify({
      currentDocuments: DOCS.map((name) => ({ path: `docs/${name}` })),
    }),
  );
  for (const name of DOCS) write(root, `docs/${name}`, `# ${name}\n\n${HEADER}`);
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
      `# design\n\n## 待用户决定\n\n${overrides.decisions ?? ""}\n`,
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
    const localHookErrors = checkDocuments(root, fakeGit({ hooksPath: "" })).errors;
    const ciErrors = checkDocuments(root, fakeGit({ hooksPath: "" }), { ci: true }).errors;
    assert.equal(ciErrors.length, localHookErrors.length - 1);
    assert.ok(!ciErrors.some((error) => /core\.hooksPath/u.test(error)));

    // The document gate must be installed as a real git hook.
    assert.match(
      checkDocuments(root, fakeGit({ hooksPath: "" })).errors.join("\n"),
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

    // Undefined product decisions block product code from being committed.
    write(
      root,
      `${change}/design.md`,
      "# design\n\n## 待用户决定\n\n- [ ] 成长机制如何触发\n- [ ] 团队命名规则\n\n## 其他\n",
    );
    assert.deepEqual(
      pendingDecisions(fs.readFileSync(path.join(root, change, "design.md"), "utf8")),
      ["成长机制如何触发", "团队命名规则"],
    );
    const blocked = checkPrecommit(root, { git, stagedPaths: ["apps/desktop/src/main/main.ts"] });
    assert.match(blocked.errors.join("\n"), /必须同时更新 docs\/ 或 openspec\/changes\//u);
    assert.match(blocked.errors.join("\n"), /仍有待用户决定的问题/u);

    // Code ships only with a plan update and no open decision.
    write(root, `${change}/design.md`, "# design\n\n## 待用户决定\n");
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

test("pending decisions are capped and user acceptance needs a confirmation date", () =>
  withRoot((holder) => {
    const root = makeRoot(holder);
    const change = "openspec/changes/stage-probe";

    write(
      root,
      `${change}/design.md`,
      "# design\n\n## 待用户决定\n\n- [ ] 一\n- [ ] 二\n- [ ] 三\n- [ ] 四\n",
    );
    assert.match(
      checkPlan(root, { skipSpecValidation: true }).errors.join("\n"),
      /待用户决定 4 项，超过每轮 3 项的上限/u,
    );

    write(
      root,
      `${change}/design.md`,
      "# design\n\n## 待用户决定\n\n- [ ] 一\n- [ ] 二\n- [ ] 三\n",
    );
    assert.deepEqual(checkPlan(root, { skipSpecValidation: true }).errors, []);

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

    write(root, `${change}/tasks.md`, "# tasks\n\n- [x] 第一项\n");
    write(root, `${change}/design.md`, "# design\n\n## 待用户决定\n\n- [ ] 还没答\n");
    const decided = checkMilestone(root, { git: fakeGit(), today: TODAY });
    assert.match(decided.errors.join("\n"), /还有 1 项待用户决定/u);
    assert.match(decided.errors.join("\n"), /没有 specs 增量/u);

    write(root, `${change}/design.md`, "# design\n\n## 待用户决定\n");
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

test("unanswered decisions block product code but not tooling maintenance", () =>
  withRoot((holder) => {
    const root = makeRoot(holder, {
      decisions: "- [ ] 成长机制如何触发\n",
      skipSpecs: true,
    });
    const git = fakeGit();

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
    assert.match(product.errors.join("\n"), /仍有待用户决定的问题/u);

    write(root, "openspec/changes/stage-probe/design.md", "# design\n\n## 待用户决定\n");
    const behaviour = checkPrecommit(root, {
      git,
      stagedPaths: ["apps/desktop/src/main/main.ts", "openspec/changes/stage-probe/tasks.md"],
    });
    assert.match(behaviour.errors.join("\n"), /标记了 skip_specs，但这次提交含产品代码/u);
  }));
