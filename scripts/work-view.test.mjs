import assert from "node:assert/strict";
import test from "node:test";

import {
  addAcceptance,
  addPhase,
  addTask,
  completePhase,
  completeTask,
  emptyState,
  setAcceptance,
  setScope,
  setState,
  startPhase,
} from "../governance/core/state.mjs";
import { renderView } from "./work-view.mjs";

function fixture() {
  const now = new Date("2026-11-20T10:00:00+08:00");
  const doc = emptyState(now);
  setScope(doc, { text: "把工作台做出来", kind: "里程碑", now });
  setState(doc, { to: "执行", reason: "范围已定，开工", now });
  addPhase(doc, { name: "先能看", goal: "一轮就能判断", now });
  startPhase(doc, { id: "P1", now });
  addTask(doc, { phase: "P1", text: "画出 <骨架>", now });
  completeTask(doc, { id: "P1-T1", evidence: "截图生成成功", now });
  addAcceptance(doc, { phase: "P1", text: "页面上能看见现在该做", layer: "D", now });
  setAcceptance(doc, { id: "P1-A1", status: "通过", evidence: "手动打开过", now });
  completePhase(doc, { id: "P1", now });
  addPhase(doc, { name: "再做细", goal: "交互到位", now });
  startPhase(doc, { id: "P2", now });
  addTask(doc, { phase: "P2", text: "补上交互细节", now });
  return doc;
}

test("the view points at the next action and keeps the current phase open", () => {
  const view = renderView(fixture(), new Date("2026-11-20T10:00:00+08:00"));
  assert.match(view, /NEXT/u);
  assert.match(view, /npm run state -- task done --id P2-T1/u);
  assert.match(view, /<details class="phase live" open id="P2"/u);
  assert.match(view, /<details class="phase ok" id="P1"/u);
});

test("the view escapes state text instead of trusting it", () => {
  const view = renderView(fixture());
  assert.ok(view.includes("画出 &lt;骨架&gt;"));
  assert.ok(!view.includes("画出 <骨架>"));
});

test("the view reports counts and the signature state", () => {
  const view = renderView(fixture());
  assert.match(view, /尚未签收/u);
  assert.match(view, /2 阶段/u);
  assert.match(view, /复制/u);
  assert.match(view, /data-theme-toggle/u);
});
