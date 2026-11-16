import assert from "node:assert/strict";
import test from "node:test";
import { checkDecisionEntries } from "./maintenance.mjs";
import { syncDecisions } from "./decisions.mjs";

const entry = (
  stage,
  acceptance,
) => `## ${stage === "已收口" ? "✅" : "🔍"} D-20261116-probe 探针条目

- **阶段**：${stage}
- **阻塞**：无

#### 1 决策

- 决定：x（2026-11-16）

#### 2 执行

- 批次：changes/probe

#### 3 验收

${acceptance}
`;

test("sync closes an entry once every acceptance item is ticked", () => {
  const before = entry("待验收", "- [x] 跑一下 `npm run review`\n- [x] 看输出");
  const { text, changes } = syncDecisions(before, "2026-11-17");
  assert.equal(changes.length, 1);
  assert.match(text, /^## ✅ D-20261116-probe/u);
  assert.match(text, /- \*\*阶段\*\*：已收口/u);
  assert.match(text, /- 用户确认：2026-11-17/u);
});

test("sync leaves a partially accepted entry alone", () => {
  const before = entry("待验收", "- [x] 跑一下 `npm run review`\n- [ ] 看输出");
  const { text, changes } = syncDecisions(before, "2026-11-17");
  assert.equal(changes.length, 0);
  assert.equal(text, before);
});

test("the gate asks for sync when the boxes and the stage disagree", () => {
  const allTicked = checkDecisionEntries(entry("待验收", "- [x] a"));
  assert.match(
    allTicked.errors.join("\n"),
    /验收项已全部勾选，阶段还是待验收：运行 npm run decisions:sync 收口/u,
  );

  const closedWithOpenBox = checkDecisionEntries(
    entry("已收口", "- [ ] a\n- 用户确认：2026-11-16"),
  );
  assert.match(closedWithOpenBox.errors.join("\n"), /已收口，但还有 1 个验收项没勾选/u);
});
