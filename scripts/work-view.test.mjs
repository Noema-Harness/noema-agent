import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addAcceptance,
  addSegment,
  addTask,
  completeTask,
  emptyState,
  setScope,
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
  const file = writeView(root, path.join(root, "view.html"));
  const html = fs.readFileSync(file, "utf8");
  return { doc, html, root };
}

function simple() {
  let doc = startSession(emptyState(), { title: "把入口补上" }).doc;
  doc = setScope(doc, { text: "补一个能点开的入口" }).doc;
  return doc;
}

function layered() {
  let doc = simple();
  doc = addSegment(doc, { name: "入口这一段" }).doc;
  doc = startSegment(doc).doc;
  doc = addTask(doc, { text: "做一个入口" }).doc;
  doc = addAcceptance(doc, { text: "入口能点开", layer: "D" }).doc;
  doc = addAcceptance(doc, { text: "点开是目标页", layer: "C" }).doc;
  doc = addAcceptance(doc, { text: "用户觉得位置顺手", layer: "H" }).doc;
  return doc;
}

test("the view shows the focused session, its state and scope", () => {
  const { html } = withState(layered);
  assert.match(html, /EXECUTING/u);
  assert.match(html, /把入口补上/u);
  assert.match(html, /补一个能点开的入口/u);
  assert.match(html, /data-theme="dark"/u);
});

test("segments form the ledger and only the current one is open by default", () => {
  const { doc, html } = withState(layered);
  assert.match(html, /class="seg live on"/u);
  assert.match(html, /data-current="true"/u);
  const segmentCount = doc.sessions[0].segments.length;
  assert.equal((html.match(/class="seg [^"]*" data-seg=/gu) ?? []).length, segmentCount);
});

test("the next action is the only command and can be copied", () => {
  const { html } = withState(layered);
  assert.match(html, /class="cmd">npm run state/u);
  assert.match(html, /class="copy"/u);
});

test("evidence lives in hover cards and is escaped", () => {
  let doc = layered();
  doc = completeTask(doc, { id: "P2-T1", evidence: "<script>alert(1)</script> 跑过" }).doc;
  const { html } = withState(() => doc);
  assert.match(html, /class="ev"/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
});

test("acceptance uses shapes instead of a text legend, and H waits for the user", () => {
  const { html } = withState(layered);
  assert.match(html, /▢/u);
  assert.match(html, /○/u);
  assert.match(html, /△/u);
  assert.match(html, /等你/u);
  assert.doesNotMatch(html, /确定性｜可复核｜审查发现｜人签收/u);
});

test("the console is alive: caret, pulse and breathing dots are not decorative text", () => {
  const { html } = withState(layered);
  assert.match(html, /class="caret"/u);
  assert.match(html, /class="pulse"/u);
  assert.match(html, /@keyframes blink/u);
  assert.match(html, /prefers-reduced-motion/u);
});

test("a blank state invites the first command instead of rendering a session", () => {
  const { html } = withState((doc) => doc);
  assert.match(html, /还没有在推进的会话/u);
  assert.match(html, /npm run state -- start/u);
  assert.doesNotMatch(html, /class="seg /u);
});
