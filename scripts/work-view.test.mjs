import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addAcceptance,
  addSegment,
  addTask,
  archiveSession,
  completeTask,
  emptyState,
  passHumanAcceptance,
  resolveFinding,
  setAcceptance,
  setScope,
  setState,
  completeSegment,
  startSegment,
  startSession,
} from "../governance/core/state.mjs";
import { writeView } from "./work-view.mjs";

function withState(build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-view-"));
  fs.mkdirSync(path.join(root, "governance", "data"), { recursive: true });
  const doc = build(emptyState());
  fs.writeFileSync(
    path.join(root, "governance", "data", "state.json"),
    `${JSON.stringify(doc, null, 2)}\n`,
  );
  const file = writeView(root);
  const html = fs.readFileSync(file, "utf8");
  return { doc, html, root };
}

function simple() {
  let doc = startSession(emptyState(), { title: "把入口补上" }).doc;
  doc = setScope(doc, { text: "补一个能点开的入口", kind: "里程碑" }).doc;
  return doc;
}

function layered() {
  let doc = simple();
  const added = addSegment(doc, { name: "入口这一段" });
  doc = added.doc;
  const segmentId = added.segment.id;
  doc = startSegment(doc, { id: segmentId }).doc;
  doc = addTask(doc, { text: "做一个入口", segmentId }).doc;
  doc = addAcceptance(doc, { text: "入口能点开", layer: "D", segmentId }).doc;
  doc = addAcceptance(doc, { text: "点开是目标页", layer: "C", segmentId }).doc;
  doc = addAcceptance(doc, { text: "右栏墨量失衡", layer: "R", segmentId }).doc;
  doc = addAcceptance(doc, { text: "用户觉得位置顺手", layer: "H", segmentId }).doc;
  return doc;
}

function settled() {
  let doc = layered();
  const session = doc.sessions[0];
  const segment = session.segments.at(-1);
  for (const task of segment.tasks) {
    doc = completeTask(doc, {
      id: task.id,
      evidence: "跑过 node scripts/work-view.mjs 看到页面",
    }).doc;
  }
  for (const item of segment.acceptance) {
    const layer = item.layer ?? "D";
    if (layer === "R") {
      doc = resolveFinding(doc, { id: item.id, decision: "已修", note: "右栏改成通高" }).doc;
      continue;
    }
    if (layer === "H") continue;
    doc = setAcceptance(doc, {
      id: item.id,
      status: "通过",
      evidence: "在 1440 宽浏览器里点开看过",
    }).doc;
  }
  return doc;
}

test("the lead sentence is the mechanism's next action, not a page invention", () => {
  const { html } = withState(layered);
  assert.match(html, /class="lead">完成手上的任务/u);
  assert.match(html, /npm run state -- task done --id P\d-T\d/u);
  assert.doesNotMatch(html, /class="lead">还差一项人签收/u);
});

test("a task gap beats the human signature gap, exactly like signScope does", () => {
  const { html } = withState(layered);
  assert.match(html, /未处置/u);
  assert.match(html, /等你签收/u);
  assert.match(html, /class="lead">完成手上的任务/u);
});

test("settled gates hand the decision to the human, then to acceptance", () => {
  const waiting = withState(settled).html;
  assert.match(waiting, /class="lead">请用户签收/u);
  assert.match(waiting, /accept human --id P\d-A\d/u);
  assert.doesNotMatch(waiting, /accept set --id P\d-A\d --status 通过/u);

  const closing = withState((doc) => {
    const once = settled();
    const human = once.sessions[0].segments.at(-1).acceptance.find((item) => item.layer === "H");
    return passHumanAcceptance(once, { id: human.id, text: "位置我顺手，可以" }).doc;
  }).html;
  assert.match(closing, /class="lead">收尾这一段/u);

  const entering = withState((doc) => {
    const once = settled();
    const segment = once.sessions[0].segments.at(-1);
    const human = segment.acceptance.find((item) => item.layer === "H");
    return completeSegment(
      passHumanAcceptance(once, { id: human.id, text: "位置我顺手，可以" }).doc,
      {
        id: segment.id,
      },
    ).doc;
  }).html;
  assert.match(entering, /class="lead">进入验收/u);
  assert.match(entering, /npm run state -- set 验收/u);
});

test("the scope is on screen next to the decision", () => {
  const { html } = withState(layered);
  assert.match(html, /这一轮交付：<b>补一个能点开的入口<\/b> · 里程碑/u);
});

test("open findings are counted, not hardcoded to zero", () => {
  const { html } = withState(layered);
  assert.match(html, /<b>1\/1<\/b> 发现/u);
});

test("the page has one command, one copy button and a live status region", () => {
  const { html } = withState(layered);
  assert.equal((html.match(/class="cmd"/gu) ?? []).length, 1);
  assert.equal((html.match(/class="copy"/gu) ?? []).length, 1);
  assert.match(html, /role="status" id="status"/u);
});

test("only a focused open session is allowed to look alive", () => {
  const alive = withState(layered).html;
  assert.match(alive, /class="stage"/u);
  assert.match(alive, /class="seg live on"/u);
  const archived = withState((doc) => archiveSession(simple(), { reason: "先放一放" }).doc).html;
  assert.match(archived, /已归档/u);
  assert.doesNotMatch(archived, /data-current="true"/u);
});

test("an empty automatic segment is not drawn as history", () => {
  let doc = simple();
  doc = addSegment(doc, { name: "第一段" }).doc;
  const { html } = withState(() => doc);
  assert.equal((html.match(/class="seg /gu) ?? []).length, 1);
  assert.match(html, /class="seg-count">0\/0/u);
});

test("no session at all still gives a command", () => {
  const { html } = withState(() => emptyState());
  assert.match(html, /class="lead">没有在推进的会话/u);
  assert.match(html, /npm run state -- start &quot;要交付什么&quot;/u);
});

test("text from state is escaped", () => {
  const { html } = withState((doc) => {
    const opened = startSession(doc, { title: "转义" }).doc;
    const scoped = setScope(opened, { text: "写一段 <b>粗体</b>" }).doc;
    const segment = addSegment(scoped, { name: "<script>alert(1)</script>" }).doc;
    return addTask(segment, { text: "<img src=x onerror=1>" }).doc;
  });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
});

test("human acceptance still needs a real sentence", () => {
  const { doc } = withState(settled);
  const human = doc.sessions[0].segments.at(-1).acceptance.find((item) => item.layer === "H");
  assert.throws(() => passHumanAcceptance(doc, { id: human.id, text: "你的原话" }), /占位/u);
  const ok = passHumanAcceptance(doc, { id: human.id, text: "可以，位置我顺手" });
  assert.equal(ok.item.status, "通过");
});
