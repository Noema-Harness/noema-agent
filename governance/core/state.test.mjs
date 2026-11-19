import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  STATES,
  activeThread,
  addRound,
  addWait,
  archiveThread,
  dropWait,
  emptyState,
  ensureThread,
  logOf,
  resumeThread,
  setState,
  summaryLines,
  validateState,
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
  const { doc: next, log } = setState(doc, {
    to: "执行",
    reason: "设计已批准",
    scope: "changes/probe",
    now: NOW,
  });
  assert.equal(next.current.state, "执行");
  assert.equal(next.current.scope, "changes/probe");
  assert.deepEqual(validateState(next), []);
  assert.equal(log.from, "讨论");
  assert.equal(log.to, "执行");
  assert.equal(log.obligation, "挂起");
  const thread = next.threads[0];
  assert.equal(thread.status, "archived");
  assert.equal(thread.ending, "归档");
  assert.deepEqual(logOf(next, { limit: 5 }).map((entry) => entry.to), ["执行"]);
});

test("entering execution marks a session with design and kickoff as decided", () => {
  const doc = started();
  doc.threads[0].output = { design: "design.md", kickoff: "kickoff.md", scope: null };
  const { doc: next, log } = setState(doc, { to: "执行", reason: "范围已批", now: NOW });
  assert.equal(next.threads[0].ending, "定案");
  assert.equal(log.obligation, "关闭");
});

test("switching back to discussion resumes the last archived session", () => {
  const doc = started();
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
    main(["set", "执行", "--reason", "范围已批准", "--scope", "changes/probe"], root);
    const doc = loadState(root);
    assert.equal(doc.current.state, "执行");
    assert.equal(doc.current.scope, "changes/probe");
    assert.equal(doc.threads.length, 1);
    assert.equal(doc.threads[0].rounds.length, 1);
    assert.deepEqual(doc.threads[0].waits, ["T1 执行态"]);
    assert.equal(doc.log.at(-1).to, "执行");
    const reloaded = JSON.parse(fs.readFileSync(path.join(root, "governance/data/state.json"), "utf8"));
    saveState(root, reloaded);
    assert.deepEqual(loadState(root), reloaded);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});