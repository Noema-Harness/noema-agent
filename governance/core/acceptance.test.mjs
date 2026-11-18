import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleAcceptance,
  acceptanceItemsOf,
  buildAcceptancePage,
  decisionsOf,
} from "./acceptance.mjs";

const DECISION_TEXT = [
  "- **E1 执行段进入条件**：决定行已确认、开工清单已批准。（2026-11-18，原话「1、确认。」）",
  "- **E2 权威文档只写 Noema 本体**；两处例外。（2026-11-18，原话「我基本都认同，这一点可过」）",
].join("\n");

const ACCEPTANCE_TEXT = [
  "- [x] E1 进执行前必须有三道门槛（机制）",
  "- [ ] E2 用户能指出两处例外（用户）",
].join("\n");

test("decisions carry their approval date and title", () => {
  const decisions = decisionsOf(DECISION_TEXT);
  assert.deepEqual(
    decisions.map((decision) => [decision.id, decision.title, decision.date]),
    [
      ["E1", "执行段进入条件", "2026-11-18"],
      ["E2", "权威文档只写 Noema 本体", "2026-11-18"],
    ],
  );
});

test("acceptance items record their E links and checked state", () => {
  const items = acceptanceItemsOf(ACCEPTANCE_TEXT);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].es, ["E1"]);
  assert.equal(items[0].checked, true);
  assert.deepEqual(items[1].es, ["E2"]);
  assert.equal(items[1].checked, false);
});

test("an E without an acceptance item is reported as uncovered", () => {
  const report = assembleAcceptance({
    decisionText: `${DECISION_TEXT}\n- **E3 新门先 notice**：观察期两个里程碑。（2026-11-18）`,
    acceptanceText: ACCEPTANCE_TEXT,
  });
  assert.deepEqual(report.uncovered, ["E3"]);
  assert.equal(report.unmapped.length, 0);
});

test("a page names the uncovered E instead of claiming completion", () => {
  const { text, report } = buildAcceptancePage({
    entry: {
      id: "D-20261118-probe",
      title: "探针",
      stage: "待验收",
      decisionText: DECISION_TEXT,
      acceptanceText: ACCEPTANCE_TEXT,
    },
    today: "2026-11-19",
  });
  assert.equal(report.uncovered.length, 0);
  assert.match(text, /# 验收页：D-20261118-probe 探针/u);
  assert.match(text, /### E1 执行段进入条件/u);
  assert.match(text, /- \[ \] E2 用户能指出两处例外（用户）/u);
  assert.match(text, /可以移交用户验收：1 条未勾选/u);
});

test("an item without an E id is kept as unmapped", () => {
  const report = assembleAcceptance({
    decisionText: DECISION_TEXT,
    acceptanceText: "- [ ] 界面手测（用户）",
  });
  assert.deepEqual(report.uncovered, ["E1", "E2"]);
  assert.equal(report.unmapped.length, 1);
});
