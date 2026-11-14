import test from "node:test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { activeChanges, checkDocuments, checkPlan, checkPrecommit, pendingDecisions } from "./maintenance.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const DOCS = ["PRODUCT.md", "ARCHITECTURE.md", "DECISIONS.md", "OPERATIONS.md", "STATUS.md"];
const HEADER = "Authority: 测试\nUpdate when: 测试\nDoes not own: 测试\n";

function fakeGit({ baseline = true, hooksPath = ".githooks" } = {}) {
  return (args) => {
    if (args[0] === "merge-base") return { ok: baseline, text: "" };
    if (args[0] === "config") return { ok: true, text: `${hooksPath}\n` };
    return { ok: true, text: "" };
  };
}

function makeRoot(holder, overrides = {}) {
  const root = path.join(holder, "repository");
  for (const directory of ["docs", ".codex", ".githooks", "openspec/changes", "openspec/specs/example"])
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".codex", "workspace.json"),
    JSON.stringify({ currentDocuments: DOCS.map((name) => ({ path: `docs/${name}` })) }),
  );
  for (const name of DOCS) fs.writeFileSync(path.join(root, "docs", name), `# ${name}\n\n${HEADER}`);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.7.6" }));
  fs.mkdirSync(path.join(root, "apps", "desktop"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "apps", "desktop", "package.json"),
    JSON.stringify({ version: "0.7.6" }),
  );
  fs.writeFileSync(
    path.join(root, "docs", "STATUS.md"),
    `# STATUS\n\n${HEADER}\n源码版本：\`${overrides.version ?? "0.7.6"}\`\n\n当前源码基线：\`f592a9b\`\n\n最后更新：2026-11-15\n`,
  );
  fs.writeFileSync(path.join(root, ".githooks", "pre-commit"), "#!/bin/sh\n");
  fs.writeFileSync(
    path.join(root, "openspec", "config.yaml"),
    "context: 见 docs/STATUS.md 与 docs/PRODUCT.md\n",
  );
  if (overrides.change !== false) {
    const change = path.join(root, "openspec", "changes", "stage-probe");
    fs.mkdirSync(change, { recursive: true });
    fs.writeFileSync(path.join(change, "proposal.md"), "# proposal\n");
    fs.writeFileSync(
      path.join(change, "design.md"),
      `# design\n\n## 待用户决定\n\n${overrides.decisions ?? ""}\n`,
    );
    fs.writeFileSync(path.join(change, "tasks.md"), `# tasks\n\n- [ ] 第一项\n`);
  }
  return root;
}

test("maintenance tooling enforces document, plan and commit gates", () => {
  const runs = path.join(repositoryRoot, ".work", "runs");
  fs.mkdirSync(runs, { recursive: true });
  const holder = fs.mkdtempSync(path.join(runs, "maintenance-tooling-"));
  try {
    const root = makeRoot(holder);
    const git = fakeGit();
    assert.deepEqual(checkDocuments(root, git).errors, []);
    assert.deepEqual(checkPlan(root, { skipSpecValidation: true }).errors, []);
    assert.equal(activeChanges(root).length, 1);

    // A shipped version that left STATUS behind must fail the gate.
    fs.writeFileSync(
      path.join(root, "docs", "STATUS.md"),
      `# STATUS\n\n${HEADER}\n源码版本：\`0.7.3\`\n\n当前源码基线：\`f592a9b\`\n\n最后更新：2026-11-15\n`,
    );
    assert.match(
      checkDocuments(root, git).errors.join("\n"),
      /源码版本 0.7.3 与 package.json 0.7.6 不一致/u,
    );
    fs.writeFileSync(
      path.join(root, "docs", "STATUS.md"),
      `# STATUS\n\n${HEADER}\n源码版本：\`0.7.6\`\n\n当前源码基线：\`f592a9b\`\n\n最后更新：2026-11-15\n`,
    );

    // An unregistered document is a second source of truth.
    fs.writeFileSync(path.join(root, "docs", "NOTES.md"), "# notes\n");
    assert.match(checkDocuments(root, git).errors.join("\n"), /未登记文档 docs\/NOTES.md/u);
    fs.rmSync(path.join(root, "docs", "NOTES.md"));

    // Removing a header drops the ownership contract.
    fs.writeFileSync(path.join(root, "docs", "OPERATIONS.md"), "# OPERATIONS\n");
    assert.match(checkDocuments(root, git).errors.join("\n"), /缺少文档头 Authority:/u);
    fs.writeFileSync(path.join(root, "docs", "OPERATIONS.md"), `# OPERATIONS\n\n${HEADER}`);

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
    fs.writeFileSync(
      path.join(root, "openspec", "config.yaml"),
      "context: 见 docs/CURRENT_CONTEXT.md\n",
    );
    assert.match(
      checkDocuments(root, git).errors.join("\n"),
      /引用了不存在的文档 docs\/CURRENT_CONTEXT.md/u,
    );
    fs.writeFileSync(path.join(root, "openspec", "config.yaml"), "context: 见 docs/STATUS.md\n");

    // Only one planned stage at a time.
    const second = path.join(root, "openspec", "changes", "stage-two");
    fs.mkdirSync(second, { recursive: true });
    for (const name of ["proposal.md", "design.md", "tasks.md"])
      fs.writeFileSync(path.join(second, name), "# probe\n");
    assert.match(checkPlan(root, { skipSpecValidation: true }).errors.join("\n"), /必须至多 1 个/u);
    fs.rmSync(second, { recursive: true });

    // A finished task list no longer guides development.
    const change = path.join(root, "openspec", "changes", "stage-probe");
    fs.writeFileSync(path.join(change, "tasks.md"), "# tasks\n\n- [x] 第一项\n");
    assert.match(
      checkPlan(root, { skipSpecValidation: true }).errors.join("\n"),
      /全部任务已完成/u,
    );
    fs.writeFileSync(path.join(change, "tasks.md"), "# tasks\n\n- [ ] 第一项\n- [ ] 第二项\n");
    assert.equal(
      checkPlan(root, { skipSpecValidation: true }).notices.join("\n").includes("0 完成 / 2 未完成"),
      true,
    );

    // Undefined product decisions block code from being committed.
    fs.writeFileSync(
      path.join(change, "design.md"),
      "# design\n\n## 待用户决定\n\n- [ ] 成长机制如何触发\n- [ ] 团队命名规则\n\n## 其他\n",
    );
    assert.deepEqual(pendingDecisions(fs.readFileSync(path.join(change, "design.md"), "utf8")), [
      "成长机制如何触发",
      "团队命名规则",
    ]);
    const blocked = checkPrecommit(root, {
      git,
      stagedPaths: ["apps/desktop/src/main/main.ts"],
    });
    assert.match(blocked.errors.join("\n"), /必须同时更新 docs\/ 或 openspec\/changes\//u);
    assert.match(blocked.errors.join("\n"), /仍有待用户决定的问题/u);

    // Code ships only with a plan update and no open decision.
    fs.writeFileSync(path.join(change, "design.md"), "# design\n\n## 待用户决定\n");
    const committed = checkPrecommit(root, {
      git,
      stagedPaths: ["apps/desktop/src/main/main.ts", `openspec/changes/stage-probe/tasks.md`],
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
  } finally {
    fs.rmSync(holder, { recursive: true });
  }
});
