import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { draftEntry, acceptEntry, main } from "./decision-entry.mjs";
import { localToday } from "./maintenance.mjs";

const NOW = new Date("2026-11-18T09:00:00+08:00");
const DATE = localToday(NOW);
const SLUG = "demo";
const ID = `D-${DATE.replaceAll("-", "")}-${SLUG}`;
const APPROVAL = "没问题，本项可以执行";

const BODY = (decisionLines = ["- 要定：先问用户"]) =>
  [
    "- **阶段**：决策中",
    "- **来源**：用户 2026-11-18 要求先把这件事定下来",
    "- **阻塞**：等用户",
    "",
    "#### 1 决策",
    ...decisionLines,
    "",
    "#### 2 执行",
    "- 未开始：定案后立项。",
    "",
    "#### 3 验收",
    "- 未开始：定案后写验收项。",
    "",
  ].join("\n");

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "noema-decision-entry-"));
  mkdirSync(path.join(root, "docs"), { recursive: true });
  writeFileSync(path.join(root, "docs", "DECISIONS.md"), "# DECISIONS\n", "utf8");
  const bodyPath = path.join(root, "body.md");
  writeFileSync(bodyPath, BODY(), "utf8");
  return { root, bodyPath, decisions: path.join(root, "docs", "DECISIONS.md") };
}

test("the accept command takes the entry id as a positional argument", () => {
  const { root, bodyPath, decisions } = makeRoot();
  draftEntry({ root, title: "示例议题", slug: SLUG, body: readFileSync(bodyPath, "utf8"), now: NOW });
  const message = main(["accept", ID, "--approval", APPROVAL], root);
  assert.match(message, /已落库/u);
  assert.match(readFileSync(decisions, "utf8"), new RegExp(`## ⏳ ${ID}`, "u"));
});

test("draft writes a draft and leaves DECISIONS untouched", () => {
  const { root, bodyPath } = makeRoot();
  const before = readFileSync(path.join(root, "docs", "DECISIONS.md"), "utf8");
  const result = draftEntry({ root, title: "示例议题", slug: SLUG, body: readFileSync(bodyPath, "utf8"), now: NOW });
  assert.equal(result.id, ID);
  assert.match(result.question, /是否已得到用户明确批准/u);
  assert.ok(existsSync(result.draftPath));
  assert.equal(readFileSync(path.join(root, "docs", "DECISIONS.md"), "utf8"), before);
  assert.match(readFileSync(result.draftPath, "utf8"), /未落库/u);
});

test("draft refuses a slug that would break the entry id", () => {
  const { root, bodyPath } = makeRoot();
  assert.throws(
    () => draftEntry({ root, title: "示例", slug: "中文", body: readFileSync(bodyPath, "utf8"), now: NOW }),
    /--slug/u,
  );
});

test("accept without an approval quote refuses to write", () => {
  const { root, bodyPath } = makeRoot();
  draftEntry({ root, title: "示例议题", slug: SLUG, body: readFileSync(bodyPath, "utf8"), now: NOW });
  assert.throws(() => acceptEntry({ root, id: ID, approval: "", now: NOW }), /--approval/u);
  assert.doesNotMatch(readFileSync(path.join(root, "docs", "DECISIONS.md"), "utf8"), new RegExp(ID, "u"));
});

test("accept refuses a quote too short to be the user's words", () => {
  const { root, bodyPath } = makeRoot();
  draftEntry({ root, title: "示例议题", slug: SLUG, body: readFileSync(bodyPath, "utf8"), now: NOW });
  assert.throws(() => acceptEntry({ root, id: ID, approval: "可以", now: NOW }), /太短/u);
});

test("accept writes the entry with the approval quote in its source line", () => {
  const { root, bodyPath, decisions } = makeRoot();
  draftEntry({ root, title: "示例议题", slug: SLUG, body: readFileSync(bodyPath, "utf8"), now: NOW });
  const result = acceptEntry({ root, id: ID, approval: APPROVAL, now: NOW });
  assert.equal(result.id, ID);
  const text = readFileSync(decisions, "utf8");
  assert.match(text, new RegExp(`^## ⏳ ${ID} 示例议题`, "mu"));
  assert.match(text, new RegExp(`用户原话：「${APPROVAL}」`, "u"));
  assert.match(text, new RegExp(`，${DATE}）`, "u"));
  assert.equal(existsSync(path.join(root, ".work", "decisions-draft", `${ID}.md`)), false);
});

test("accept refuses a draft that fails the entry gate and keeps the draft", () => {
  const { root, bodyPath, decisions } = makeRoot();
  writeFileSync(bodyPath, BODY([]), "utf8");
  draftEntry({ root, title: "示例议题", slug: SLUG, body: readFileSync(bodyPath, "utf8"), now: NOW });
  assert.throws(() => acceptEntry({ root, id: ID, approval: APPROVAL, now: NOW }), /校验失败/u);
  assert.doesNotMatch(readFileSync(decisions, "utf8"), new RegExp(ID, "u"));
  assert.ok(existsSync(path.join(root, ".work", "decisions-draft", `${ID}.md`)));
});

test("the CLI asks for approval instead of writing the entry", () => {
  const { root, bodyPath, decisions } = makeRoot();
  const output = main(
    ["draft", "--title", "示例议题", "--slug", SLUG, "--body", bodyPath],
    root,
  );
  assert.match(output, /草稿已写入/u);
  assert.match(output, /确认问题：本次条目创建是否已得到用户明确批准/u);
  assert.doesNotMatch(readFileSync(decisions, "utf8"), new RegExp(ID, "u"));
});