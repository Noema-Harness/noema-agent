import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { appendRound, readEntry, setStage, settleDecision } from "./entries.mjs";
import { checkTransitionText, templateHeadings } from "./transitions.mjs";
import { checkPackGates, loadPack, resumeCard, activeEntries } from "../../scripts/stage.mjs";
import { advanceEntry, recordRound, settleDecisionItem } from "../../scripts/decision.mjs";
import { checkTransition } from "../../scripts/transition.mjs";
import { checkDecisionEntries } from "../../scripts/maintenance.mjs";

const HEADER = "Authority: 测试\nUpdate when: 测试\nDoes not own: 测试\n";

function entry({ stage = "决策中", waiting = true } = {}) {
  const decided = stage === "决策中" ? [] : ["- 决定：探针方案（用户确认：2026-11-18）"];
  return [
    `## ⏳ D-20261118-probe 探针条目`,
    "",
    `- **阶段**：${stage}`,
    "- **来源**：用户 2026-11-18 要求做探针",
    "- **阻塞**：无",
    "- **结构**：无",
    "",
    "#### 1 决策",
    "",
    "- 要定：两个问题",
    ...decided,
    "",
    "###### 待裁",
    ...(waiting ? ["- T1 第一个问题", "- T2 第二个问题"] : ["- 待裁：无"]),
    "",
    "###### 已定",
    "",
    ...(stage === "决策中" ? [] : ["- **E1 探针**：先做探针。（2026-11-18，原话「批准」）"]),
    "",
    "###### 讨论记录（每轮追加；结论与待裁变化写在这里）",
    "",
    "###### 第 1 轮（2026-11-18）",
    "",
    "  - 结论：待定",
    "  - 待裁变化：+T1 +T2",
    "",
    "#### 2 执行",
    "",
    stage === "决策中" ? "- 未开始：定案后进入执行" : "- 批次：changes/probe",
    "",
    "#### 3 验收",
    "",
    "- 未开始：定案后进入验收",
    "",
  ].join("\n");
}

function text(options) {
  return `# DECISIONS\n\n${HEADER}\n${entry(options)}`;
}

function makeRoot(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-kernel-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "DECISIONS.md"), body, "utf8");
  return root;
}

test("readEntry reads the four blocks and the stage", () => {
  const parsed = readEntry(text(), "D-20261118-probe");
  assert.equal(parsed.stage, "决策中");
  assert.equal(parsed.waits.length, 2);
  assert.match(parsed.waits[0], /T1/u);
  assert.deepEqual(parsed.rounds, [1]);
  assert.equal(parsed.batch, null);
  assert.equal(readEntry(text(), "D-20261118-missing"), null);
});

test("appendRound records a conclusion and a waiting change, keeping the entry valid", () => {
  const next = appendRound(text(), "D-20261118-probe", {
    conclusion: "待定（讨论期第 2 轮）",
    changes: "已解除 T1",
    lines: { date: "2026-11-18", record: ["- 用户：批准 T1", "- 我的判断：T1 可以落"] },
  });
  assert.match(next, /###### 第 2 轮/u);
  assert.match(next, /- 结论：待定（讨论期第 2 轮）/u);
  assert.match(next, /- 待裁变化：已解除 T1/u);
  const parsed = readEntry(next, "D-20261118-probe");
  assert.deepEqual(parsed.rounds, [1, 2]);
  assert.deepEqual(readEntry(next, "D-20261118-probe").waits.length, 2);
});

test("settleDecision moves one waiting item into decided with an E number", () => {
  const next = settleDecision(text(), "D-20261118-probe", {
    number: 3,
    title: "类型分层",
    detail: "T1 按事实与情境分层。",
    approval: "这个可以",
    date: "2026-11-18",
    item: "T1",
  });
  assert.doesNotMatch(next, /- T1 第一个问题/u);
  assert.match(next, /- T2 第二个问题/u);
  assert.match(next, /- \*\*E3 类型分层\*\*：T1 按事实与情境分层。（2026-11-18，原话「这个可以」）/u);
  assert.equal(readEntry(next, "D-20261118-probe").waits.length, 1);
});

test("settleDecision writes the waiting block's placeholder when the last item leaves", () => {
  const once = settleDecision(text(), "D-20261118-probe", {
    number: 3,
    title: "第一个",
    detail: "一。",
    approval: "可以确定",
    date: "2026-11-18",
    item: "T1",
  });
  const twice = settleDecision(once, "D-20261118-probe", {
    number: 4,
    title: "第二个",
    detail: "二。",
    approval: "也可以",
    date: "2026-11-18",
    item: "T2",
  });
  assert.match(twice, /###### 待裁\n\n- 待裁：无/u);
  assert.equal(readEntry(twice, "D-20261118-probe").waits.length, 0);
});

test("setStage swaps the emoji, the stage field and notes the transition", () => {
  const next = setStage(text(), "D-20261118-probe", "执行中", "- 进入执行：2026-11-18");
  assert.match(next, /## 🔧 D-20261118-probe 探针条目/u);
  assert.match(next, /- \*\*阶段\*\*：执行中/u);
  assert.match(next, /- 进入执行：2026-11-18/u);
});

test("the decision CLI refuses a stage jump, a short approval and a missing batch", () => {
  const body = text();
  const root = makeRoot(body);
  fs.mkdirSync(path.join(root, "openspec", "changes", "probe"), { recursive: true });
  assert.throws(
    () => advanceEntry({ root, id: "D-20261118-probe", stage: "待验收", approval: "批准", decision: "方案" }),
    /不能从决策中直接到待验收/u,
  );
  assert.throws(
    () => advanceEntry({ root, id: "D-20261118-probe", stage: "执行中", approval: "好", decision: "方案" }),
    /原话太短/u,
  );
  const noBatch = body.replace("- 未开始：定案后进入执行", "- 批次：changes/absent");
  fs.writeFileSync(path.join(root, "docs", "DECISIONS.md"), noBatch, "utf8");
  assert.throws(
    () =>
      advanceEntry({
        root,
        id: "D-20261118-probe",
        stage: "执行中",
        approval: "没问题，这项可以执行",
        decision: "按探针方案做",
      }),
    /在 openspec\/changes\/ 里不存在/u,
  );
  fs.writeFileSync(path.join(root, "docs", "DECISIONS.md"), body, "utf8");
});

test("the decision CLI writes the decision and the stage in one pass, then validates the result", () => {
  const root = makeRoot(text());
  fs.mkdirSync(path.join(root, "openspec", "changes", "probe"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "DECISIONS.md"),
    text().replace("- 未开始：定案后进入执行", "- 批次：changes/probe"),
    "utf8",
  );
  const result = advanceEntry({
    root,
    id: "D-20261118-probe",
    stage: "执行中",
    approval: "没问题，这项可以执行",
    decision: "按探针方案做",
    date: "2026-11-18",
  });
  assert.equal(result.to, "执行中");
  const written = fs.readFileSync(path.join(root, "docs", "DECISIONS.md"), "utf8");
  assert.match(written, /- 决定：按探针方案做（用户原话：「没问题，这项可以执行」，2026-11-18）/u);
  assert.match(written, /- \*\*阶段\*\*：执行中/u);
  assert.match(written, /- 批次：changes\/probe/u);
  assert.deepEqual(checkDecisionEntries(written, { today: "2026-11-18" }).errors, []);
});

test("a rejected write leaves the file untouched", () => {
  const root = makeRoot(text());
  const before = fs.readFileSync(path.join(root, "docs", "DECISIONS.md"), "utf8");
  assert.throws(
    () => advanceEntry({ root, id: "D-20261118-probe", stage: "已收口", approval: "批准这个条目收口" }),
    /不能从决策中直接到已收口/u,
  );
  assert.equal(fs.readFileSync(path.join(root, "docs", "DECISIONS.md"), "utf8"), before);
});

test("recordRound writes the round and its waiting change", () => {
  const root = makeRoot(text());
  const result = recordRound({
    root,
    id: "D-20261118-probe",
    conclusion: "待定（讨论期第 2 轮）",
    changes: "继续 T1/T2",
    date: "2026-11-18",
  });
  assert.equal(result.round, 2);
  assert.match(fs.readFileSync(path.join(root, "docs", "DECISIONS.md"), "utf8"), /- 待裁变化：继续 T1\/T2/u);
});

test("settle needs the user's words and lands in the decided block", () => {
  const root = makeRoot(text());
  assert.throws(
    () =>
      settleDecisionItem({
        root,
        id: "D-20261118-probe",
        number: 3,
        title: "类型分层",
        detail: "分层。",
        item: "T1",
        approval: "可以",
      }),
    /原话太短/u,
  );
  settleDecisionItem({
    root,
    id: "D-20261118-probe",
    number: 3,
    title: "类型分层",
    detail: "分层。",
    item: "T1",
    approval: "这个可以确定，按这样办",
    date: "2026-11-18",
  });
  assert.match(fs.readFileSync(path.join(root, "docs", "DECISIONS.md"), "utf8"), /- \*\*E3 类型分层\*\*/u);
});

test("stage packs load and every gate id they mention exists in the rule table", () => {
  const root = path.resolve(new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1"));
  for (const stage of ["discussion", "execution", "acceptance"]) {
    const pack = loadPack(root, stage);
    assert.ok(pack, `missing pack ${stage}`);
    assert.ok(templateHeadings(pack.text).length > 0);
    assert.deepEqual(checkPackGates(pack.text), []);
  }
  assert.deepEqual(checkPackGates("检查项 gate:not-a-real-gate"), ["not-a-real-gate"]);
});

test("the resume card points at the stage, the entry, the last round and the next action", () => {
  const card = resumeCard(path.resolve("."), {
    stage: "discussion",
    entries: [{ id: "D-20261118-probe", title: "探针", stage: "决策中", blocker: "无" }],
    lastRound: { number: 2, conclusion: "待定（讨论期第 2 轮）" },
    commitsSince: 3,
  });
  assert.match(card, /当前阶段：讨论/u);
  assert.match(card, /D-20261118-probe（决策中/u);
  assert.match(card, /第 2 轮——待定/u);
  assert.match(card, /下一步：/u);
  assert.match(card, /3 个新提交/u);
});

test("active entries only list the three open stages", () => {
  const root = makeRoot(
    `# DECISIONS\n\n${HEADER}\n${entry({ stage: "决策中" })}${entry({ stage: "已收口" }).replace(
      "## ⏳ D-20261118-probe 探针条目",
      "## ✅ D-20261118-done 已收口条目",
    )}`,
  );
  const listed = activeEntries(root);
  assert.deepEqual(listed.map((item) => item.id), ["D-20261118-probe"]);
});

test("transition documents must fill every template section and settle their open items", () => {
  const root = path.resolve(new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1"));
  const template = fs.readFileSync(path.join(root, "governance/noema/workflow/transition/design.md"), "utf8");
  const filled = `${templateHeadings(template)
    .map((heading) => `## ${heading}\n\n${heading.includes("待确认项") ? "- 无" : "- 已填写"}`)
    .join("\n")}\n`;
  assert.deepEqual(checkTransition(filled, "design", root).errors, []);
  assert.match(checkTransition("## 1 摘要\n\n（待填）", "design", root).errors.join("\n"), /缺少/u);
  assert.match(
    checkTransition(filled.replace("## 9 待确认项\n\n- 无", "## 9 待确认项\n\n- 还有一件"), "design", root).errors.join("\n"),
    /待确认项/u,
  );
  assert.match(checkTransition(filled.replace("- 已填写", "（待填）"), "design", root).errors.join("\n"), /待填/u);
});
test("the decision CLI lets acceptance fall back to execution only with a reason", () => {
  const body = `# DECISIONS\n\n${HEADER}\n${entry({ stage: "待验收" }).replace("- 未开始：定案后进入验收", "- [ ] 验收项一")}`;
  const root = makeRoot(body);
  const result = advanceEntry({
    root,
    id: "D-20261118-probe",
    stage: "执行中",
    reason: "验收发现规则包与工具不一致，退回修复",
    date: "2026-11-18",
  });
  assert.equal(result.transition, "backward");
  const written = fs.readFileSync(path.join(root, "docs", "DECISIONS.md"), "utf8");
  assert.match(written, /- \*\*阶段\*\*：执行中/u);
  assert.match(written, /- 退回：验收发现规则包与工具不一致，退回修复（2026-11-18）/u);

  const fresh = makeRoot(body);
  assert.throws(
    () => advanceEntry({ root: fresh, id: "D-20261118-probe", stage: "执行中", date: "2026-11-18" }),
    /--reason/u,
  );
  const tooShort = makeRoot(body);
  assert.throws(
    () => advanceEntry({ root: tooShort, id: "D-20261118-probe", stage: "执行中", reason: "不过", date: "2026-11-18" }),
    /太短/u,
  );
});