import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addAcceptance,
  addSegment,
  addTask,
  addWait,
  completeTask,
  completeSegment,
  emptyState,
  passHumanAcceptance,
  resolveFinding,
  setAcceptance,
  setScope,
  setState,
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
  const html = fs.readFileSync(file.output, "utf8");
  return { doc, html, root };
}

// One session with a daily segment and one named segment carrying every layer.
function layered() {
  let doc = startSession(emptyState(), { title: "把入口补上" }).doc;
  doc = setScope(doc, { text: "补一个能点开的入口", kind: "里程碑" }).doc;
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
  const segment = doc.sessions[0].segments.at(-1);
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

test("the page opens on the segment in progress, numbered against the total", () => {
  const { html } = withState(settled);
  assert.match(html, /class="focus-index mono">02</u);
  assert.match(html, /\/ 02/u);
  assert.match(html, /class="focus-name">入口这一段</u);
  assert.match(html, /class="scope"><span class="scope-kind">里程碑<\/span>补一个能点开的入口/u);
});

test("exactly one next action, and it is the mechanism's own command", () => {
  const { html } = withState(settled);
  const actions = html.match(/class="action"/gu) ?? [];
  assert.equal(actions.length, 1);
  assert.match(html, /npm run state -- accept human --id P\d-A\d/u);
  assert.doesNotMatch(html, /npm run state -- task done/u);
});

test("the spine lists every segment, with the current one open and done ones ticked", () => {
  const { html } = withState(settled);
  assert.equal((html.match(/class="node /gu) ?? []).length, 2);
  assert.match(html, /class="node done"/u);
  assert.match(html, /class="node live open"/u);
  assert.match(html, /2\/3/u);
  assert.match(html, /aria-expanded="true"/u);
});

test("layers are shapes with evidence on demand, never a text legend", () => {
  const { html } = withState(layered);
  assert.match(html, /<span class="shape shape-D" aria-hidden="true">▢<\/span>/u);
  assert.match(html, /<span class="shape shape-R" aria-hidden="true">◇<\/span>/u);
  assert.match(html, /class="ev" role="note">还没有证据/u);
  assert.match(html, /<span class="shape shape-H" aria-hidden="true">△<\/span>/u);
  assert.doesNotMatch(html, /没有这一层的判据/u);
});

test("evidence is escaped, so a scope text cannot inject markup", () => {
  let doc = startSession(emptyState(), { title: "转义" }).doc;
  doc = setScope(doc, { text: '带引号 "的" 范围 <b>粗</b>', kind: "修复" }).doc;
  const { html } = withState(() => doc);
  assert.match(html, /&lt;b&gt;粗&lt;\/b&gt;/u);
  assert.match(html, /&quot;的&quot;/u);
});

test("an empty state still tells you the one command that starts everything", () => {
  const { html } = withState(() => emptyState());
  assert.match(html, /npm run state -- start/u);
  assert.match(html, /还没有验收单元/u);
  assert.match(html, /state\.json · v4/u);
});

test("motion follows real activity: running sessions breathe, an empty state stands by", () => {
  const running = withState(settled).html;
  assert.match(running, /<body data-activity="live">/u);
  assert.match(running, /刚刚有动作|分钟前有动作/u);
  assert.match(running, /class="top-dots"/u);
  const standby = withState(() => emptyState()).html;
  assert.match(standby, /<body data-activity="standby">/u);
  assert.match(standby, /没有在推进的会话/u);
  assert.match(standby, /STANDBY/u);
});

test("discussion keeps the waits line, working sessions do not", () => {
  const discussing = withState(() => {
    let doc = startSession(emptyState(), { title: "还在想", discuss: true }).doc;
    doc = addWait(doc, { item: "要不要换载体" }).doc;
    return doc;
  }).html;
  assert.match(discussing, /class="waits"/u);
  assert.doesNotMatch(withState(settled).html, /class="waits"/u);
});
