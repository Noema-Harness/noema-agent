import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addFindings,
  completeTask,
  emptyState,
  planTasks,
  recordReview,
  setScope,
  setState,
  signScope,
  startSession,
} from "../governance/core/state.mjs";
import { renderView } from "./work-view.mjs";

function fixture(build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-view-"));
  fs.mkdirSync(path.join(root, "governance", "data"), { recursive: true });
  const doc = build ? build(emptyState()) : emptyState();
  fs.writeFileSync(
    path.join(root, "governance", "data", "state.json"),
    `${JSON.stringify(doc, null, 2)}\n`,
  );
  return root;
}

function working() {
  const doc = startSession(emptyState(), { title: "把界面入口补齐并交付" }).doc;
  setScope(doc, { text: "把界面入口补齐，让第一次打开的人能用", kind: "里程碑" });
  planTasks(doc, {
    tasks: [
      { text: "补上入口按钮", standard: "点一下能打开对应界面", phase: "入口" },
      { text: "补上入口的说明", standard: "第一次打开的人能照着做完", phase: "入口" },
      { text: "清理旧入口", standard: "旧入口不再出现在界面上", phase: "收口" },
    ],
  });
  completeTask(doc, { id: "T1", evidence: ["手动点了一次按钮"] });
  return doc;
}

test("the console shows the session, its state and the scope in force", () => {
  const html = renderView(fixture(() => working()));
  assert.match(html, /把界面入口补齐并交付/u);
  assert.match(html, /EXECUTE/u);
  assert.match(html, /把界面入口补齐，让第一次打开的人能用/u);
  assert.match(html, /里程碑/u);
});

test("tasks carry their standard, their evidence and their phase", () => {
  const html = renderView(fixture(() => working()));
  assert.match(html, /点一下能打开对应界面/u);
  assert.match(html, /手动点了一次按钮/u);
  assert.match(html, /class="mark"[^>]*>✓/u);
  assert.match(html, /class="phase-head">入口<span>1\/2/u);
  assert.match(html, /class="phase-head">收口<span>0\/1/u);
});

test("findings keep the scope they came from and their disposition", () => {
  const doc = working();
  completeTask(doc, { id: "T2", evidence: ["照着说明走了一遍"] });
  recordReview(doc, { scope: "段", phase: "入口" });
  addFindings(doc, { findings: ["按钮没有键盘焦点样式"] });
  const html = renderView(fixture(() => doc));
  assert.match(html, /按钮没有键盘焦点样式/u);
  assert.match(html, /段 · 入口/u);
  assert.match(html, /class="finding open"/u);
  assert.match(html, /0\/0/u.test(html) ? html : /发现/u);
});

test("the next step is a sentence, and the command stays folded away", () => {
  const html = renderView(fixture(() => working()));
  assert.match(html, /下一步 · agent/u);
  assert.match(html, /做任务 T2/u);
  assert.match(html, /<summary>agent 会执行什么<\/summary>/u);
  assert.ok(!/<body[^>]*>[^<]*npm run state -- task done/u.test(html), "命令不应裸露在正文里");
});

test("counts follow the real data instead of a fixed string", () => {
  const doc = working();
  const before = renderView(fixture(() => doc));
  assert.match(before, /任务 <span>1\/3<\/span>/u);
  completeTask(doc, { id: "T2", evidence: ["照着说明走了一遍"] });
  completeTask(doc, { id: "T3", evidence: ["旧入口已删除"] });
  const after = renderView(fixture(() => doc));
  assert.match(after, /任务 <span>3\/3<\/span>/u);
});

test("an empty state teaches the first command instead of showing a blank page", () => {
  const html = renderView(fixture());
  assert.match(html, /还没有会话/u);
  assert.match(html, /npm run state -- start/u);
  assert.match(html, /没有在推进的会话/u);
});

test("an archived session keeps its sign line and says so", () => {
  const doc = working();
  completeTask(doc, { id: "T2", evidence: ["说明写完了"] });
  completeTask(doc, { id: "T3", evidence: ["旧入口删了"] });
  recordReview(doc, { scope: "段", phase: "入口" });
  recordReview(doc, { scope: "段", phase: "收口" });
  recordReview(doc, { scope: "总体" });
  setState(doc, { to: "验收", reason: "任务与审查都齐了" });
  signScope(doc, { text: "行，这一版可以交" });
  doc.sessions[0].status = "archived";
  doc.focus = null;
  const html = renderView(fixture(() => doc));
  assert.match(html, /ARCHIVED/u);
  assert.match(html, /已签收/u);
});

test("the page escapes whatever the data holds", () => {
  const doc = startSession(emptyState(), { title: "标题里带 <script>alert(1)</script>" }).doc;
  planTasks(doc, { tasks: [{ text: "带 <b> 的任务", standard: "标准也带 <i> 标记" }] });
  const html = renderView(fixture(() => doc));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/u);
  assert.match(html, /&lt;b&gt;/u);
});

test("the light theme is the default and the switch is labelled", () => {
  const html = renderView(fixture(() => working()));
  assert.match(html, /<html lang="zh-CN" data-theme="light">/u);
  assert.match(html, /aria-label="切换明暗"/u);
  assert.match(html, /data-activity="live"/u);
});
