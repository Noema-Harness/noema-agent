import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  STATES,
  MAX_PHASES,
  activeThread,
  addAcceptance,
  addPhase,
  addRound,
  addTask,
  addWait,
  archiveThread,
  completePhase,
  completeTask,
  dropWait,
  emptyState,
  ensureThread,
  logOf,
  resumeThread,
  reviewPhase,
  setAcceptance,
  signScope,
  setScope,
  setState,
  summaryLines,
  validateState,
  workProgress,
} from "./state.mjs";
import { loadState, main, saveState } from "../../scripts/state.mjs";

const NOW = new Date("2026-11-19T10:00:00.000Z");

function started() {
  const doc = emptyState(NOW);
  ensureThread(doc, { title: "状态化生命周期", now: NOW });
  return doc;
}

test("a fresh state document is valid and starts in discussion", () => {
  const doc = emptyState(NOW);
  assert.deepEqual(validateState(doc), []);
  assert.equal(doc.current.state, "讨论");
  assert.deepEqual(STATES, ["讨论", "执行", "验收"]);
});

test("switching state archives the session and writes a log line", () => {
  const doc = started();
  setScope(doc, { text: "changes/probe", now: NOW });
  const { doc: next, log } = setState(doc, {
    to: "执行",
    reason: "设计已批准",
    now: NOW,
  });
  assert.equal(next.current.state, "执行");
  assert.equal(next.work.scope.text, "changes/probe");
  assert.deepEqual(validateState(next), []);
  assert.equal(log.from, "讨论");
  assert.equal(log.to, "执行");
  assert.equal(log.obligation, "挂起");
  const thread = next.threads[0];
  assert.equal(thread.status, "archived");
  assert.equal(thread.ending, "归档");
  assert.deepEqual(
    logOf(next, { limit: 5 }).map((entry) => entry.to),
    ["执行"],
  );
});

test("entering execution marks a session with design and kickoff as decided", () => {
  const doc = started();
  doc.threads[0].output = { design: "design.md", kickoff: "kickoff.md", scope: null };
  setScope(doc, { text: "把探针修好", now: NOW });
  const { doc: next, log } = setState(doc, { to: "执行", reason: "范围已批", now: NOW });
  assert.equal(next.threads[0].ending, "定案");
  assert.equal(log.obligation, "关闭");
});

test("switching back to discussion resumes the last archived session", () => {
  const doc = started();
  setScope(doc, { text: "回到讨论补范围", now: NOW });
  setState(doc, { to: "执行", reason: "开工", now: NOW });
  const { doc: back } = setState(doc, { to: "讨论", reason: "回来补范围", now: NOW });
  const thread = activeThread(back);
  assert.ok(thread);
  assert.equal(back.current.threadId, thread.id);
  assert.equal(thread.status, "active");
  const { doc: after } = addRound(back, { conclusion: "继续第二轮", now: NOW });
  assert.equal(activeThread(after).rounds.at(-1).n, 1);
  assert.equal(after.log.at(-1).obligation, "挂起");
});

test("state changes reject unknown states, the same state, and empty reasons", () => {
  const doc = started();
  assert.throws(() => setState(doc, { to: "空闲", reason: "试试", now: NOW }), /未知状态/u);
  assert.throws(() => setState(doc, { to: "讨论", reason: "重复", now: NOW }), /已经在/u);
  assert.throws(() => setState(doc, { to: "执行", reason: "", now: NOW }), /--reason/u);
});

test("rounds keep a per-session number and record the diff", () => {
  const doc = started();
  const first = addRound(doc, { conclusion: "先定三态", change: "+ 三态模型", now: NOW });
  const second = addRound(first.doc, { conclusion: "再定会话", change: "+ 会话对象", now: NOW });
  assert.equal(first.round.n, 1);
  assert.equal(second.round.n, 2);
  assert.equal(second.round.date, "2026-11-19");
  assert.equal(second.round.change, "+ 会话对象");
  assert.throws(() => addRound(doc, { conclusion: " ", now: NOW }), /--conclusion/u);
});

test("pending items roll in and out and reject duplicates", () => {
  const doc = started();
  const added = addWait(doc, { item: "T1 执行态边界", now: NOW });
  addWait(added.doc, { item: "T2 验收标准", now: NOW });
  assert.throws(() => addWait(added.doc, { item: "T1 执行态边界", now: NOW }), /已存在/u);
  const dropped = dropWait(added.doc, { item: "T1", now: NOW });
  assert.equal(dropped.removed, "T1 执行态边界");
  assert.deepEqual(activeThread(dropped.doc).waits, ["T2 验收标准"]);
  assert.throws(() => dropWait(dropped.doc, { item: "T9", now: NOW }), /没有匹配/u);
});

test("a session can be archived with 定案 and resumed by id", () => {
  const doc = started();
  const archived = archiveThread(doc, { ending: "定案", now: NOW });
  assert.equal(archived.thread.status, "archived");
  assert.equal(archived.thread.ending, "定案");
  assert.equal(doc.current.threadId, null);
  const resumed = resumeThread(doc, { id: archived.thread.id, now: NOW });
  assert.equal(resumed.thread.status, "active");
  assert.equal(resumed.thread.ending, null);
  assert.equal(doc.current.threadId, archived.thread.id);
});

test("the summary says what the agent is doing and what is pending", () => {
  const doc = started();
  addWait(doc, { item: "T1 执行态边界", now: NOW });
  const lines = summaryLines(doc).join("\n");
  assert.match(lines, /状态：讨论/u);
  assert.match(lines, /会话：状态化生命周期/u);
  assert.match(lines, /待裁：T1 执行态边界/u);
});

test("validation catches a dangling session pointer and unknown state", () => {
  const doc = started();
  doc.current.threadId = "thread-missing";
  assert.match(validateState(doc).join("；"), /指向不存在的会话/u);
  const broken = started();
  broken.current.state = "空闲";
  assert.match(validateState(broken).join("；"), /不在允许列表/u);
});

test("the CLI writes state data and reads it back", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-state-"));
  try {
    main(["round", "--conclusion", "第一轮结论"], root);
    main(["wait", "add", "--item", "T1 执行态"], root);
    main(["scope", "changes/probe"], root);
    main(["set", "执行", "--reason", "范围已批准"], root);
    const doc = loadState(root);
    assert.equal(doc.current.state, "执行");
    assert.equal(doc.work.scope.text, "changes/probe");
    assert.equal(doc.threads.length, 1);
    assert.equal(doc.threads[0].rounds.length, 1);
    assert.deepEqual(doc.threads[0].waits, ["T1 执行态"]);
    assert.equal(doc.log.at(-1).to, "执行");
    const reloaded = JSON.parse(
      fs.readFileSync(path.join(root, "governance/data/state.json"), "utf8"),
    );
    saveState(root, reloaded);
    assert.deepEqual(loadState(root), reloaded);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the work list carries scope, phases, tasks and stage acceptance", () => {
  const doc = started();
  setScope(doc, { text: "把状态面板做出来", now: NOW });
  const first = addPhase(doc, { name: "清单与命令", goal: "能写能勾", now: NOW }).phase;
  const second = addPhase(doc, { name: "面板渲染", now: NOW }).phase;
  const task = addTask(doc, { phase: first.id, text: "扩展 state 数据结构", now: NOW }).task;
  addTask(doc, { phase: first.id, text: "补齐命令行", now: NOW });
  const item = addAcceptance(doc, { phase: first.id, text: "任务能勾选并留证据", now: NOW }).item;
  assert.deepEqual(workProgress(doc), {
    phases: { done: 0, total: 2 },
    tasks: { done: 0, total: 2 },
    acceptance: { passed: 0, failed: 0, unchecked: 1, total: 1, findings: 0 },
  });
  assert.throws(() => completePhase(doc, { id: first.id, now: NOW }), /还有 2 个任务没完成/u);
  completeTask(doc, { id: task.id, evidence: "node --test state.test.mjs", now: NOW });
  completeTask(doc, { id: `${first.id}-T2`, now: NOW });
  assert.throws(() => completePhase(doc, { id: first.id, now: NOW }), /没判/u);
  setAcceptance(doc, { id: item.id, status: "不通过", evidence: "面板没渲染", now: NOW });
  assert.throws(() => completePhase(doc, { id: first.id, now: NOW }), /不通过/u);
  setAcceptance(doc, { id: item.id, status: "通过", evidence: "重跑通过", now: NOW });
  completePhase(doc, { id: first.id, now: NOW });
  assert.equal(second.status, "进行中");
  assert.equal(workProgress(doc).phases.done, 1);
  assert.match(summaryLines(doc).join("\n"), /阶段 1\/2 · 任务 2\/2/u);
  assert.deepEqual(validateState(doc), []);
});

test("a work list refuses more than five phases and unknown ids", () => {
  const doc = started();
  for (let index = 0; index < MAX_PHASES; index += 1) {
    addPhase(doc, { name: `阶段 ${index + 1}`, now: NOW });
  }
  assert.throws(() => addPhase(doc, { name: "第六个阶段", now: NOW }), /最多 5 个/u);
  assert.throws(() => addTask(doc, { phase: "P9", text: "不存在", now: NOW }), /没有阶段 P9/u);
  assert.throws(() => setAcceptance(doc, { id: "P1-A9", status: "通过", now: NOW }), /没有验收项/u);
  assert.deepEqual(validateState(doc), []);
});

test("entering execution needs a scope and acceptance needs finished phases", () => {
  const doc = started();
  assert.throws(() => setState(doc, { to: "执行", reason: "直接开工", now: NOW }), /先声明范围/u);
  setScope(doc, { text: "把探针修好", now: NOW });
  setState(doc, { to: "执行", reason: "范围清楚", now: NOW });
  const phase = addPhase(doc, { name: "第一段", now: NOW }).phase;
  assert.throws(
    () => setState(doc, { to: "验收", reason: "先验一下", now: NOW }),
    /阶段要全部完成/u,
  );
  const task = addTask(doc, { phase: phase.id, text: "写实现", now: NOW }).task;
  const item = addAcceptance(doc, { phase: phase.id, text: "能跑", now: NOW }).item;
  completeTask(doc, { id: task.id, now: NOW });
  setAcceptance(doc, { id: item.id, status: "通过", now: NOW });
  completePhase(doc, { id: phase.id, now: NOW });
  const { doc: accepted } = setState(doc, { to: "验收", reason: "阶段都完成了", now: NOW });
  assert.equal(accepted.current.state, "验收");
  assert.throws(() => signScope(accepted, { text: "好", now: NOW }), /签名|原话|签收/u);
  const { scope } = signScope(accepted, { text: "符合预期", now: NOW });
  assert.equal(scope.signed.text, "符合预期");
  assert.equal(scope.signed.date, "2026-11-19");
  assert.deepEqual(validateState(accepted), []);
});

test("state data from version 1 upgrades to the work model on load", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-state-v1-"));
  try {
    fs.mkdirSync(path.join(root, "governance/data"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "governance/data/state.json"),
      `${JSON.stringify(
        {
          version: 1,
          current: { state: "讨论", since: NOW.toISOString(), threadId: null },
          log: [],
          threads: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const doc = loadState(root);
    assert.equal(doc.version, 2);
    assert.deepEqual(doc.work, { scope: null, phases: [] });
    saveState(root, doc);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI drives the work list end to end", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-state-work-"));
  try {
    main(["scope", "把状态面板做出来"], root);
    main(["phase", "add", "--name", "清单与命令"], root);
    main(["task", "add", "--phase", "P1", "--text", "扩展数据结构"], root);
    main(["task", "done", "--id", "P1-T1", "--evidence", "node --test"], root);
    main(["accept", "add", "--phase", "P1", "--text", "勾选留证据"], root);
    main(["accept", "set", "--id", "P1-A1", "--status", "通过"], root);
    main(["phase", "done", "--id", "P1"], root);
    const doc = loadState(root);
    assert.equal(doc.work.scope.text, "把状态面板做出来");
    assert.equal(doc.work.phases[0].status, "已完成");
    assert.equal(doc.work.phases[0].tasks[0].evidence[0], "node --test");
    assert.deepEqual(workProgress(doc), {
      phases: { done: 1, total: 1 },
      tasks: { done: 1, total: 1 },
      acceptance: { passed: 1, failed: 0, unchecked: 0, total: 1, findings: 0 },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("acceptance layers keep findings out of the verdict and review notes stay on the phase", () => {
  const doc = started();
  setScope(doc, { text: "探针范围", now: NOW });
  setState(doc, { to: "执行", reason: "范围清楚", now: NOW });
  const phase = addPhase(doc, { name: "第一段", now: NOW }).phase;
  reviewPhase(doc, {
    id: phase.id,
    what: "命令能跑通",
    gap: "面板没覆盖签收",
    split: "不拆",
    now: NOW,
  });
  const deterministic = addAcceptance(doc, {
    phase: phase.id,
    text: "npm run state:test 全绿",
    now: NOW,
  }).item;
  const finding = addAcceptance(doc, {
    phase: phase.id,
    text: "面板缺签收日期",
    layer: "R",
    now: NOW,
  }).item;
  const human = addAcceptance(doc, {
    phase: phase.id,
    text: "用户确认范围",
    layer: "H",
    now: NOW,
  }).item;
  assert.equal(deterministic.layer, "D");
  assert.throws(
    () => addAcceptance(doc, { phase: phase.id, text: "无效层", layer: "Z", now: NOW }),
    /验收层只能是/u,
  );
  const task = addTask(doc, { phase: phase.id, text: "写实现", now: NOW }).task;
  completeTask(doc, { id: task.id, now: NOW });
  setAcceptance(doc, { id: deterministic.id, status: "通过", now: NOW });
  setAcceptance(doc, { id: human.id, status: "通过", now: NOW });
  // R 层是发现清单：未判也不阻塞阶段完成。
  assert.equal(finding.status, "未验");
  completePhase(doc, { id: phase.id, now: NOW });
  assert.equal(phase.status, "已完成");
  const progress = workProgress(doc);
  assert.equal(progress.acceptance.total, 2);
  assert.equal(progress.acceptance.findings, 1);
  const { doc: accepted } = setState(doc, { to: "验收", reason: "阶段完成", now: NOW });
  const { scope } = signScope(accepted, { text: "符合预期", now: NOW });
  assert.equal(scope.signed.text, "符合预期");
  assert.equal(accepted.work.phases[0].review.what, "命令能跑通");
  assert.deepEqual(validateState(accepted), []);
});

test("a failed blocking layer keeps the scope unsigned", () => {
  const doc = started();
  setScope(doc, { text: "探针范围", now: NOW });
  setState(doc, { to: "执行", reason: "范围清楚", now: NOW });
  const phase = addPhase(doc, { name: "第一段", now: NOW }).phase;
  const task = addTask(doc, { phase: phase.id, text: "写实现", now: NOW }).task;
  const item = addAcceptance(doc, { phase: phase.id, text: "能跑", layer: "C", now: NOW }).item;
  completeTask(doc, { id: task.id, now: NOW });
  assert.throws(() => completePhase(doc, { id: phase.id, now: NOW }), /没判/u);
  setAcceptance(doc, { id: item.id, status: "不通过", now: NOW });
  assert.throws(() => completePhase(doc, { id: phase.id, now: NOW }), /不通过/u);
  setAcceptance(doc, { id: item.id, status: "通过", now: NOW });
  completePhase(doc, { id: phase.id, now: NOW });
  const { doc: accepted } = setState(doc, { to: "验收", reason: "阶段完成", now: NOW });
  assert.deepEqual(validateState(accepted), []);
});
