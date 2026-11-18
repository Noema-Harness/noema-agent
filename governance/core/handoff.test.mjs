import assert from "node:assert/strict";
import test from "node:test";
import { buildHandoffPage, buildReportPage, handoffFacts } from "./handoff.mjs";

const entry = {
  id: "D-20261118-probe",
  title: "探针",
  stage: "待验收",
  decisionText: [
    "- **E1 执行段进入条件**：决定行已确认。（2026-11-18，原话「1、确认。」）",
    "- 决定：做探针（用户确认：2026-11-18）",
  ].join("\n"),
  executionText: ["- 批次：`changes/probe`（commit abc123）", "- 完成：批次一已归档"].join("\n"),
  acceptanceText: [
    "- [x] [机制] E1 跑通",
    "- [ ] [用户] E2 看一眼",
    "- [ ] [未验证] E3 真机没跑",
    "- 重开：验收发现 E3 未落地（2026-11-19）",
  ].join("\n"),
};

test("handoff facts pull batches, completions, open steps and risks from the entry", () => {
  const facts = handoffFacts(entry);
  assert.deepEqual(facts.batches, ["`changes/probe`（commit abc123）"]);
  assert.deepEqual(facts.completions, ["批次一已归档"]);
  assert.equal(facts.open.length, 2);
  assert.deepEqual(
    facts.unverified.map((item) => item.text),
    ["[未验证] E3 真机没跑"],
  );
  assert.deepEqual(facts.risks, ["验收发现 E3 未落地（2026-11-19）"]);
});

test("the handoff page keeps every template section and lists the open steps", () => {
  const text = buildHandoffPage({ entry, today: "2026-11-19" });
  for (const heading of [
    "## 触发",
    "## 结构",
    "## 交付物",
    "## 证据索引",
    "## 未验证项",
    "## 已知风险",
    "## 验收步骤（≤15 分钟）",
    "## 回退方式",
    "## 生成方式",
    "## 判据",
  ]) {
    assert.match(text, new RegExp(`^${heading}$`, "mu"));
  }
  assert.match(text, /批次一已归档/u);
  assert.match(text, /\[用户\] E2 看一眼/u);
});

test("the report page carries the checklist, approvals and open items", () => {
  const text = buildReportPage({ entry, today: "2026-11-19" });
  assert.match(text, /- \[x\] \[机制\] E1 跑通/u);
  assert.match(text, /- \[ \] \[未验证\] E3 真机没跑/u);
  assert.match(text, /E1 执行段进入条件：决定行已确认/u);
  assert.match(text, /用户确认日期：2026-11-18/u);
  assert.match(text, /未收口：还有 2 条验收项没勾选/u);
});
