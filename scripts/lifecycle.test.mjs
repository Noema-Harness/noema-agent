import test from "node:test";
import assert from "node:assert/strict";

import {
  ALWAYS_GATES,
  REOPEN,
  STATES,
  TRANSITIONS,
  gateFailure,
  isStage,
  nextStage,
  stageIndex,
} from "./lifecycle.mjs";

test("the four stages are unique and ordered by progress", () => {
  assert.deepEqual(STATES, ["决策中", "执行中", "待验收", "已收口"]);
  assert.equal(new Set(STATES).size, 4);
  assert.equal(stageIndex("决策中"), 0);
  assert.equal(stageIndex("已收口"), 3);
  assert.equal(stageIndex("不存在"), -1);
  assert.equal(isStage("待验收"), true);
  assert.equal(isStage("完成"), false);
});

test("every stage but the last has exactly one forward transition", () => {
  for (const stage of STATES.slice(0, -1)) {
    const outgoing = TRANSITIONS.filter((transition) => transition.from === stage);
    assert.equal(outgoing.length, 1, `${stage} should have one forward transition`);
    assert.equal(
      stageIndex(outgoing[0].to),
      stageIndex(stage) + 1,
      `${stage} should advance one stage`,
    );
  }
  // 已收口 is terminal: the only way out is a reopen, not a transition.
  assert.equal(TRANSITIONS.filter((transition) => transition.from === "已收口").length, 0);
  assert.equal(nextStage("已收口"), null);
});

test("a work item is born in 决策中 and the reopen entry points back there", () => {
  const births = TRANSITIONS.filter((transition) => transition.from === null);
  assert.equal(births.length, 1);
  assert.equal(births[0].to, "决策中");
  assert.equal(REOPEN.to, "决策中");
  assert.match(REOPEN.writes, /重开/u);
});

test("every transition names a runnable gate, the document it writes and why it exists", () => {
  for (const transition of TRANSITIONS) {
    const label = transition.from ?? "（创建）";
    assert.match(transition.gate, /^npm run [a-z:]+$/u, `${label} gate must be a command`);
    assert.ok(transition.writes.length > 0, `${label} must say what it writes`);
    assert.ok(transition.event.length > 0, `${label} must say what triggers it`);
  }
});

test("commit-level gates cover the local hook, PR checks and the platform tree", () => {
  const names = ALWAYS_GATES.map((gate) => gate.name);
  assert.deepEqual(names, ["commit", "verify", "platform", "collaboration"]);
  assert.ok(ALWAYS_GATES.every((gate) => gate.where.length > 0));
  assert.ok(ALWAYS_GATES.some((gate) => gate.where.includes("PR")));
});

test("a gate failure says what is wrong, why the rule exists and the next step", () => {
  const text = gateFailure("产品代码没有计划", "计划先于代码，避免事后补文档", "npm run plan:check");
  assert.match(text, /^产品代码没有计划。计划先于代码，避免事后补文档。下一步：npm run plan:check$/u);
});
