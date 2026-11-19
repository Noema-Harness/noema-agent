import assert from "node:assert/strict";
import test from "node:test";

import {
  addAcceptance,
  addPhase,
  addTask,
  completePhase,
  completeTask,
  emptyState,
  passHumanAcceptance,
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
  addAcceptance(doc, { phase: "P1", text: "由我判断顺手不顺手", layer: "H", now });
  setAcceptance(doc, { id: "P1-A1", status: "通过", evidence: "手动打开过", now });
  passHumanAcceptance(doc, { id: "P1-A2", text: "位置可以", now });
  completePhase(doc, { id: "P1", now });
  addPhase(doc, { name: "再做细", goal: "交互到位", now });
  startPhase(doc, { id: "P2", now });
  addTask(doc, { phase: "P2", text: "补上交互细节", now });
  addAcceptance(doc, { phase: "P2", text: "悬停能看到证据", layer: "C", now });
  return doc;
}

test("the focus names the current phase and carries the single next action", () => {
  const view = renderView(fixture(), new Date("2026-11-20T10:00:00+08:00"));
  assert.match(view, /<span class="focus-index mono">02<\/span>/u);
  assert.match(view, /<h1 class="focus-name">再做细<\/h1>/u);
  assert.match(view, /npm run state -- task done --id P2-T1/u);
  assert.match(view, /class="action"/u);
});

test("only the current phase is open, the finished one is closed", () => {
  const view = renderView(fixture());
  assert.match(
    view,
    /<li class="node live open" data-phase="P2"[^>]*>[\s\S]*?aria-expanded="true"/u,
  );
  assert.match(view, /<li class="node done" data-phase="P1"[^>]*>[\s\S]*?aria-expanded="false"/u);
});

test("the view escapes state text instead of trusting it", () => {
  const view = renderView(fixture());
  assert.ok(view.includes("画出 &lt;骨架&gt;"));
  assert.ok(!view.includes("画出 <骨架>"));
});

test("evidence stays hidden until the row is hovered", () => {
  const view = renderView(fixture());
  assert.match(view, /<span class="ev" role="note">截图生成成功<\/span>/u);
  assert.match(view, /<span class="ev" role="note">手动打开过<\/span>/u);
});

test("layers are carried by shapes, not by a legend", () => {
  const view = renderView(fixture());
  assert.match(view, /shape shape-D/u);
  assert.match(view, /shape shape-H/u);
  assert.match(view, /shape shape-C/u);
  assert.doesNotMatch(view, /RECENT|近期动态|阶段 · 任务 · 验收/u);
});

test("a blank state still renders the command that starts the work", () => {
  const view = renderView(emptyState(new Date("2026-11-20T10:00:00+08:00")));
  assert.match(view, /还没有验收单元/u);
  assert.match(view, /npm run state -- title/u);
});
