import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  changeScope,
  checkDocuments,
  checkPrecommit,
  findCoreBoundaryProblems,
  findGovernanceWordsInDocs,
  localToday,
} from "./maintenance.mjs";
import { emptyState, setScope, startSession } from "../governance/core/state.mjs";

const gitOk = (args) => {
  if (args.join(" ").includes("core.hooksPath")) return { ok: true, text: ".githooks\n" };
  return { ok: true, text: "" };
};

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "noema-maintenance-"));
}

function write(root, name, text) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function writeState(root, text = "把状态面板做出来") {
  const now = new Date("2026-11-20T10:00:00+08:00");
  let doc = emptyState(now);
  if (text) {
    doc = startSession(doc, { title: "把状态面板做出来", now }).doc;
    setScope(doc, { text, kind: "里程碑", now });
  }
  write(root, "governance/data/state.json", JSON.stringify(doc, null, 2));
}

function gitFixture() {
  return (args) => {
    if (args.join(" ").includes("core.hooksPath")) return { ok: true, text: ".githooks\n" };
    return { ok: true, text: "" };
  };
}

test("governance words in docs diff stay a pointer notice", () => {
  const diff = [
    "diff --git a/docs/STATUS.md b/docs/STATUS.md",
    "--- a/docs/STATUS.md",
    "+++ b/docs/STATUS.md",
    "+约束：拿不准时先看门槛的定义。",
    "+无关的一行",
  ].join("\n");
  const hits = findGovernanceWordsInDocs(diff);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, "docs/STATUS.md");
  assert.equal(hits[0].word, "门槛");
});

test("the governance core keeps project names and repo paths out", () => {
  const root = tempRoot();
  write(root, "governance/core/clean.mjs", 'export const name = "state";\n');
  write(root, "governance/core/leaky.mjs", 'const p = "docs/STATUS.md";\n// Noema 专用\n');
  const problems = findCoreBoundaryProblems([
    { name: "governance/core/clean.mjs", text: 'export const name = "state";\n' },
    {
      name: "governance/core/leaky.mjs",
      text: 'const p = "docs/STATUS.md";\n// Noema 专用\n',
    },
  ]);
  assert.equal(problems.length, 2);
  assert.ok(problems.every((problem) => problem.name.includes("leaky.mjs")));
});

test("change scope tells behavior work from free execution", () => {
  assert.equal(changeScope([]), null);

  const behavior = changeScope(["apps/desktop/src/renderer/x.tsx", "docs/STATUS.md"]);
  assert.equal(behavior.scope, "行为路径");
  assert.match(behavior.notice, /产品行为 1 个文件/u);

  const free = changeScope(["scripts/figure.mjs"]);
  assert.equal(free.scope, "自由执行路径");
  assert.match(free.notice, /自由执行/u);
});

test("check documents reads the registered set and their headers", () => {
  const root = tempRoot();
  write(
    root,
    "scripts/workspace.config.json",
    JSON.stringify({ currentDocuments: ["docs/PRODUCT.md", "docs/STATUS.md"] }),
  );
  write(root, "package.json", JSON.stringify({ version: "0.1.0" }));
  write(root, "apps/desktop/package.json", JSON.stringify({ version: "0.1.0" }));
  write(
    root,
    "docs/PRODUCT.md",
    "# PRODUCT\n\nAuthority: 产品事实。\nUpdate when: 定位变化。\nDoes not own: 结构。\n",
  );
  write(root, ".githooks/pre-commit", "#!/bin/sh\nexit 0\n");
  writeState(root);
  write(
    root,
    "docs/STATUS.md",
    "# STATUS\n\nAuthority: 现状。\nUpdate when: 每次交付。\nDoes not own: 命令。\n\n源码版本：`0.1.0`\n当前源码基线：`abcdef1`\n最后更新：2026-11-20\n",
  );

  const clean = checkDocuments(root, gitOk);
  assert.deepEqual(clean.errors, []);

  write(root, "docs/PRODUCT.md", "# PRODUCT\n\n没有任何文档头。\n");
  const missingHeader = checkDocuments(root, gitOk);
  assert.ok(missingHeader.errors.some((error) => error.includes("缺少文档头 Authority:")));

  write(root, "docs/EXTRA.md", "# EXTRA\n");
  const unregistered = checkDocuments(root, gitOk);
  assert.ok(unregistered.errors.some((error) => error.includes("未登记文档 docs/EXTRA.md")));
});

test("precommit reports the change path and the docs result", () => {
  const root = tempRoot();
  write(
    root,
    "scripts/workspace.config.json",
    JSON.stringify({ currentDocuments: ["docs/PRODUCT.md", "docs/STATUS.md"] }),
  );
  write(root, "package.json", JSON.stringify({ version: "0.1.0" }));
  write(root, "apps/desktop/package.json", JSON.stringify({ version: "0.1.0" }));
  write(
    root,
    "docs/PRODUCT.md",
    "# PRODUCT\n\nAuthority: 产品事实。\nUpdate when: 定位变化。\nDoes not own: 结构。\n",
  );
  write(root, ".githooks/pre-commit", "#!/bin/sh\nexit 0\n");
  writeState(root);
  write(
    root,
    "docs/STATUS.md",
    "# STATUS\n\nAuthority: 现状。\nUpdate when: 每次交付。\nDoes not own: 命令。\n\n源码版本：`0.1.0`\n当前源码基线：`abcdef1`\n最后更新：2026-11-20\n",
  );

  const git = gitFixture();
  const result = checkPrecommit(root, {
    git,
    stagedPaths: ["apps/desktop/src/renderer/x.tsx", "docs/STATUS.md"],
  });
  assert.deepEqual(result.errors, []);
  assert.ok(result.notices.some((notice) => notice.includes("行为路径")));
  assert.equal(localToday(new Date("2026-11-20T10:00:00+08:00")), "2026-11-20");
});

test("product code without a scope is refused and state must be readable", () => {
  const root = tempRoot();
  write(
    root,
    "scripts/workspace.config.json",
    JSON.stringify({ currentDocuments: ["docs/PRODUCT.md", "docs/STATUS.md"] }),
  );
  write(root, "package.json", JSON.stringify({ version: "0.1.0" }));
  write(root, "apps/desktop/package.json", JSON.stringify({ version: "0.1.0" }));
  write(
    root,
    "docs/PRODUCT.md",
    "# PRODUCT\n\nAuthority: 产品事实。\nUpdate when: 定位变化。\nDoes not own: 结构。\n",
  );
  write(root, ".githooks/pre-commit", "#!/bin/sh\nexit 0\n");
  write(
    root,
    "docs/STATUS.md",
    "# STATUS\n\nAuthority: 现状。\nUpdate when: 每次交付。\nDoes not own: 命令。\n\n源码版本：`0.1.0`\n当前源码基线：`abcdef1`\n最后更新：2026-11-20\n",
  );

  const git = gitFixture();
  const noState = checkPrecommit(root, {
    git,
    stagedPaths: ["apps/desktop/src/renderer/x.tsx"],
  });
  assert.ok(noState.errors.some((error) => error.includes("缺少 governance/data/state.json")));

  writeState(root, "");
  const noScope = checkPrecommit(root, {
    git,
    stagedPaths: ["apps/desktop/src/renderer/x.tsx"],
  });
  assert.ok(noScope.errors.some((error) => error.includes("产品行为 1 个文件没有范围")));

  writeState(root);
  const withScope = checkPrecommit(root, {
    git,
    stagedPaths: ["apps/desktop/src/renderer/x.tsx"],
  });
  assert.deepEqual(withScope.errors, []);
  assert.ok(withScope.notices.some((notice) => notice.includes("把状态面板做出来")));
});
