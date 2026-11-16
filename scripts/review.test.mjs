import test from "node:test";
import assert from "node:assert/strict";
import { formatReview, summarizeReview } from "./review.mjs";

const ENTRY = (id, stage, extra = "") =>
  [
    `## ${id} 一个议题`,
    "",
    `- **阶段**：${stage}`,
    "- **来源**：用户反馈",
    `- **阻塞**：${extra || "无"}`,
    "",
    "#### 1 决策",
    stage === "决策中" ? "- 要定：先问用户" : "- 决定：已定（用户确认：2026-11-16）",
    "",
    "#### 2 执行",
    "- 批次：changes/demo",
    "",
    "#### 3 验收",
    "- 可见 — 手测 — 待验收",
    "",
  ].join("\n");

test("summarizeReview groups entries by lifecycle stage", () => {
  const text = [
    ENTRY("D-20261116-a", "决策中"),
    ENTRY("D-20261116-b", "待验收"),
    ENTRY("D-20261116-c", "执行中"),
    ENTRY("D-20261116-d", "已收口"),
  ].join("\n");
  const groups = summarizeReview(text);
  assert.deepEqual(
    groups.decide.map((item) => item.id),
    ["D-20261116-a"],
  );
  assert.deepEqual(
    groups.accept.map((item) => item.id),
    ["D-20261116-b"],
  );
  assert.deepEqual(
    groups.running.map((item) => item.id),
    ["D-20261116-c"],
  );
  assert.deepEqual(
    groups.closed.map((item) => item.id),
    ["D-20261116-d"],
  );
});

test("formatReview leads with what needs the user and hides closed entries", () => {
  const text = [ENTRY("D-20261116-a", "待验收"), ENTRY("D-20261116-b", "已收口")].join("\n");
  const output = formatReview(summarizeReview(text));
  assert.match(output, /^⏳ 需要你决定（0）/u);
  assert.match(output, /🔍 待你验收（1）/u);
  assert.match(output, /D-20261116-a 一个议题/u);
  assert.match(output, /✅ 已收口 1 条/u);
  assert.doesNotMatch(output, /D-20261116-b 一个议题/u);
});

test("an entry linked to an issue shows the link the user can open", () => {
  const text = [
    "## [#151](https://github.com/Noema-Harness/noema-agent/issues/151) D-20261116-linked 一个议题",
    "",
    "- **阶段**：执行中",
    "",
    "#### 1 决策",
    "- 决定：已定（用户确认：2026-11-16）",
    "",
    "#### 2 执行",
    "- 批次：changes/demo",
    "",
    "#### 3 验收",
    "- 可见 — 手测 — 待验收",
    "",
  ].join("\n");
  const output = formatReview(summarizeReview(text));
  assert.match(output, /D-20261116-linked/u);
  assert.match(output, /issues\/151/u);
});
