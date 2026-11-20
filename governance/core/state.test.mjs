import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STATE_VERSION,
  addAcceptance,
  addRound,
  addSegment,
  addTask,
  addWait,
  archiveSession,
  briefLines,
  completeSegment,
  completeTask,
  currentSegment,
  dropWait,
  emptyState,
  focusSession,
  listSessions,
  logOf,
  nextAction,
  openFindings,
  passHumanAcceptance,
  progressLines,
  resolveFinding,
  setAcceptance,
  setAcceptanceText,
  setScope,
  setState,
  signScope,
  startSegment,
  startSession,
  summaryLines,
  switchSession,
  upgradeState,
  validateState,
  workProgress,
} from "./state.mjs";

function session(doc = emptyState()) {
  return startSession(doc, { title: "一条小任务" }).doc;
}

function scoped(doc) {
  return setScope(doc, { text: "发一条能直接检查的变更" }).doc;
}

test("a fresh state opens no session and the focus is empty", () => {
  const doc = emptyState();
  assert.equal(doc.version, STATE_VERSION);
  assert.equal(doc.focus, null);
  assert.deepEqual(doc.sessions, []);
  assert.equal(focusSession(doc), null);
  assert.match(nextAction(doc).command, /state -- start/u);
});

test("a session starts in execution unless asked to discuss", () => {
  const direct = session();
  assert.equal(direct.sessions[0].state, "执行");
  assert.equal(direct.sessions[0].status, "open");
  assert.equal(direct.sessions[0].segments.length, 1);
  assert.equal(direct.sessions[0].segments[0].labeled, false);

  const talking = startSession(emptyState(), { title: "先聊聊", discuss: true }).doc;
  assert.equal(talking.sessions[0].state, "讨论");
  assert.equal(addRound(talking, { conclusion: "方向基本明确" }).doc.sessions[0].threads.length, 1);
});

test("sessions do not block each other and live side by side", () => {
  const first = session();
  const { doc, session: second } = startSession(first, { title: "另一件交付" });
  assert.equal(doc.focus, second.id);
  assert.equal(doc.sessions.length, 2);
  assert.equal(doc.sessions[0].state, "执行");

  const back = switchSession(doc, { id: "S1" }).doc;
  assert.equal(focusSession(back).title, "一条小任务");
  assert.equal(back.sessions[1].state, "执行");

  const closed = archiveSession(back, { reason: "这件事做完了" }).doc;
  assert.equal(closed.focus, null);
  assert.equal(closed.sessions[0].status, "archived");
  assert.equal(closed.sessions[1].status, "open");

  const again = switchSession(closed, { id: "S2" }).doc;
  assert.equal(focusSession(again).state, "执行");
});

test("a session can move between states at any time, with a reason", () => {
  let doc = scoped(session());
  doc = setState(doc, { to: "验收", reason: "想直接看看能不能签" }).doc;
  assert.equal(focusSession(doc).state, "验收");
  doc = setState(doc, { to: "讨论", reason: "发现方向要重定" }).doc;
  assert.equal(focusSession(doc).state, "讨论");
  assert.throws(() => setState(doc, { to: "执行", reason: " " }), /--reason/u);
});

test("a daily segment keeps a flat list and closes without acceptance", () => {
  let doc = scoped(session());
  const daily = currentSegment(doc);
  assert.equal(daily.labeled, false);
  doc = addTask(doc, { text: "装一下插件" }).doc;
  doc = addTask(doc, { text: "再装一个" }).doc;
  assert.throws(() => completeSegment(doc), /任务没完成/u);
  doc = completeTask(doc, { id: daily.tasks[0].id, evidence: "版本号对上了" }).doc;
  doc = completeTask(doc, { id: daily.tasks[1].id, evidence: "启动能看到菜单" }).doc;
  doc = completeSegment(doc).doc;
  assert.equal(currentSegment(doc).status, "已完成");
});

test("a labeled segment needs done tasks and a passed D/C/H acceptance", () => {
  let doc = scoped(session());
  doc = addSegment(doc, { name: "这一大段：把入口做出来" }).doc;
  const labeled = currentSegment(doc);
  assert.equal(labeled.labeled, true);
  assert.equal(labeled.status, "进行中");

  doc = startSegment(doc).doc;
  doc = addAcceptance(doc, { text: "入口打开后能看到下一步", layer: "D" }).doc;
  doc = addAcceptance(doc, { text: "点两下就能到目标页", layer: "C" }).doc;
  doc = addAcceptance(doc, { text: "第一次用的人不会卡住", layer: "H" }).doc;
  doc = addTask(doc, { text: "做一个入口" }).doc;
  const task = currentSegment(doc).tasks[0];
  doc = completeTask(doc, { id: task.id, evidence: "本地跑通了" }).doc;
  assert.throws(() => completeSegment(doc), /没判/u);

  const [d, c, h] = currentSegment(doc).acceptance;
  doc = setAcceptance(doc, { id: d.id, status: "通过", evidence: "work-view.test.mjs 覆盖" }).doc;
  doc = setAcceptance(doc, { id: c.id, status: "通过", evidence: "点两下确实到" }).doc;
  assert.throws(() => completeSegment(doc), /用户|没判/u);
  doc = passHumanAcceptance(doc, { id: h.id, text: "打开就知道干什么" }).doc;
  doc = completeSegment(doc).doc;
  assert.equal(currentSegment(doc).status, "已完成");
});

test("evidence is required to finish a task or judge an acceptance", () => {
  let doc = scoped(session());
  doc = addTask(doc, { text: "改一行" }).doc;
  const task = currentSegment(doc).tasks[0];
  assert.throws(() => completeTask(doc, { id: task.id }), /evidence/u);
  assert.throws(() => completeTask(doc, { id: task.id, evidence: "看" }), /evidence/u);
  doc = completeTask(doc, { id: task.id, evidence: "改动只影响文案" }).doc;

  doc = addAcceptance(doc, { text: "页面读得清", layer: "C" }).doc;
  const item = currentSegment(doc).acceptance[0];
  assert.throws(() => setAcceptance(doc, { id: item.id, status: "通过" }), /evidence/u);
  assert.throws(() => setAcceptanceText(doc, { id: item.id, text: "" }), /--text/u);
});

test("the agent cannot judge H, and review findings must be resolved", () => {
  let doc = scoped(session());
  doc = addAcceptance(doc, { text: "用户看着顺眼", layer: "H" }).doc;
  doc = addAcceptance(doc, { text: "顺手发现的问题", layer: "R" }).doc;
  const [human, review] = currentSegment(doc).acceptance;
  assert.throws(
    () => setAcceptance(doc, { id: human.id, status: "通过", evidence: "我觉得可以" }),
    /用户/u,
  );
  assert.throws(
    () => setAcceptance(doc, { id: review.id, status: "通过", evidence: "没问题" }),
    /审查发现/u,
  );
  assert.throws(() => resolveFinding(doc, { id: review.id, decision: "延期" }), /--note/u);
  doc = resolveFinding(doc, { id: review.id, decision: "延期", note: "等下一轮一起改" }).doc;
  assert.equal(openFindings(doc).length, 0);
  assert.equal(workProgress(doc).openFindings, 0);
});

test("signing needs labeled segments done and everything passing", () => {
  let doc = scoped(session());
  assert.throws(() => signScope(doc, { text: "可以了" }), /验收态/u);

  doc = addSegment(doc, { name: "这一段：把入口做出来" }).doc;
  doc = startSegment(doc).doc;
  doc = addAcceptance(doc, { text: "入口能看到下一步", layer: "D" }).doc;
  doc = setState(doc, { to: "验收", reason: "做完了" }).doc;
  assert.throws(() => signScope(doc, { text: "可以了" }), /没通过|段没完成/u);
  const item = currentSegment(doc).acceptance[0];
  doc = setAcceptance(doc, { id: item.id, status: "通过", evidence: "打开就能看到" }).doc;
  doc = completeSegment(doc).doc;
  doc = signScope(doc, { text: "可以了，下一件事吧" }).doc;
  assert.equal(focusSession(doc).scope.signed.text, "可以了，下一件事吧");
  assert.deepEqual(validateState(doc), []);
});

test("the next action follows the session instead of a fixed pipeline", () => {
  let doc = session();
  assert.equal(nextAction(doc).label, "写清这次交付");
  doc = scoped(doc);
  assert.match(nextAction(doc).command, /task add|segment/u);
});

test("summaries expose the focused session and the other open ones", () => {
  const doc = startSession(scoped(session()), { title: "另一件交付" }).doc;
  const text = summaryLines(doc).join("\n");
  assert.match(text, /另一件交付/u);
  assert.match(text, /执行/u);
  assert.match(progressLines(doc).join("\n"), /S2/u);
  assert.match(briefLines(doc).join("\n"), /现在该做|下一步/u);
});

test("state validation rejects a session that lies about its progress", () => {
  const doc = JSON.parse(JSON.stringify(session()));
  const segment = doc.sessions[0].segments[0];
  segment.tasks.push({
    id: "P1-T1",
    text: "做完的事",
    status: "已完成",
    evidence: [],
    doneAt: "2026-11-20",
  });
  assert.match(validateState(doc).join("；"), /证据/u);
});

test("a v3 state upgrades into a single session with its work intact", () => {
  const legacy = {
    version: 3,
    current: { threadId: "thread-1", by: null, state: "执行", since: "2026-11-19" },
    threads: [{ id: "thread-1", title: "旧讨论", status: "active", rounds: [], waits: [] }],
    work: {
      scope: { text: "旧范围", kind: "里程碑", signed: null },
      phases: [
        {
          id: "P1",
          name: "旧阶段",
          goal: null,
          status: "已完成",
          createdAt: "2026-11-19",
          doneAt: "2026-11-19",
          tasks: [],
          acceptance: [],
        },
      ],
    },
    log: [{ date: "2026-11-19", from: "讨论", to: "执行", reason: "开始做" }],
  };
  const doc = upgradeState(legacy);
  assert.equal(doc.version, 4);
  assert.equal(doc.sessions.length, 1);
  assert.equal(doc.focus, doc.sessions[0].id);
  assert.equal(doc.sessions[0].scope.text, "旧范围");
  assert.equal(doc.sessions[0].segments[0].name, "旧阶段");
  assert.equal(doc.log[0].sessionId, doc.sessions[0].id);
  assert.deepEqual(validateState(doc), []);
  assert.equal(listSessions(doc).length, 1);
  assert.equal(logOf(doc).length, 1);
});

test("waits belong to the discussion thread of the focused session", () => {
  let doc = startSession(emptyState(), { title: "先定方向", discuss: true }).doc;
  doc = addWait(doc, { item: "接口要不要缓存" }).doc;
  assert.match(focusSession(doc).threads[0].waits.join(), /缓存/u);
  doc = dropWait(doc, { item: "接口要不要缓存" }).doc;
  assert.deepEqual(focusSession(doc).threads[0].waits, []);
});

test("placeholder words never pass the gates", () => {
  let doc = session();
  const { session: opened } = { session: focusSession(doc) };
  doc = startSegment(doc, { name: "判定台" }).doc;
  const segment = doc.sessions[0].segments.at(-1);
  doc = addAcceptance(doc, { segmentId: segment.id, text: "人看过一眼", layer: "H" }).doc;
  const human = doc.sessions[0].segments.at(-1).acceptance.at(-1);
  assert.throws(() => passHumanAcceptance(doc, { id: human.id, text: "你的原话" }), /占位/u);
  assert.throws(
    () => passHumanAcceptance(doc, { id: human.id, text: "‹用户的签收原话›" }),
    /占位/u,
  );
  doc = addAcceptance(doc, { segmentId: segment.id, text: "测试通过", layer: "D" }).doc;
  const gate = doc.sessions[0].segments.at(-1).acceptance.at(-1);
  assert.throws(
    () => setAcceptance(doc, { id: gate.id, status: "通过", evidence: ["做完的依据"] }),
    /占位/u,
  );
  doc = addTask(doc, { text: "改一处文案" }).doc;
  const task = doc.sessions[0].segments.at(-1).tasks.at(-1);
  assert.throws(() => completeTask(doc, { id: task.id, evidence: "做完的依据" }), /占位/u);
  assert.throws(() => signScope(doc, { text: "可以收口" }), /占位|验收态|段/u);
  assert.ok(opened);
});
