import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import {
  addWaitingItem,
  appendRound,
  dropWaitingItem,
  readEntry,
  replaceAcceptance,
  replaceBatch,
  setStage,
  settleDecision,
} from "./entries.mjs";
import {
  checkTransitionText,
  templateHeadings,
  pickTransitionTarget,
  transitionKindOf,
} from "./transitions.mjs";
import { checkPackGates, loadPack, resumeCard, activeEntries } from "../../scripts/stage.mjs";
import { advanceEntry, recordRound, settleDecisionItem } from "../../scripts/decision.mjs";
import { checkTransition, scaffold } from "../../scripts/transition.mjs";
import { checkDecisionEntries } from "../../scripts/maintenance.mjs";
import { main as interfaceMain } from "../../scripts/interface.mjs";

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
    stage === "决策中" || stage === "执行中"
      ? "- 未开始：定案后进入验收"
      : "- [ ] 验收项一（[机制] probe）",
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
  assert.match(
    next,
    /- \*\*E3 类型分层\*\*：T1 按事实与情境分层。（2026-11-18，原话「这个可以」）/u,
  );
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
    () =>
      advanceEntry({
        root,
        id: "D-20261118-probe",
        stage: "待验收",
        approval: "批准",
        decision: "方案",
      }),
    /不能从决策中直接到待验收/u,
  );
  assert.throws(
    () =>
      advanceEntry({
        root,
        id: "D-20261118-probe",
        stage: "执行中",
        approval: "好",
        decision: "方案",
      }),
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
    path.join(root, "openspec", "changes", "probe", "proposal.md"),
    "Plan: none\n\n来源：D-20261118-probe\n",
    "utf8",
  );
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
    () =>
      advanceEntry({ root, id: "D-20261118-probe", stage: "已收口", approval: "批准这个条目收口" }),
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
  assert.match(
    fs.readFileSync(path.join(root, "docs", "DECISIONS.md"), "utf8"),
    /- 待裁变化：继续 T1\/T2/u,
  );
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
        approval: "好",
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
  assert.match(
    fs.readFileSync(path.join(root, "docs", "DECISIONS.md"), "utf8"),
    /- \*\*E3 类型分层\*\*/u,
  );
});

test("stage packs load and every gate id they mention exists in the rule table", () => {
  const root = path.resolve(
    new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1"),
  );
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
  assert.deepEqual(
    listed.map((item) => item.id),
    ["D-20261118-probe"],
  );
});

test("transition documents must fill every template section and settle their open items", () => {
  const root = path.resolve(
    new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1"),
  );
  const template = fs.readFileSync(
    path.join(root, "governance/noema/workflow/transition/design.md"),
    "utf8",
  );
  const filled = `${templateHeadings(template)
    .map((heading) => `## ${heading}\n\n${heading.includes("待确认项") ? "- 无" : "- 已填写"}`)
    .join("\n")}\n`;
  assert.deepEqual(checkTransition(filled, "design", root).errors, []);
  assert.match(checkTransition("## 1 摘要\n\n（待填）", "design", root).errors.join("\n"), /缺少/u);
  assert.match(
    checkTransition(
      filled.replace("## 9 待确认项\n\n- 无", "## 9 待确认项\n\n- 还有一件"),
      "design",
      root,
    ).errors.join("\n"),
    /待确认项/u,
  );
  assert.match(
    checkTransition(filled.replace("- 已填写", "（待填）"), "design", root).errors.join("\n"),
    /待填/u,
  );
});
test("acceptance failure reopens the entry in the decision stage and records it where it happened", () => {
  const body = `# DECISIONS\n\n${HEADER}\n${entry({ stage: "待验收" }).replace("- 未开始：定案后进入验收", "- [ ] 验收项一")}`;
  const root = makeRoot(body);
  const result = advanceEntry({
    root,
    id: "D-20261118-probe",
    stage: "决策中",
    reason: "验收发现 E12 与 E19 未落地，执行清单没有覆盖决定",
    date: "2026-11-18",
  });
  assert.equal(result.transition, "reopen");
  const written = fs.readFileSync(path.join(root, "docs", "DECISIONS.md"), "utf8");
  assert.match(written, /- \*\*阶段\*\*：决策中/u);
  assert.match(written, /- 重开：验收发现 E12 与 E19 未落地，执行清单没有覆盖决定（2026-11-18）/u);
  // 历史不可回溯：重开只加记录与改阶段，已完成的执行层与验收层保持原样。
  assert.match(written, /- 批次：changes\/probe/u);
  assert.match(written, /- \[ \] 验收项一/u);
  assert.match(written, /- 决定：探针方案（用户确认：2026-11-18）/u);

  const fresh = makeRoot(body);
  assert.throws(
    () =>
      advanceEntry({ root: fresh, id: "D-20261118-probe", stage: "决策中", date: "2026-11-18" }),
    /--reason/u,
  );
  const tooShort = makeRoot(body);
  assert.throws(
    () =>
      advanceEntry({
        root: tooShort,
        id: "D-20261118-probe",
        stage: "决策中",
        reason: "不过",
        date: "2026-11-18",
      }),
    /太短/u,
  );
  const backward = makeRoot(body);
  assert.throws(
    () =>
      advanceEntry({
        root: backward,
        id: "D-20261118-probe",
        stage: "执行中",
        reason: "验收不过退回执行中",
        date: "2026-11-18",
      }),
    /不能从待验收直接到执行中/u,
  );
});

test("a decision cannot move to acceptance while some decided E has no acceptance item", () => {
  const uncovered = makeRoot(text({ stage: "执行中" }));
  assert.throws(
    () =>
      advanceEntry({
        root: uncovered,
        id: "D-20261118-probe",
        stage: "待验收",
        date: "2026-11-18",
      }),
    /还有 1 个已定 E 没有验收项（E1）/u,
  );

  const covered = makeRoot(
    text({ stage: "执行中" }).replace("- 未开始：定案后进入验收", "- [ ] E1 探针可以跑"),
  );
  const result = advanceEntry({
    root: covered,
    id: "D-20261118-probe",
    stage: "待验收",
    date: "2026-11-18",
  });
  assert.equal(result.transition, "forward");
  assert.match(
    fs.readFileSync(path.join(covered, "docs", "DECISIONS.md"), "utf8"),
    /- \*\*阶段\*\*：待验收/u,
  );
});

function designDoc() {
  const template = fs.readFileSync(
    path.join(process.cwd(), "governance/noema/workflow/transition/design.md"),
    "utf8",
  );
  return `${template}\n- 无\n`;
}

function executionRoot({ proposal = true, design = "design.md" } = {}) {
  const root = makeRoot(text().replace("- 未开始：定案后进入执行", "- 批次：changes/probe"));
  fs.mkdirSync(path.join(root, "openspec", "changes", "probe"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "openspec", "changes", "probe", "proposal.md"),
    proposal ? "Plan: none\n\n来源：D-20261118-probe\n" : "Plan: none\n",
    "utf8",
  );
  if (design) fs.writeFileSync(path.join(root, design), designDoc(), "utf8");
  return root;
}

test("entering execution needs a proposal that cites the entry and a complete design", () => {
  const missingCite = executionRoot({ proposal: false });
  assert.throws(
    () =>
      advanceEntry({
        root: missingCite,
        id: "D-20261118-probe",
        stage: "执行中",
        approval: "没问题，这项可以执行",
        decision: "按探针方案做",
        date: "2026-11-18",
      }),
    /没有引用条目 D-20261118-probe/u,
  );

  const good = executionRoot();
  const result = advanceEntry({
    root: good,
    id: "D-20261118-probe",
    stage: "执行中",
    approval: "没问题，这项可以执行",
    decision: "按探针方案做",
    design: "design.md",
    date: "2026-11-18",
  });
  assert.equal(result.to, "执行中");
  assert.match(
    fs.readFileSync(path.join(good, "docs", "DECISIONS.md"), "utf8"),
    /- 设计：design\.md（2026-11-18）/u,
  );
});

test("waiting items can be added and dropped by command", () => {
  const root = makeRoot(text());
  const added = addWaitingItem(text(), "D-20261118-probe", "T3 第三个问题");
  assert.match(added.text, /- T3 第三个问题/u);
  const dropped = dropWaitingItem(added.text, "D-20261118-probe", "T3");
  assert.doesNotMatch(dropped.text, /T3 第三个问题/u);
  assert.equal(root.length > 0, true);
});

test("acceptance items are replaced by command while stage events stay", () => {
  const base = text({ stage: "待验收" });
  const withEvent = base.replace(
    "- [ ] 验收项一",
    "- [ ] 验收项一\n- 重开：验收发现漏项（2026-11-19）",
  );
  const result = replaceAcceptance(withEvent, "D-20261118-probe", [
    "- [ ] E1/E2 规则与阶段入口（[机制] npm run stage -- discussion）",
    "- [ ] E3 待裁清单滚动（[机制] kernel.test.mjs）",
  ]);
  assert.equal(result.replaced, 1);
  assert.equal(result.written, 2);
  assert.match(result.text, /- \[ \] E3 待裁清单滚动/u);
  assert.doesNotMatch(result.text, /验收项一/u);
  assert.match(result.text, /- 重开：验收发现漏项（2026-11-19）/u);
  assert.throws(() => replaceAcceptance(withEvent, "D-20261118-probe", []), /验收项为空/u);
});

test("the interface routes check/record/move and rejects unknown verbs", () => {
  assert.equal(interfaceMain(["record", "bogus"]), 2);
  assert.equal(interfaceMain(["check", "bogus"]), 2);
  assert.equal(interfaceMain(["bogus"]), 2);
  const quiet = console.log;
  console.log = () => {};
  try {
    assert.equal(interfaceMain(["check", "stage", "discussion"]), 0);
  } finally {
    console.log = quiet;
  }
});

test("transition --write updates in place and only --new creates a second file", () => {
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), "../..");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-transition-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.mkdirSync(path.join(root, "governance", "noema", "workflow", "transition"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(root, "docs", "DECISIONS.md"), "## D-20261118-probe 探针\n", "utf8");
  fs.copyFileSync(
    path.join(repo, "governance", "noema", "workflow", "transition", "design.md"),
    path.join(root, "governance", "noema", "workflow", "transition", "design.md"),
  );
  const first = scaffold(root, "design", { entry: "D-20261118-probe", date: "2026-11-19" });
  assert.equal(first.updated, false);
  const second = scaffold(root, "design", { entry: "D-20261118-probe", date: "2026-11-20" });
  assert.equal(second.updated, true);
  assert.equal(second.written, first.written);
  assert.match(fs.readFileSync(path.join(root, second.written), "utf8"), /修订/u);
  const third = scaffold(root, "design", {
    entry: "D-20261118-probe",
    date: "2026-11-21",
    createNew: true,
    reason: "确实需要另开一份",
  });
  assert.equal(third.updated, false);
  assert.notEqual(third.written, first.written);
  assert.throws(
    () =>
      scaffold(root, "design", { entry: "D-20261118-probe", date: "2026-11-22", createNew: true }),
    /--new 必须带理由/u,
  );
});

test("transition documents stay unique: one per kind, duplicates refuse", () => {
  assert.equal(transitionKindOf("2026-11-19-x-design.md"), "design");
  assert.equal(transitionKindOf("notes.md"), null);
  assert.equal(pickTransitionTarget([], "design").target, null);
  const one = pickTransitionTarget(["2026-11-18-a-design.md"], "design");
  assert.equal(one.target, "2026-11-18-a-design.md");
  assert.equal(one.error, null);
  const many = pickTransitionTarget(["2026-11-18-a-design.md", "2026-11-19-b-design.md"], "design");
  assert.match(many.error, /同类过渡文档有 2 份/u);
  assert.equal(many.duplicates.length, 2);
});

test("the batch pointer is replaced by command", () => {
  const base = text({ stage: "执行中" }).replace("- 批次：changes/probe", "- 批次：changes/old");
  const next = replaceBatch(base, "D-20261118-probe", "changes/new");
  const entry = readEntry(next, "D-20261118-probe");
  assert.equal(entry.batch, "changes/new");
});
