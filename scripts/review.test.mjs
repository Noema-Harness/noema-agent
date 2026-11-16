import test from "node:test";
import assert from "node:assert/strict";
import { formatReview, summarizeReview } from "./review.mjs";

const ENTRY = (id, stage, extra = "") =>
  [
    `## ${id} 一个议题`,
    "",
    "**状态**：决定",
    "**形态**：轮次",
    `**阶段**：${stage}`,
    "**看板**：无",
    "**来源**：用户反馈",
    `**阻塞**：${extra || "无"}`,
    "",
    "#### 1 决策（执行前，可重开）",
    "- 结论：已定（用户确认：2026-11-16）",
    "",
    "#### 2 执行（执行中）",
    "- 批次：changes/demo",
    "",
    "#### 3 验收（立项时写 v0，交付前复核更新）",
    "- 项：可见 — 手测 — 待验收",
    "",
  ].join("\n");

test("summarizeReview groups entries by lifecycle stage", () => {
  const text = [
    ENTRY("D-20261116-a", "决策中").replace("**状态**：决定", "**状态**：待定"),
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
  assert.match(output, /^需要你决定（0）/u);
  assert.match(output, /待你验收（1）/u);
  assert.match(output, /D-20261116-a 一个议题/u);
  assert.match(output, /已收口 1 条/u);
  assert.doesNotMatch(output, /D-20261116-b 一个议题/u);
});
