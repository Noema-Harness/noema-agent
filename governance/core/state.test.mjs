import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STATE_VERSION,
  addFindings,
  addRound,
  addTask,
  addWait,
  archiveSession,
  briefLines,
  completeTask,
  disposeFinding,
  emptyState,
  focusSession,
  listSessions,
  nextAction,
  openFindings,
  overallReady,
  parseFindingSpec,
  parseTaskSpec,
  planTasks,
  recordReview,
  segmentReady,
  setScope,
  setState,
  signScope,
  startSession,
  switchSession,
  taskFromFinding,
  upgradeState,
  validateState,
} from "./state.mjs";

function opened(title = "把一件事做完并交出来") {
  return startSession(emptyState(), { title }).doc;
}

function withTasks(doc, items) {
  const parsed = items.map((item) =>
    typeof item === "string" ? { text: item, standard: `${item}的标准` } : item,
  );
  return planTasks(doc, { tasks: parsed }).doc;
}

test("a session starts empty and focused, executing by default", () => {
  const doc = opened();
  assert.equal(doc.version, STATE_VERSION);
  assert.equal(doc.focus, "S1");
  const session = focusSession(doc);
  assert.equal(session.state, "执行");
  assert.deepEqual(session.tasks, []);
  assert.deepEqual(session.findings, []);
  assert.deepEqual(session.reviews, []);
  assert.equal(session.sign, null);
  assert.deepEqual(validateState(doc), []);
});

test("a second session needs the first one closed", () => {
  const doc = opened();
  assert.throws(() => startSession(doc, { title: "另一件事" }), /先 close 收口/u);
  archiveSession(doc, { reason: "做完了" });
  assert.equal(doc.focus, null);
  const next = startSession(doc, { title: "另一件事也要做完" }).doc;
  assert.equal(next.focus, "S2");
});

test("a task needs a standard, not just a sentence", () => {
  const doc = opened();
  assert.throws(() => addTask(doc, { text: "做点事情" }), /做完的标准/u);
  const result = addTask(doc, { text: "做点事情", standard: "能跑起来并且看到输出" });
  assert.equal(result.task.id, "T1");
  assert.equal(result.task.phase, null);
  assert.deepEqual(validateState(doc), []);
});

test("tasks can be imported from text with an optional phase", () => {
  const doc = opened();
  const parsed = parseTaskSpec(
    [
      "- [ ] 写主界面",
      "      标准：1280 与 430 都不溢出",
      "      阶段：界面",
      "- [ ] 写一份说明",
      "      标准：文档里写清怎么跑",
    ].join("\n"),
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].phase, "界面");
  assert.equal(parsed[1].phase, null);
  const result = planTasks(doc, { tasks: parsed });
  assert.equal(result.tasks.length, 2);
  assert.deepEqual(validateState(doc), []);
});

test("completion needs evidence that is not a placeholder", () => {
  const doc = withTasks(opened(), ["写完第一件事"]);
  assert.throws(() => completeTask(doc, { id: "T1" }), /--evidence/u);
  assert.throws(() => completeTask(doc, { id: "T1", evidence: ["…"] }), /占位/u);
  const result = completeTask(doc, { id: "T1", evidence: ["node --test 15/15"] });
  assert.equal(result.task.status, "已完成");
  assert.deepEqual(result.task.evidence, ["node --test 15/15"]);
});

test("a phase can only be reviewed once every task in it is done", () => {
  const doc = withTasks(opened(), [
    { text: "A 任务", standard: "A 的标准", phase: "一段" },
    { text: "B 任务", standard: "B 的标准", phase: "一段" },
  ]);
  completeTask(doc, { id: "T1", evidence: ["跑了 A"] });
  const notReady = segmentReady(focusSession(doc), "一段");
  assert.equal(notReady.ready, false);
  assert.match(notReady.why, /还有 1 个任务/u);
  completeTask(doc, { id: "T2", evidence: ["跑了 B"] });
  assert.equal(segmentReady(focusSession(doc), "一段").ready, true);
  const review = recordReview(doc, { scope: "段", phase: "一段" });
  assert.equal(review.review.scope, "段");
  assert.match(review.review.brief, /审查任务书/u);
  assert.equal(segmentReady(focusSession(doc), "一段").ready, false);
});

test("the overall review waits for every task and only runs once", () => {
  const doc = withTasks(opened(), ["第一件事", "第二件事"]);
  completeTask(doc, { id: "T1", evidence: ["做完一"] });
  assert.equal(overallReady(focusSession(doc)).ready, false);
  completeTask(doc, { id: "T2", evidence: ["做完二"] });
  assert.equal(overallReady(focusSession(doc)).ready, true);
  recordReview(doc, { scope: "总体" });
  assert.equal(overallReady(focusSession(doc)).ready, false);
});

test("entering acceptance needs finished tasks and an overall review", () => {
  const doc = withTasks(opened(), ["只有一件事"]);
  assert.throws(() => setState(doc, { to: "验收", reason: "差不多了" }), /没做完/u);
  completeTask(doc, { id: "T1", evidence: ["跑通了"] });
  assert.throws(() => setState(doc, { to: "验收", reason: "差不多了" }), /总体审查/u);
  recordReview(doc, { scope: "总体" });
  const result = setState(doc, { to: "验收", reason: "任务完成，审查已做" });
  assert.equal(result.session.state, "验收");
});

test("a finding needs a reason to be closed, and 已修 needs proof", () => {
  const doc = withTasks(opened(), ["有件事要做"]);
  completeTask(doc, { id: "T1", evidence: ["做完"] });
  recordReview(doc, { scope: "总体" });
  const added = addFindings(doc, {
    findings: parseFindingSpec("- 入口未做可达性检查 | 建议补 aria"),
  });
  const finding = added.findings[0];
  assert.equal(finding.scope, "总体");
  assert.equal(finding.status, "未处置");
  assert.throws(
    () => disposeFinding(doc, { id: finding.id, decision: "已修", note: "改好入口文案" }),
    /要有证据/u,
  );
  const task = taskFromFinding(doc, { id: finding.id }).task;
  assert.equal(task.fromFinding, finding.id);
  assert.equal(task.phase, null);
  completeTask(doc, { id: task.id, evidence: ["补了 aria-label 并重跑"] });
  const disposed = disposeFinding(doc, { id: finding.id, decision: "已修", note: "补了可达性" });
  assert.equal(disposed.finding.status, "已修");
  assert.deepEqual(validateState(doc), []);
});

test("signing needs acceptance, no open findings, and the user's own words", () => {
  const doc = withTasks(opened(), ["要做的事"]);
  completeTask(doc, { id: "T1", evidence: ["跑过"] });
  recordReview(doc, { scope: "总体" });
  assert.throws(() => signScope(doc, { text: "可以" }), /验收状态/u);
  setState(doc, { to: "验收", reason: "做完了" });
  addFindings(doc, { findings: ["入口不清楚"] });
  assert.throws(() => signScope(doc, { text: "就按这个来" }), /没处置/u);
  disposeFinding(doc, { id: "F1", decision: "延期", note: "下一轮再改入口" });
  assert.throws(() => signScope(doc, { text: "‹用户的签收原话›" }), /占位/u);
  const result = signScope(doc, { text: "行，就按这个收" });
  assert.equal(result.session.sign.text, "行，就按这个收");
  assert.deepEqual(validateState(doc), []);
});

test("next action walks task → phase review → overall review → acceptance → findings → sign → close", () => {
  const doc = withTasks(opened(), [{ text: "一段里的活", standard: "段的标准", phase: "一段" }]);
  setScope(doc, { text: "把这件事做完并交付", kind: "里程碑" });
  assert.match(nextAction(doc).command, /task done T1/u);
  completeTask(doc, { id: "T1", evidence: ["跑了"] });
  assert.match(nextAction(doc).command, /review log --scope 段/u);
  recordReview(doc, { scope: "段", phase: "一段" });
  assert.match(nextAction(doc).command, /review log --scope 总体/u);
  recordReview(doc, { scope: "总体" });
  assert.match(nextAction(doc).command, /set 验收/u);
  setState(doc, { to: "验收", reason: "任务与审查齐了" });
  assert.match(nextAction(doc).command, /npm run state -- sign/u);
  signScope(doc, { text: "可以收口了" });
  assert.match(nextAction(doc).command, /close/u);
});

test("placeholder words never get through the gates", () => {
  const doc = withTasks(opened(), ["随便一件"]);
  assert.throws(() => completeTask(doc, { id: "T1", evidence: ["‹跑过的命令›"] }), /占位/u);
  completeTask(doc, { id: "T1", evidence: ["真跑了 node --test"] });
  recordReview(doc, { scope: "总体" });
  addFindings(doc, { findings: ["有个问题"] });
  assert.throws(() => disposeFinding(doc, { id: "F1", decision: "延期", note: "" }), /理由/u);
  assert.throws(
    () => disposeFinding(doc, { id: "F1", decision: "延期", note: "‹用户的说法›" }),
    /占位/u,
  );
  setState(doc, { to: "验收", reason: "任务完成" });
  assert.throws(() => signScope(doc, { text: "xxx" }), /签收|占位/u);
});

test("discussion rounds carry the round summary, its open questions and the draft", () => {
  const doc = startSession(emptyState(), { title: "先聊聊再动手", discuss: true }).doc;
  addRound(doc, {
    summary: "用户想先只读，我判断可操作会拖慢交付，先按只读走。",
    waits: ["要不要做成可操作"],
    draft: "只读版本：会话、任务、发现三块，先给 Noema 用。",
  });
  const thread = doc.sessions[0].threads[0];
  assert.equal(thread.rounds.length, 1);
  assert.match(thread.rounds[0].summary, /只读/u);
  assert.deepEqual(thread.rounds[0].waits, ["要不要做成可操作"]);
  assert.deepEqual(thread.waits, ["要不要做成可操作"]);
  assert.match(thread.rounds[0].draft, /只读版本/u);
  assert.match(briefLines(doc).join("\n"), /待裁/u);
  assert.throws(() => addRound(doc, { summary: "" }), /摘要/u);
  assert.throws(() => setState(doc, { to: "执行", reason: "想清楚了" }), /范围/u);
  setScope(doc, { text: "只读版本先落地", kind: "里程碑" });
  setState(doc, { to: "执行", reason: "范围与结论已定" });
  assert.equal(focusSession(doc).threads[0].status, "archived");
});

test("switching sessions keeps both alive and lists them by task count", () => {
  const doc = withTasks(opened(), ["第一件事", "第二件事"]);
  completeTask(doc, { id: "T1", evidence: ["做了"] });
  archiveSession(doc, { reason: "先放着" });
  startSession(doc, { title: "第二件事也要做" });
  const rows = listSessions(doc);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tasksDone, 1);
  assert.equal(rows[0].status, "archived");
  assert.equal(rows[1].status, "open");
  assert.throws(() => switchSession(doc, { id: "S1" }), /已归档/u);
});

test("a retired version is refused instead of being silently reshaped", () => {
  assert.throws(() => upgradeState({ version: 4, sessions: [] }), /已退役/u);
});

test("validation catches the broken shapes", () => {
  const doc = withTasks(opened(), [{ text: "有点事情", standard: "标准写清楚" }]);
  doc.sessions[0].tasks[0].standard = "";
  const errors = validateState(doc);
  assert.ok(errors.some((one) => /缺少做完的标准/u.test(one)));
  const clean = withTasks(opened(), ["另一件事"]);
  assert.equal(openFindings(clean).length, 0);
});
