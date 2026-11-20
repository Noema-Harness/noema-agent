// The governance state machine.
//
// Four objects carry a session: rounds (what was decided in discussion), tasks
// (what is being built, each with its own standard and evidence), findings
// (what an independent reviewer objected to), and the signature (the user's
// own words). A segment is never a first-class node — it is only an optional
// phase field on a task, used to cut reviews at a boundary. Nothing outside
// this file knows how the file is stored.

export const STATES = ["讨论", "执行", "验收"];
export const PACK_BY_STATE = {
  讨论: "discussion.md",
  执行: "execution.md",
  验收: "acceptance.md",
};
export const ENDINGS = ["定案", "归档"];
export const TASK_STATUSES = ["未完成", "已完成"];
export const FINDING_SCOPES = ["段", "总体"];
export const FINDING_STATUSES = ["未处置", "已修", "延期", "接受"];
export const STATE_VERSION = 5;
export const SCOPE_KINDS = ["里程碑", "修复"];

const THREAD_FIELDS = {
  id: "string",
  title: ["string", "null"],
  startedAt: "string",
  status: "string",
  endedAt: ["string", "null"],
  ending: ["string", "null"],
  rounds: "array",
  waits: "array",
  evidence: "array",
};

function matchesKind(value, kind) {
  if (kind === "null") return value === null;
  if (kind === "array") return Array.isArray(value);
  if (kind === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === kind;
}

function isDateLike(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/u.test(value);
}

function today(now) {
  return now.toISOString().slice(0, 10);
}

function nextId(prefix, used) {
  let index = used.size + 1;
  let candidate = `${prefix}${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${prefix}${index}`;
  }
  return candidate;
}

function nextThreadId(session, now) {
  const stamp = today(now).replaceAll("-", "");
  const used = new Set(session.threads.map((thread) => thread.id));
  let index = session.threads.length + 1;
  let candidate = `thread-${stamp}-${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `thread-${stamp}-${index}`;
  }
  return candidate;
}

function textOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function emptySession({
  id = "S1",
  title = "未命名会话",
  discuss = false,
  now = new Date(),
} = {}) {
  return {
    id,
    title,
    status: "open",
    state: discuss ? "讨论" : "执行",
    since: now.toISOString(),
    scope: null,
    tasks: [],
    findings: [],
    reviews: [],
    sign: null,
    threads: [],
    threadId: null,
    log: [],
  };
}

export function emptyState() {
  return { version: STATE_VERSION, focus: null, sessions: [], log: [] };
}

// Version 4 and older carried segments with an acceptance table (D/C/R/H).
// That structure is retired: phase is now an optional field on a task, and a
// review finding is its own object. Old data is archived by the caller, never
// silently reshaped, so history keeps saying what actually happened.
export function upgradeState(raw) {
  if (!raw || typeof raw !== "object") throw new Error("状态数据不是对象");
  if (raw.version !== STATE_VERSION)
    throw new Error(
      `状态数据版本 ${String(raw.version)} 已退役：先把 governance/data/state.json 归档到 history.json，再用 npm run state -- start 开新会话（现行版本 ${STATE_VERSION}）`,
    );
  return raw;
}

export function validateState(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") return ["状态数据不是对象"];
  if (doc.version !== STATE_VERSION)
    errors.push(`状态数据版本应为 ${STATE_VERSION}，实际为 ${String(doc.version)}`);
  if (!Array.isArray(doc.log)) errors.push("状态数据缺少 log 数组");
  if (!Array.isArray(doc.sessions)) errors.push("状态数据缺少 sessions 数组");
  if (doc.focus !== null && typeof doc.focus !== "string")
    errors.push("focus 只能是会话 id 或 null");
  if (typeof doc.focus === "string") {
    const focused = (doc.sessions ?? []).find((session) => session.id === doc.focus);
    if (!focused) errors.push(`focus 指向不存在的会话：${doc.focus}`);
    else if (focused.status !== "open") errors.push(`focus 指向已归档的会话：${doc.focus}`);
  }
  const sessionIds = new Set();
  for (const session of doc.sessions ?? []) {
    const where = `会话 ${String(session.id)}`;
    if (typeof session.id !== "string" || !/^S\d+$/u.test(session.id))
      errors.push(`会话 id 不合规：${String(session.id)}`);
    if (sessionIds.has(session.id)) errors.push(`会话 id 重复：${session.id}`);
    sessionIds.add(session.id);
    if (typeof session.title !== "string" || session.title.trim().length < 2)
      errors.push(`${where} 缺少名字`);
    if (session.status !== "open" && session.status !== "archived")
      errors.push(`${where} 的 status 只能是 open 或 archived`);
    if (!STATES.includes(session.state)) errors.push(`${where} 的状态不合规`);
    if (!isDateLike(session.since)) errors.push(`${where} 的 since 不是日期`);
    if (!Array.isArray(session.log)) errors.push(`${where} 缺少 log 数组`);
    if (!Array.isArray(session.threads)) errors.push(`${where} 缺少 threads 数组`);
    if (!Array.isArray(session.tasks)) errors.push(`${where} 缺少 tasks 数组`);
    if (!Array.isArray(session.findings)) errors.push(`${where} 缺少 findings 数组`);
    if (!Array.isArray(session.reviews)) errors.push(`${where} 缺少 reviews 数组`);
    if (session.scope !== null) {
      if (typeof session.scope !== "object") errors.push(`${where} 的 scope 不合规`);
      else {
        if (textOf(session.scope.text).length < 4) errors.push(`${where} 的范围太短`);
        if (!SCOPE_KINDS.includes(session.scope.kind ?? "里程碑"))
          errors.push(`${where} 的范围类型只能是 ${SCOPE_KINDS.join(" / ")}`);
      }
    }
    const threadId = session.threadId ?? null;
    if (threadId !== null && !(session.threads ?? []).some((thread) => thread.id === threadId))
      errors.push(`${where} 的 threadId 指向不存在的讨论线：${String(threadId)}`);
    const threadIds = new Set();
    for (const thread of session.threads ?? []) {
      for (const [field, kind] of Object.entries(THREAD_FIELDS)) {
        const value = thread[field];
        const allowed = Array.isArray(kind) ? kind : [kind];
        if (!allowed.some((one) => matchesKind(value, one)))
          errors.push(`${where} 的讨论线 ${String(thread.id)} 的 ${field} 不合规`);
      }
      if (threadIds.has(thread.id)) errors.push(`${where} 讨论线 id 重复：${thread.id}`);
      threadIds.add(thread.id);
      if (thread.status !== "active" && thread.status !== "archived")
        errors.push(`${where} 讨论线 ${String(thread.id)} 的 status 只能是 active 或 archived`);
      if (thread.status === "archived" && !ENDINGS.includes(thread.ending))
        errors.push(`${where} 讨论线 ${String(thread.id)} 归档时必须写定案或归档`);
    }

    const taskIds = new Set();
    const phases = new Set();
    for (const task of session.tasks ?? []) {
      const label = `${where} 的任务 ${String(task.id)}`;
      if (typeof task.id !== "string" || !/^T\d+$/u.test(task.id))
        errors.push(`任务 id 不合规：${String(task.id)}`);
      if (taskIds.has(task.id)) errors.push(`${where} 任务 id 重复：${task.id}`);
      taskIds.add(task.id);
      if (textOf(task.text).length < 4) errors.push(`${label} 太短`);
      if (textOf(task.standard).length < 4) errors.push(`${label} 缺少做完的标准`);
      if (task.phase !== null && typeof task.phase !== "string")
        errors.push(`${label} 的 phase 只能是字符串或 null`);
      if (typeof task.phase === "string") phases.add(task.phase);
      if (!TASK_STATUSES.includes(task.status)) errors.push(`${label} 状态不合规`);
      if (!Array.isArray(task.evidence)) errors.push(`${label} 缺少证据数组`);
      if (task.status === "已完成" && task.evidence.length === 0)
        errors.push(`${label} 已完成但没有证据`);
      if (task.fromFinding !== null && typeof task.fromFinding !== "string")
        errors.push(`${label} 的 fromFinding 只能是发现 id 或 null`);
    }

    const findingIds = new Set();
    for (const finding of session.findings ?? []) {
      const label = `${where} 的发现 ${String(finding.id)}`;
      if (typeof finding.id !== "string" || !/^F\d+$/u.test(finding.id))
        errors.push(`发现 id 不合规：${String(finding.id)}`);
      if (findingIds.has(finding.id)) errors.push(`${where} 发现 id 重复：${finding.id}`);
      findingIds.add(finding.id);
      if (textOf(finding.text).length < 4) errors.push(`${label} 太短`);
      if (!FINDING_SCOPES.includes(finding.scope)) errors.push(`${label} 的 scope 不合规`);
      if (!FINDING_STATUSES.includes(finding.status)) errors.push(`${label} 状态不合规`);
      if (finding.phase !== null && typeof finding.phase !== "string")
        errors.push(`${label} 的 phase 只能是字符串或 null`);
      if (finding.status !== "未处置" && textOf(finding.note ?? "").length < 4)
        errors.push(`${label} 处置了但没有写理由`);
      if (finding.status === "已修" && finding.taskId === null && !textOf(finding.evidence ?? ""))
        errors.push(`${label} 标为已修，却没有修复任务或证据`);
    }

    for (const review of session.reviews ?? []) {
      if (typeof review.id !== "string" || !/^V\d+$/u.test(review.id))
        errors.push(`${where} 的审查记录 id 不合规：${String(review.id)}`);
      if (!FINDING_SCOPES.includes(review.scope)) errors.push(`${where} 审查范围不合规`);
      if (!isDateLike(review.at)) errors.push(`${where} 审查时间不是日期`);
    }

    if (session.sign !== null) {
      if (!isDateLike(session.sign.date)) errors.push(`${where} 的签收日期不合规`);
      if (textOf(session.sign.text).length < 4) errors.push(`${where} 的签收原话太短`);
    }
  }
  return errors;
}

export function focusSession(doc) {
  if (!doc.focus) return null;
  return (doc.sessions ?? []).find((session) => session.id === doc.focus) ?? null;
}

export function requireSession(doc) {
  const session = focusSession(doc);
  if (!session) throw new Error('当前没有在推进的会话：先 npm run state -- start "要交付什么"');
  return session;
}

export function openSessions(doc) {
  return (doc.sessions ?? []).filter((session) => session.status === "open");
}

export function listSessions(doc) {
  return (doc.sessions ?? []).map((session) => ({
    id: session.id,
    title: session.title,
    status: session.status,
    state: session.state,
    since: session.since,
    signed: Boolean(session.sign),
    tasks: session.tasks.length,
    tasksDone: session.tasks.filter((task) => task.status === "已完成").length,
    openFindings: session.findings.filter((f) => f.status === "未处置").length,
  }));
}

export function startSession(doc, { title, discuss = false, now = new Date() } = {}) {
  if (focusSession(doc))
    throw new Error(`已经有在推进的会话 ${doc.focus}：先 close 收口，或用 switch 切到别的会话`);
  const id = nextId("S", new Set((doc.sessions ?? []).map((session) => session.id)));
  const session = emptySession({ id, title: textOf(title), discuss, now });
  if (session.title.length < 4) throw new Error("会话名太短：一句话说清这次要交付什么");
  doc.sessions.push(session);
  doc.focus = id;
  doc.log.push({
    date: now.toISOString(),
    sessionId: id,
    event: "start",
    detail: `${session.title}（${session.state}）`,
  });
  if (discuss) ensureThread(doc, { now });
  return { doc, session };
}

export function switchSession(doc, { id, now = new Date() } = {}) {
  const session = (doc.sessions ?? []).find((one) => one.id === id);
  if (!session) throw new Error(`没有这个会话：${String(id)}`);
  if (session.status !== "open") throw new Error(`会话 ${id} 已归档，只能看，不能切过去`);
  doc.focus = id;
  doc.log.push({ date: now.toISOString(), sessionId: id, event: "switch", detail: session.title });
  return { doc, session };
}

export function archiveSession(doc, { reason = "这个会话的交付已经结束", now = new Date() } = {}) {
  const session = requireSession(doc);
  session.status = "archived";
  session.archivedAt = now.toISOString();
  session.archiveReason = reason;
  doc.focus = null;
  doc.log.push({
    date: now.toISOString(),
    sessionId: session.id,
    event: "close",
    detail: reason,
  });
  return { doc, session };
}

function recordTransition(doc, session, { from, to, reason, obligation, now }) {
  const entry = {
    date: now.toISOString(),
    sessionId: session.id,
    event: "state",
    detail: `${from} → ${to}`,
    reason,
  };
  if (obligation) entry.obligation = obligation;
  session.log.push(entry);
  doc.log.push(entry);
  return entry;
}

export function activeThread(doc) {
  const session = focusSession(doc);
  if (!session || !session.threadId) return null;
  return session.threads.find((thread) => thread.id === session.threadId) ?? null;
}

export function threadById(doc, id) {
  for (const session of doc.sessions ?? []) {
    const thread = session.threads.find((one) => one.id === id);
    if (thread) return thread;
  }
  return null;
}

export function ensureThread(doc, { title = null, now = new Date() } = {}) {
  const session = requireSession(doc);
  const existing = session.threadId
    ? session.threads.find((thread) => thread.id === session.threadId)
    : null;
  if (existing && existing.status === "active") return { doc, thread: existing };
  const thread = {
    id: nextThreadId(session, now),
    title: title ?? `${session.title} · 讨论`,
    startedAt: now.toISOString(),
    status: "active",
    endedAt: null,
    ending: null,
    rounds: [],
    waits: [],
    evidence: [],
    output: {},
  };
  session.threads.push(thread);
  session.threadId = thread.id;
  return { doc, thread };
}

export function archiveThread(doc, { id = null, ending = "归档", now = new Date() } = {}) {
  const session = requireSession(doc);
  const thread = id
    ? session.threads.find((one) => one.id === id)
    : session.threadId
      ? session.threads.find((one) => one.id === session.threadId)
      : null;
  if (!thread) throw new Error("没有可归档的讨论线");
  thread.status = "archived";
  thread.endedAt = now.toISOString();
  thread.ending = ending;
  if (session.threadId === thread.id) session.threadId = null;
  return { doc, thread };
}

export function lastArchivedThread(doc) {
  const session = focusSession(doc);
  if (!session) return null;
  return [...session.threads].reverse().find((thread) => thread.status === "archived") ?? null;
}

export function resumeThread(doc, { id = null, now = new Date() } = {}) {
  const session = requireSession(doc);
  const thread = id ? session.threads.find((one) => one.id === id) : lastArchivedThread(doc);
  if (!thread) throw new Error("没有可恢复的讨论线");
  if (thread.status === "archived" && thread.ending === "定案")
    throw new Error(`讨论线 ${thread.id} 已定案，不能再接着讨论：开新的会话或直接执行`);
  thread.status = "active";
  thread.endedAt = null;
  thread.ending = null;
  session.threadId = thread.id;
  session.threads = [...session.threads.filter((one) => one.id !== thread.id), thread];
  return { doc, thread };
}

export function setState(doc, { to, reason = null, obligation = null, now = new Date() }) {
  const session = requireSession(doc);
  if (!STATES.includes(to)) throw new Error(`状态只能是 ${STATES.join(" / ")}`);
  const from = session.state;
  if (from === to) throw new Error(`已经在「${to}」状态`);
  if (textOf(reason ?? "").length < 2) throw new Error('切换状态要写一句原因：--reason "…"');

  if (to === "验收") {
    const open = session.tasks.filter((task) => task.status !== "已完成");
    if (open.length > 0)
      throw new Error(`还有 ${open.length} 个任务没做完：先 task done，再进验收`);
    const reviews = session.reviews.filter((review) => review.scope === "总体");
    if (reviews.length === 0)
      throw new Error("还没有总体审查：先 review log --scope 总体 <发现文件>，再审自己的活");
  }
  if (to === "讨论") {
    const thread = ensureThread(doc, { now });
    if (thread.thread.status !== "active") resumeThread(doc, { id: thread.thread.id, now });
  }
  if (from === "讨论" && to === "执行" && !session.scope)
    throw new Error('讨论还没有收口成范围：先 scope "这一轮要交付什么"，再进执行');
  if (from === "讨论") {
    const thread = session.threadId
      ? session.threads.find((one) => one.id === session.threadId)
      : null;
    if (thread && thread.status === "active") {
      thread.status = "archived";
      thread.endedAt = now.toISOString();
      thread.ending = "归档";
      session.threadId = null;
    }
  }
  session.state = to;
  session.since = now.toISOString();
  recordTransition(doc, session, { from, to, reason: textOf(reason), obligation, now });
  return { doc, session };
}

export function addRound(doc, { conclusion, change = null, now = new Date() } = {}) {
  const session = requireSession(doc);
  const thread = activeThread(doc);
  if (!thread) throw new Error("没有在进行的讨论线：先 set 讨论");
  if (textOf(conclusion).length < 4) throw new Error('轮次要写结论：--conclusion "…"');
  const round = {
    n: thread.rounds.length + 1,
    date: today(now),
    conclusion: textOf(conclusion),
    change: change ? textOf(change) : null,
  };
  thread.rounds.push(round);
  session.since = now.toISOString();
  return { doc, round };
}

export function addWait(doc, { item, now = new Date() } = {}) {
  const session = requireSession(doc);
  const thread = activeThread(doc) ?? ensureThread(doc, { now }).thread;
  if (textOf(item).length < 4) throw new Error("待裁要写清楚是什么问题");
  if (thread.waits.includes(textOf(item))) throw new Error("这条已经悬着了");
  thread.waits.push(textOf(item));
  return { doc, thread };
}

export function dropWait(doc, { item, now = new Date() } = {}) {
  const session = requireSession(doc);
  const thread = activeThread(doc);
  if (!thread) throw new Error("没有在进行的讨论线");
  const index = thread.waits.indexOf(textOf(item));
  if (index < 0) throw new Error(`这条不在待裁里：${String(item)}`);
  thread.waits.splice(index, 1);
  return { doc, thread };
}

export function setScope(doc, { text, kind = "里程碑", now = new Date() } = {}) {
  const session = requireSession(doc);
  if (!SCOPE_KINDS.includes(kind)) throw new Error(`范围类型只能是 ${SCOPE_KINDS.join(" / ")}`);
  if (textOf(text).length < 4) throw new Error("范围太短：一句话说清这次交付什么");
  session.scope = { text: textOf(text), kind, since: now.toISOString() };
  session.since = now.toISOString();
  return { doc, scope: session.scope };
}

export function phasesOf(session) {
  const seen = [];
  for (const task of session.tasks) {
    const phase = task.phase ?? null;
    if (phase !== null && !seen.includes(phase)) seen.push(phase);
  }
  return seen;
}

export function tasksInPhase(session, phase) {
  if (phase === null) return session.tasks.filter((task) => task.phase === null);
  return session.tasks.filter((task) => task.phase === phase);
}

export function addTask(doc, { text, standard, phase = null, now = new Date() } = {}) {
  const session = requireSession(doc);
  if (textOf(text).length < 4) throw new Error("任务太短：写清楚要做什么");
  if (textOf(standard).length < 4) throw new Error('任务要写做完的标准：--standard "…"');
  const task = {
    id: nextId("T", new Set(session.tasks.map((one) => one.id))),
    text: textOf(text),
    standard: textOf(standard),
    phase: phase ? textOf(phase) : null,
    status: "未完成",
    evidence: [],
    createdAt: now.toISOString(),
    doneAt: null,
    fromFinding: null,
  };
  session.tasks.push(task);
  session.since = now.toISOString();
  return { doc, task };
}

export function planTasks(doc, { tasks, now = new Date() } = {}) {
  const session = requireSession(doc);
  const added = [];
  for (const item of tasks ?? []) {
    const result = addTask(doc, {
      text: item.text,
      standard: item.standard,
      phase: item.phase ?? null,
      now,
    });
    added.push(result.task);
  }
  return { doc, tasks: added };
}

export function findTask(doc, id) {
  const session = requireSession(doc);
  return session.tasks.find((task) => task.id === id) ?? null;
}

export function completeTask(doc, { id, evidence = [], now = new Date() } = {}) {
  const session = requireSession(doc);
  const task = session.tasks.find((one) => one.id === id);
  if (!task) throw new Error(`没有这个任务：${String(id)}`);
  const given = (Array.isArray(evidence) ? evidence : [evidence])
    .map((one) => textOf(one))
    .filter((one) => one.length > 0);
  if (given.length === 0)
    throw new Error("完成任务要写 --evidence：跑过的命令、文件名或看到的输出");
  for (const proof of given) {
    if (isPlaceholderWords(proof))
      throw new Error(`证据不能是占位：「${proof}」。写跑过的命令、文件名或看到的输出`);
  }
  const proofs = given.filter((one) => one.length >= 2);
  if (proofs.length === 0) throw new Error("证据太短：写跑过的命令、文件名或看到的输出");
  task.status = "已完成";
  task.evidence = [...task.evidence, ...proofs];
  task.doneAt = now.toISOString();
  session.since = now.toISOString();
  return { doc, task };
}

export function parseTaskSpec(text) {
  const lines = String(text).replaceAll("\r\n", "\n").split("\n");
  const items = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const head = line.match(/^\s*[-*]\s*\[[ xX]?\]\s*(.+)$/u);
    const phase = line.match(/^\s*阶段[：:]\s*(.+)$/u);
    const standard = line.match(/^\s*标准[：:]\s*(.+)$/u);
    const evidence = line.match(/^\s*证据[：:]\s*(.+)$/u);
    if (head) {
      if (current) items.push(current);
      current = { text: head[1].trim(), standard: "", evidence: [], phase: null };
      continue;
    }
    if (!current) continue;
    if (phase) current.phase = phase[1].trim();
    else if (standard) current.standard = standard[1].trim();
    else if (evidence)
      current.evidence = evidence[1]
        .split(/[，,、]/u)
        .map((one) => one.trim())
        .filter(Boolean);
  }
  if (current) items.push(current);
  return items;
}

export function parseFindingSpec(text) {
  return String(text)
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 4)
    .map((line) => {
      const clean = line.replace(/^[-*]\s*/u, "");
      const parts = clean.split(/\s*[|｜]\s*/u);
      return { text: parts.join(" · ") || clean, raw: clean };
    });
}

export function segmentReady(session, phase) {
  const tasks = tasksInPhase(session, phase);
  if (tasks.length === 0) return { ready: false, why: `阶段「${phase}」没有任务` };
  const open = tasks.filter((task) => task.status !== "已完成");
  if (open.length > 0)
    return { ready: false, why: `阶段「${phase}」还有 ${open.length} 个任务没做完` };
  const review = session.reviews.find((one) => one.scope === "段" && one.phase === phase);
  if (review) return { ready: false, why: `阶段「${phase}」已经审过（${review.id}）` };
  return { ready: true, why: "" };
}

export function overallReady(session) {
  const open = session.tasks.filter((task) => task.status !== "已完成");
  if (open.length > 0) return { ready: false, why: `还有 ${open.length} 个任务没做完` };
  const review = session.reviews.find((one) => one.scope === "总体");
  if (review) return { ready: false, why: `总体审查已经做过（${review.id}）` };
  return { ready: true, why: "" };
}

const BRIEF_BY_SCOPE = {
  段: (label) => `审查范围：${label} 这一段的交付`,
  总体: () => "审查范围：整条任务（跨段）",
};

export function reviewBrief(doc, { scope = "总体", phase = null } = {}) {
  const session = requireSession(doc);
  if (!FINDING_SCOPES.includes(scope))
    throw new Error(`审查范围只能是 ${FINDING_SCOPES.join(" / ")}`);
  const tasks = scope === "段" ? tasksInPhase(session, phase) : session.tasks;
  if (tasks.length === 0)
    throw new Error(scope === "段" ? `阶段「${String(phase)}」没有任务` : "没有任务可审");
  const lines = [
    `# 审查任务书 · ${BRIEF_BY_SCOPE[scope](phase ?? "")}`,
    "",
    `交付：${session.scope?.text ?? "（还没有写范围）"}`,
    `状态：${session.state} · 任务 ${tasks.length} 条 · 已完成 ${tasks.filter((t) => t.status === "已完成").length} 条`,
    "",
    "## 要看的对象",
    ...tasks.map(
      (task) =>
        `- ${task.id} ${task.text}｜标准：${task.standard}｜证据：${task.evidence.join("；") || "（无）"}`,
    ),
    "",
    "## 怎么审",
    "- 不要只核对上面每一条标准是否满足；标准之外的问题也要提。",
    "- 每条发现写：位置 · 问题 · 建议，一行一条。",
    "- 发现要能被验证，不要写「感觉」或「可能有风险」。",
  ];
  return lines.join("\n");
}

export function recordReview(doc, { scope = "总体", phase = null, extra = null, at = null } = {}) {
  const session = requireSession(doc);
  const ready = scope === "段" ? segmentReady(session, phase) : overallReady(session);
  if (!ready.ready) throw new Error(ready.why);
  const review = {
    id: nextId("V", new Set(session.reviews.map((one) => one.id))),
    scope,
    phase: scope === "段" ? phase : null,
    at: at ?? new Date().toISOString(),
    extra: extra ? textOf(extra) : null,
    brief: reviewBrief(doc, { scope, phase }),
  };
  session.reviews.push(review);
  session.since = review.at;
  return { doc, review };
}

function firstReview(doc) {
  const session = requireSession(doc);
  return [...session.reviews].reverse()[0] ?? null;
}

export function addFindings(
  doc,
  { findings, reviewId = null, scope = null, phase = null, now = new Date() } = {},
) {
  const session = requireSession(doc);
  const review = reviewId ? session.reviews.find((one) => one.id === reviewId) : firstReview(doc);
  if (!review) throw new Error("先记录一次审查（review log），再往里写发现");
  const targetScope = scope ?? review.scope;
  const targetPhase = targetScope === "段" ? (phase ?? review.phase) : null;
  const added = [];
  for (const item of findings ?? []) {
    const finding = {
      id: nextId("F", new Set(session.findings.map((one) => one.id))),
      text: textOf(typeof item === "string" ? item : item.text),
      scope: targetScope,
      phase: targetPhase,
      status: "未处置",
      note: null,
      evidence: null,
      reviewId: review.id,
      taskId: null,
      createdAt: now.toISOString(),
      resolvedAt: null,
    };
    if (finding.text.length < 4) throw new Error(`发现太短：${finding.text}`);
    session.findings.push(finding);
    added.push(finding);
  }
  return { doc, findings: added };
}

export function findFinding(doc, id) {
  const session = requireSession(doc);
  return session.findings.find((one) => one.id === id) ?? null;
}

export function taskFromFinding(doc, { id, now = new Date() } = {}) {
  const session = requireSession(doc);
  const finding = session.findings.find((one) => one.id === id);
  if (!finding) throw new Error(`没有这个发现：${String(id)}`);
  if (finding.taskId) throw new Error(`发现 ${id} 已经有修复任务 ${finding.taskId}`);
  const task = {
    id: nextId("T", new Set(session.tasks.map((one) => one.id))),
    text: `修复发现：${finding.text}`.slice(0, 120),
    standard: `发现 ${id} 描述的问题不再出现，并能指出改在哪里`,
    phase: finding.phase,
    status: "未完成",
    evidence: [],
    createdAt: now.toISOString(),
    doneAt: null,
    fromFinding: finding.id,
  };
  session.tasks.push(task);
  finding.taskId = task.id;
  return { doc, task };
}

export function disposeFinding(
  doc,
  { id, decision, note = null, evidence = null, now = new Date() } = {},
) {
  const session = requireSession(doc);
  const finding = session.findings.find((one) => one.id === id);
  if (!finding) throw new Error(`没有这个发现：${String(id)}`);
  const allowed = ["已修", "延期", "接受"];
  if (!allowed.includes(decision)) throw new Error(`处置只能是 ${allowed.join(" / ")}`);
  const reason = textOf(note ?? "");
  if (reason.length < 4) throw new Error('处置要写理由：--note "为什么"');
  if (isPlaceholderWords(reason)) throw new Error(`理由不能是占位：「${reason}」。写实际原因`);
  if (decision === "已修") {
    const proof = textOf(evidence ?? "");
    const linked = finding.taskId ? session.tasks.find((task) => task.id === finding.taskId) : null;
    const done = linked && linked.status === "已完成";
    if (!done && !proof)
      throw new Error(
        `标为已修要有证据：先 finding task --id ${id} 建修复任务并做完，或用 --evidence \"改在哪里\"`,
      );
    if (proof) finding.evidence = proof;
  }
  finding.status = decision;
  finding.note = reason;
  finding.resolvedAt = now.toISOString();
  return { doc, finding };
}

export function openFindings(doc) {
  const session = focusSession(doc);
  if (!session) return [];
  return session.findings.filter((one) => one.status === "未处置");
}

export function signScope(doc, { text, now = new Date() } = {}) {
  const session = requireSession(doc);
  if (session.state !== "验收") throw new Error("签收只能在验收状态：先 set 验收");
  const words = textOf(text);
  if (words.length < 4) throw new Error("签收要写下用户实际说的那句话");
  if (isPlaceholderWords(words))
    throw new Error(`这句不是原话，是占位：「${words}」。签收要写下用户实际说的那句话`);
  const open = session.tasks.filter((task) => task.status !== "已完成");
  if (open.length > 0) throw new Error(`还有 ${open.length} 个任务没做完，不能签收`);
  const unresolved = session.findings.filter((one) => one.status === "未处置");
  if (unresolved.length > 0)
    throw new Error(`还有 ${unresolved.length} 条审查发现没处置：先处置再签收`);
  session.sign = { text: words, date: today(now) };
  session.since = now.toISOString();
  session.log.push({
    date: now.toISOString(),
    sessionId: session.id,
    event: "sign",
    detail: words,
  });
  return { doc, session };
}

export function sessionProgress(session) {
  const tasks = session.tasks ?? [];
  const findings = session.findings ?? [];
  const phases = phasesOf({ tasks });
  return {
    tasks: tasks.length,
    tasksDone: tasks.filter((task) => task.status === "已完成").length,
    phases: phases.length,
    phasesReviewed: phases.filter((phase) =>
      (session.reviews ?? []).some((review) => review.scope === "段" && review.phase === phase),
    ).length,
    findings: findings.length,
    openFindings: findings.filter((one) => one.status === "未处置").length,
    overallReviewed: (session.reviews ?? []).some((review) => review.scope === "总体"),
    signed: Boolean(session.sign),
  };
}

const PLACEHOLDER_WORDS = new Set([
  "你的原话",
  "用户原话",
  "用户说了什么",
  "可以收口",
  "符合预期",
  "做完的依据",
  "怎么验证的",
  "…",
  "...",
  "xxx",
]);

function isPlaceholderWords(text) {
  const value = String(text ?? "").trim();
  if (!value) return true;
  if (PLACEHOLDER_WORDS.has(value)) return true;
  if (/^[…\.。xX\-—_]+$/u.test(value)) return true;
  if (/[‹›]/u.test(value)) return true;
  if (/(你的原话|用户原话)/u.test(value)) return true;
  return false;
}

export function nextAction(doc) {
  const session = focusSession(doc);
  if (!session) {
    const archived = (doc.sessions ?? []).filter((one) => one.status === "archived");
    if (archived.length === 0)
      return {
        label: "开一个会话",
        detail: "还没有任何会话：一个会话是一件要交付的事",
        command: 'npm run state -- start "要交付什么"',
        owner: "你",
      };
    return {
      label: "没有在推进的会话",
      detail: `归档里还有 ${archived.length} 个会话，可以翻看或接着开新的`,
      command: 'npm run state -- start "要交付什么"',
      owner: "你",
    };
  }
  const progress = sessionProgress(session);
  if (session.state === "讨论") {
    const thread = session.threadId
      ? session.threads.find((one) => one.id === session.threadId)
      : null;
    if (thread && thread.waits.length > 0)
      return {
        label: `先定这一条：${thread.waits[0]}`,
        detail: "讨论里还有一个问题悬着，没定就不往下走",
        command: `npm run state -- wait drop "${thread.waits[0]}"`,
        owner: "你",
      };
    if (!session.scope)
      return {
        label: "写清这次交付",
        detail: "讨论只有落成范围才算收口",
        command: 'npm run state -- scope "这次要交付什么" --kind 里程碑',
        owner: "我",
      };
    if (!thread || thread.rounds.length === 0)
      return {
        label: "记下这轮结论",
        detail: "讨论要有结论，否则下一次接不上",
        command: 'npm run state -- round --conclusion "这轮定了什么"',
        owner: "我",
      };
    return {
      label: "开始执行",
      detail: "范围和结论都有了，可以动手",
      command: 'npm run state -- set 执行 --reason "范围与结论已定"',
      owner: "我",
    };
  }
  if (session.state === "执行") {
    const open = session.tasks.filter((task) => task.status !== "已完成");
    if (open.length > 0)
      return {
        label: `做任务 ${open[0].id}：${open[0].text}`,
        detail: `做完的标准：${open[0].standard}`,
        command: `npm run state -- task done ${open[0].id} --evidence '‹跑过的命令或看到的输出›'`,
        owner: "我",
      };
    if (progress.phases > progress.phasesReviewed) {
      const phase = phasesOf(session).find(
        (one) => !session.reviews.some((review) => review.scope === "段" && review.phase === one),
      );
      return {
        label: `审查这一段：${phase}`,
        detail: "这一段的任务都做完了，收口前先让审查者看一遍",
        command: `npm run state -- review log --scope 段 --phase "${phase}" --from findings.md`,
        owner: "我",
      };
    }
    if (!progress.overallReviewed)
      return {
        label: "做总体审查",
        detail: "整条任务做完了，进入验收前让审查者看跨段问题",
        command: "npm run state -- review log --scope 总体 --from findings.md",
        owner: "我",
      };
    return {
      label: "进验收",
      detail: "任务完成、审查做过了",
      command: 'npm run state -- set 验收 --reason "任务完成，审查已做"',
      owner: "我",
    };
  }
  const unresolved = session.findings.filter((one) => one.status === "未处置");
  if (unresolved.length > 0)
    return {
      label: `处置发现 ${unresolved[0].id}`,
      detail: unresolved[0].text,
      command: `npm run state -- finding defer ${unresolved[0].id} --note "为什么先放着"`,
      owner: "我",
    };
  if (!session.sign)
    return {
      label: "签收这一轮",
      detail: "没有未处置的发现，任务都完成了，可以签",
      command: "npm run state -- sign '‹用户的签收原话›'",
      owner: "你",
    };
  return {
    label: "收口归档",
    detail: "已经签收，可以把这一轮关掉",
    command: 'npm run state -- close --reason "已签收"',
    owner: "我",
  };
}

export function workProgress(doc) {
  const session = focusSession(doc);
  if (!session) return null;
  return sessionProgress(session);
}

export function briefLines(doc) {
  const session = focusSession(doc);
  const lines = [];
  lines.push(`治理状态：${session ? session.state : "无活动会话"}`);
  if (!session) {
    lines.push("当前：没有在推进的会话。");
    const action = nextAction(doc);
    lines.push(`下一步：${action.label} · ${action.command}`);
    return lines;
  }
  lines.push(`会话：${session.id} ${session.title}`);
  lines.push(
    `范围：${session.scope ? `${session.scope.text}（${session.scope.kind}）` : "还没写"}`,
  );
  const action = nextAction(doc);
  lines.push(`现在：${action.label} · ${action.owner}`);
  lines.push(`命令：${action.command}`);
  const thread = session.threadId
    ? session.threads.find((one) => one.id === session.threadId)
    : null;
  if (thread && thread.waits.length > 0)
    lines.push(`待裁：${thread.waits.map((one) => `「${one}」`).join("、")}`);
  const unresolved = session.findings.filter((one) => one.status === "未处置");
  if (unresolved.length > 0)
    lines.push(`未处置发现：${unresolved.map((one) => `${one.id} ${one.text}`).join("；")}`);
  const progress = sessionProgress(session);
  lines.push(
    `进度：任务 ${progress.tasksDone}/${progress.tasks} · 阶段 ${progress.phasesReviewed}/${progress.phases} · 发现 ${progress.findings - progress.openFindings}/${progress.findings}`,
  );
  if (thread && thread.rounds.length > 0)
    lines.push(`上轮结论：${thread.rounds[thread.rounds.length - 1].conclusion}`);
  if (session.sign) lines.push(`已签收：${session.sign.date}「${session.sign.text}」`);
  return lines;
}

export function progressLines(doc) {
  const session = focusSession(doc);
  if (!session) return ["没有在推进的会话。"];
  const progress = sessionProgress(session);
  return [
    `任务 ${progress.tasksDone}/${progress.tasks}`,
    `阶段审查 ${progress.phasesReviewed}/${progress.phases}`,
    `审查发现 ${progress.findings - progress.openFindings}/${progress.findings} 已处置`,
    progress.signed ? "已签收" : "未签收",
  ];
}

export function summaryLines(doc) {
  const session = focusSession(doc);
  if (!session) {
    const open = openSessions(doc).length;
    return [
      "状态：无活动会话",
      `打开的会话：${open} 个`,
      `归档：${(doc.sessions ?? []).length - open} 个`,
    ];
  }
  const action = nextAction(doc);
  return [
    `状态：${session.state}`,
    `会话：${session.id} ${session.title}`,
    `现在该做：${action.label}`,
    `命令：${action.command}`,
  ];
}

export function logOf(doc, sessionId = null) {
  const entries = doc.log ?? [];
  if (!sessionId) return entries;
  return entries.filter((entry) => entry.sessionId === sessionId);
}
