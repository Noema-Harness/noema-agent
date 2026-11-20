// Tracks the work sessions the agent is running: what is being delivered, how
// far it got, and what evidence backs it. Pure logic: no file IO, no project
// names, no repository paths. The adapter layer picks the paths.
//
// Model (version 4):
// - A session is one work container. It owns its state, scope, segments,
//   discussion threads and log. Sessions are independent: one waiting for a
//   human signature does not block another.
// - `focus` points at the session in view; null means the agent is just
//   talking, with no delivery in progress.
// - A segment is a slice of one session. Every session starts with an
//   unnamed segment for small work; a delivery that needs a plan opens a new
//   named segment and the phase rules apply to it.
// - States (discussion / execution / acceptance) are optional stages inside a
//   session, not a mandatory pipeline: you may execute right after starting
//   and close without a formal acceptance when nobody has to sign.

export const STATES = ["讨论", "执行", "验收"];

export const PACK_BY_STATE = {
  讨论: "discussion",
  执行: "execution",
  验收: "acceptance",
};

export const ENDINGS = ["定案", "归档"];

export const SEGMENT_STATUSES = ["未开始", "进行中", "已完成"];
export const TASK_STATUSES = ["未完成", "已完成"];
export const ACCEPTANCE_STATUSES = ["未验", "通过", "不通过"];
// R 层的发现也必须被处置：改掉、延期（写理由）、或接受（写理由），不能挂着不管。
export const FINDING_DECISIONS = ["已修", "延期", "接受"];
// D=确定性检查 C=判据对照 R=审查发现（只出清单，不判通过）H=人签收
export const ACCEPTANCE_LAYERS = ["D", "C", "R", "H"];
export const BLOCKING_LAYERS = ["D", "C", "H"];
export const MAX_SEGMENTS = 12;
export const STATE_VERSION = 4;
export const SCOPE_KINDS = ["里程碑", "修复"];

const THREAD_FIELDS = {
  id: "string",
  title: "string",
  startedAt: "string",
  status: "string",
  endedAt: ["string", "null"],
  ending: ["string", "null"],
  rounds: "array",
  waits: "array",
  evidence: "array",
  output: "object",
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

function nextId(prefix, used, now) {
  const stamp = today(now).replaceAll("-", "");
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

export function emptySegment(id = "P1", { labeled = false, name = null, now = new Date() } = {}) {
  const stamp = now.toISOString();
  return {
    id,
    name,
    labeled,
    status: "进行中",
    createdAt: stamp,
    startedAt: stamp,
    doneAt: null,
    tasks: [],
    acceptance: [],
  };
}

export function emptySession({ id = "S1", title = "未命名会话", now = new Date() } = {}) {
  return {
    id,
    title,
    status: "open",
    state: "执行",
    since: now.toISOString(),
    scope: null,
    segments: [emptySegment()],
    threads: [],
    threadId: null,
    log: [],
  };
}

export function emptyState(now = new Date()) {
  return { version: STATE_VERSION, focus: null, sessions: [], log: [] };
}

// Version 1 stored only the state machine; version 2 added the work list; 3
// added scope kinds and phase start times. Version 4 turns the single work
// into sessions that carry their own state and segments. Old files are
// upgraded in place so callers never see two shapes.
export function upgradeState(raw) {
  if (!raw || typeof raw !== "object") throw new Error("状态数据不是对象");
  if (raw.version === STATE_VERSION) return raw;
  let doc = raw;
  if (doc.version === 1)
    doc = { ...doc, version: 2, work: doc.work ?? { scope: null, phases: [] } };
  if (doc.version === 2) {
    const work = doc.work ?? { scope: null, phases: [] };
    const scope = work.scope
      ? {
          text: work.scope.text,
          since: work.scope.since,
          kind: work.scope.kind ?? "里程碑",
          signed: work.scope.signed ?? null,
        }
      : null;
    doc = {
      ...doc,
      version: 3,
      current: { ...doc.current, by: doc.current?.by ?? null },
      work: {
        ...work,
        scope,
        phases: (work.phases ?? []).map((phase) => ({
          ...phase,
          startedAt: phase.startedAt ?? phase.createdAt ?? null,
        })),
      },
    };
  }
  if (doc.version === 3) return upgradeFromV3(doc);
  throw new Error(
    `状态数据版本 ${String(raw.version)} 无法升级：支持 1 → 2 → 3 → ${STATE_VERSION}`,
  );
}

function normalizeThread(thread, since) {
  return {
    ...thread,
    startedAt: thread.startedAt ?? since,
    endedAt: thread.endedAt ?? null,
    ending: thread.ending ?? null,
    evidence: Array.isArray(thread.evidence) ? thread.evidence : [],
    output: thread.output && typeof thread.output === "object" ? thread.output : {},
  };
}

function upgradeFromV3(doc) {
  const work = doc.work ?? { scope: null, phases: [] };
  const since = doc.current?.since ?? doc.log?.[0]?.date ?? new Date().toISOString();
  const active = (doc.threads ?? []).find((thread) => thread.status === "active") ?? null;
  const phases = work.phases ?? [];
  const segments =
    phases.length > 0
      ? phases.map((phase) => ({
          id: phase.id,
          name: phase.name ?? null,
          labeled: true,
          status: phase.status ?? "未开始",
          createdAt: phase.createdAt ?? since,
          startedAt: phase.startedAt ?? phase.createdAt ?? null,
          doneAt: phase.doneAt ?? null,
          tasks: phase.tasks ?? [],
          acceptance: phase.acceptance ?? [],
        }))
      : [emptySegment("P1", { now: new Date(doc.current.since) })];
  const session = {
    id: "S1",
    title: active?.title ?? work.scope?.text ?? "历史会话",
    status: "open",
    state: doc.current?.state ?? "执行",
    since,
    scope: work.scope ?? null,
    segments,
    threads: (doc.threads ?? []).map((thread) => normalizeThread(thread, since)),
    threadId: doc.current.threadId ?? null,
    log: [],
  };
  return {
    version: STATE_VERSION,
    focus: "S1",
    sessions: [session],
    log: (doc.log ?? []).map((entry) => ({ ...entry, sessionId: "S1" })),
  };
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
      if (thread.ending !== null && !ENDINGS.includes(thread.ending))
        errors.push(
          `${where} 讨论线 ${String(thread.id)} 的 ending 只能是 ${ENDINGS.join(" / ")} 或 null`,
        );
    }
    if (session.scope !== null && session.scope !== undefined) {
      const scope = session.scope;
      if (typeof scope !== "object" || typeof scope.text !== "string")
        errors.push(`${where} 的 scope 只能是 null 或 {text, since}`);
      if (!SCOPE_KINDS.includes(scope.kind ?? "里程碑"))
        errors.push(`${where} 的范围类型只能是 ${SCOPE_KINDS.join(" / ")}`);
    }
    if (!Array.isArray(session.segments)) {
      errors.push(`${where} 缺少 segments 数组`);
      continue;
    }
    if (session.segments.length === 0) errors.push(`${where} 至少要有一个段`);
    if (session.segments.length > MAX_SEGMENTS)
      errors.push(`${where} 的段最多 ${MAX_SEGMENTS} 个，实际 ${session.segments.length} 个`);
    const segmentIds = new Set();
    for (const segment of session.segments) {
      const at = `${where} 的段 ${String(segment.id)}`;
      if (typeof segment.id !== "string" || !/^P\d+$/u.test(segment.id))
        errors.push(`段 id 不合规：${String(segment.id)}`);
      if (segmentIds.has(segment.id)) errors.push(`段 id 重复：${segment.id}`);
      segmentIds.add(segment.id);
      if (
        segment.name !== null &&
        (typeof segment.name !== "string" || segment.name.trim().length < 2)
      )
        errors.push(`${at} 的名字只能是 null 或至少 2 个字`);
      if (typeof segment.labeled !== "boolean") errors.push(`${at} 的 labeled 只能是布尔值`);
      if (!SEGMENT_STATUSES.includes(segment.status)) errors.push(`${at} 的 status 不合规`);
      if (!isDateLike(segment.createdAt)) errors.push(`${at} 的 createdAt 不是日期`);
      if (segment.startedAt !== null && !isDateLike(segment.startedAt))
        errors.push(`${at} 的 startedAt 只能是日期或 null`);
      if (segment.status === "已完成" && !isDateLike(segment.doneAt))
        errors.push(`${at} 已完成但缺少 doneAt`);
      const phaseId = segment.id;
      const taskIds = new Set();
      if (!Array.isArray(segment.tasks)) {
        errors.push(`${at} 缺少 tasks 数组`);
      } else {
        for (const task of segment.tasks) {
          if (typeof task.id !== "string" || !new RegExp(`^${phaseId}-T\\d+$`, "u").test(task.id))
            errors.push(`任务 id 不合规：${String(task.id)}`);
          if (typeof task.text !== "string" || task.text.trim().length < 2)
            errors.push(`任务 ${String(task.id)} 缺少说明`);
          if (!TASK_STATUSES.includes(task.status))
            errors.push(`任务 ${String(task.id)} 的 status 不合规`);
          if (!Array.isArray(task.evidence))
            errors.push(`任务 ${String(task.id)} 的 evidence 不是数组`);
          if (taskIds.has(task.id)) errors.push(`任务 id 重复：${task.id}`);
          taskIds.add(task.id);
          if (task.evidence.some((one) => typeof one !== "string" || one.trim().length === 0))
            errors.push(`任务 ${task.id} 的证据必须是非空字符串`);
          if (task.status === "已完成" && task.evidence.length === 0)
            errors.push(`任务 ${task.id} 标为已完成但没有证据`);
        }
      }
      if (!Array.isArray(segment.acceptance)) {
        errors.push(`${at} 缺少 acceptance 数组`);
      } else {
        for (const item of segment.acceptance) {
          if (typeof item.id !== "string" || !new RegExp(`^${phaseId}-A\\d+$`, "u").test(item.id))
            errors.push(`验收项 id 不合规：${String(item.id)}`);
          if (typeof item.text !== "string" || item.text.trim().length < 2)
            errors.push(`验收项 ${String(item.id)} 缺少说明`);
          if (!ACCEPTANCE_STATUSES.includes(item.status))
            errors.push(`验收项 ${String(item.id)} 的 status 不合规`);
          if (!Array.isArray(item.evidence))
            errors.push(`验收项 ${String(item.id)} 的 evidence 不是数组`);
          const layer = item.layer ?? "D";
          if (!ACCEPTANCE_LAYERS.includes(layer))
            errors.push(
              `验收项 ${String(item.id)} 的 layer 只能是 ${ACCEPTANCE_LAYERS.join(" / ")}`,
            );
          if (item.resolution !== undefined && item.resolution !== null) {
            const resolution = item.resolution;
            if (typeof resolution !== "object" || Array.isArray(resolution)) {
              errors.push(`验收项 ${String(item.id)} 的 resolution 不是对象`);
            } else if (!FINDING_DECISIONS.includes(resolution.decision)) {
              errors.push(
                `验收项 ${String(item.id)} 的 resolution.decision 只能是 ${FINDING_DECISIONS.join(" / ")}`,
              );
            } else if (typeof resolution.note !== "string" && resolution.note !== null) {
              errors.push(`验收项 ${String(item.id)} 的 resolution.note 只能是字符串或 null`);
            }
          }
          if (["通过", "不通过"].includes(item.status) && item.evidence.length === 0)
            errors.push(`验收项 ${item.id} 判了「${item.status}」但没有证据`);
          if (layer === "R" && item.status !== "未验")
            errors.push(`审查发现 ${item.id} 只记录，不用判「${item.status}」`);
        }
      }
    }
    const running = (session.segments ?? []).filter((segment) => segment.status === "进行中");
    if (running.length > 1)
      errors.push(`${where} 同时只能有一个段进行中，实际 ${running.length} 个`);
    if (session.scope?.signed) {
      const blocking = (session.segments ?? []).flatMap((segment) =>
        (segment.acceptance ?? []).filter((item) => BLOCKING_LAYERS.includes(item.layer ?? "D")),
      );
      const bad = blocking.filter((item) => item.status !== "通过");
      if (bad.length > 0)
        errors.push(`${where} 已签收但仍有未通过的验收项：${bad.map((one) => one.id).join("、")}`);
      const open = (session.segments ?? []).flatMap((segment) =>
        (segment.acceptance ?? []).filter(
          (item) =>
            (item.layer ?? "D") === "R" &&
            (!item.resolution || !FINDING_DECISIONS.includes(item.resolution.decision)),
        ),
      );
      if (open.length > 0)
        errors.push(
          `${where} 已签收但仍有未处置的审查发现：${open.map((one) => one.id).join("、")}`,
        );
    }
  }
  return errors;
}

// --- session focus -------------------------------------------------------

export function focusSession(doc) {
  if (!doc.focus) return null;
  return (doc.sessions ?? []).find((session) => session.id === doc.focus) ?? null;
}

export function requireSession(doc) {
  const session = focusSession(doc);
  if (!session) {
    throw new Error("当前没有打开的会话：先 npm run state -- start「要交付什么」");
  }
  return session;
}

export function openSessions(doc) {
  return (doc.sessions ?? []).filter((session) => session.status === "open");
}

export function listSessions(doc) {
  return (doc.sessions ?? []).map((session) => {
    const progress = sessionProgress(session);
    return {
      id: session.id,
      title: session.title,
      status: session.status,
      state: session.state,
      since: session.since,
      focused: session.id === doc.focus,
      scope: session.scope?.text ?? null,
      done: progress.segmentsDone,
      total: progress.segments,
    };
  });
}

export function startSession(doc, { title, discuss = false, now = new Date() } = {}) {
  if (!title || title.trim().length < 2) {
    throw new Error("开一个会话要写 --title「要交付什么」（至少 2 个字）");
  }
  const ids = new Set((doc.sessions ?? []).map((session) => session.id));
  const id = nextId("S", ids, now);
  const session = emptySession({ id, title: title.trim(), now });
  session.state = discuss ? "讨论" : "执行";
  doc.sessions = [...(doc.sessions ?? []), session];
  doc.focus = id;
  recordTransition(doc, session, {
    from: null,
    to: session.state,
    reason: discuss ? "开始讨论这个交付" : "有事要做，直接进入执行",
    obligation: "挂起",
    now,
  });
  return { doc, session };
}

export function switchSession(doc, { id, now = new Date() } = {}) {
  const target = (doc.sessions ?? []).find((session) => session.id === id);
  if (!target) throw new Error(`没有会话 ${String(id)}（先跑 npm run state -- sessions 看清单）`);
  if (target.status !== "open") throw new Error(`会话 ${id} 已经归档：需要继续就先重开`);
  const previous = focusSession(doc);
  doc.focus = id;
  recordTransition(doc, target, {
    from: previous ? `${previous.id}:${previous.state}` : null,
    to: target.state,
    reason: "切换到这个会话",
    obligation: "挂起",
    now,
  });
  return { doc, session: target, previous };
}

export function archiveSession(doc, { reason = "这个会话的交付已经结束", now = new Date() } = {}) {
  const session = requireSession(doc);
  session.status = "archived";
  const active = activeThread(doc);
  if (active) archiveThread(doc, { id: active.id, ending: "归档", now });
  if (session.threadId === active?.id) session.threadId = null;
  doc.focus = null;
  recordTransition(doc, session, {
    from: session.state,
    to: "归档",
    reason,
    obligation: "关闭",
    now,
  });
  return { doc, session };
}

function recordTransition(doc, session, { from, to, reason, obligation, now }) {
  const entry = {
    sessionId: session.id,
    from,
    to,
    date: today(now),
    reason: String(reason ?? "").trim(),
    obligation: obligation ?? "挂起",
    threadId: session.threadId ?? null,
  };
  doc.log.push(entry);
  session.log.push(entry);
  session.since = now.toISOString();
  return entry;
}

// --- discussion threads (inside a session) -------------------------------

export function activeThread(doc) {
  const session = focusSession(doc);
  if (!session) return null;
  return session.threads.find((thread) => thread.status === "active") ?? null;
}

export function threadById(doc, id) {
  const session = focusSession(doc);
  if (!session) return null;
  return session.threads.find((thread) => thread.id === id) ?? null;
}

export function ensureThread(doc, { title = null, now = new Date() } = {}) {
  const session = requireSession(doc);
  const active = session.threads.find((thread) => thread.status === "active");
  if (active) return { doc, thread: active, created: false };
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
    output: { design: null, kickoff: null, scope: null },
  };
  session.threads.push(thread);
  session.threadId = thread.id;
  return { doc, thread, created: true };
}

export function lastArchivedThread(doc) {
  const session = focusSession(doc);
  if (!session) return null;
  const archived = session.threads.filter((thread) => thread.status === "archived");
  return archived.length > 0 ? archived[archived.length - 1] : null;
}

export function archiveThread(doc, { id = null, ending = "归档", now = new Date() } = {}) {
  const session = requireSession(doc);
  const thread = id ? threadById(doc, id) : activeThread(doc);
  if (!thread) throw new Error("没有可归档的讨论线");
  if (thread.status === "archived") throw new Error(`讨论线 ${thread.id} 已经归档`);
  if (!ENDINGS.includes(ending)) throw new Error(`结束方式只能是 ${ENDINGS.join(" / ")}`);
  thread.status = "archived";
  thread.endedAt = now.toISOString();
  thread.ending = ending;
  if (session.threadId === thread.id) session.threadId = null;
  return { doc, thread };
}

export function resumeThread(doc, { id = null, now = new Date() } = {}) {
  const target = id ? threadById(doc, id) : lastArchivedThread(doc);
  if (!target) throw new Error("没有可恢复的讨论线");
  const session = requireSession(doc);
  if (target.status === "active" && session.threadId === target.id) {
    return { doc, thread: target, resumed: false };
  }
  const current = activeThread(doc);
  if (current && current.id !== target.id)
    archiveThread(doc, { id: current.id, ending: "归档", now });
  target.status = "active";
  target.endedAt = null;
  target.ending = null;
  session.threadId = target.id;
  return { doc, thread: target, resumed: true };
}

export function setState(doc, { to, reason = null, obligation = null, now = new Date() }) {
  if (!STATES.includes(to)) {
    throw new Error(`未知状态「${String(to)}」：只能是 ${STATES.join(" / ")}`);
  }
  const session = requireSession(doc);
  const from = session.state;
  if (from === to) throw new Error(`这个会话已经在「${to}」状态`);
  if (!reason || reason.trim().length < 2) {
    throw new Error("切换状态要写 --reason「为什么切换」（至少 2 个字）");
  }
  let threadId = session.threadId ?? null;
  let closed = false;
  if (to === "讨论") {
    const archived = lastArchivedThread(doc);
    const thread = archived
      ? resumeThread(doc, { id: archived.id, now }).thread
      : ensureThread(doc, { title: session.title, now }).thread;
    threadId = thread.id;
  } else {
    const active = activeThread(doc);
    if (active) {
      const ending =
        from === "讨论" && active.output?.design && active.output?.kickoff ? "定案" : "归档";
      archiveThread(doc, { id: active.id, ending, now });
      closed = ending === "定案";
    }
    if (threadId === null || !threadById(doc, threadId)) threadId = null;
  }
  const resolved = obligation ?? (closed ? "关闭" : "挂起");
  session.state = to;
  session.threadId = threadId;
  const entry = recordTransition(doc, session, {
    from,
    to,
    reason,
    obligation: resolved,
    now,
  });
  return { doc, log: entry };
}

export function addRound(doc, { conclusion, change = null, now = new Date() } = {}) {
  if (!conclusion || conclusion.trim().length < 2) {
    throw new Error("轮次必须写 --conclusion「这一轮的结论」（至少 2 个字）");
  }
  const { thread } = ensureThread(doc, { now });
  const number = thread.rounds.length + 1;
  thread.rounds.push({
    n: number,
    date: today(now),
    conclusion: conclusion.trim(),
    change: change ? change.trim() : null,
  });
  return { doc, thread, round: thread.rounds[thread.rounds.length - 1] };
}

export function addWait(doc, { item, now = new Date() } = {}) {
  if (!item || item.trim().length < 2) {
    throw new Error("待裁项要写 --item「要定什么」（至少 2 个字）");
  }
  const { thread } = ensureThread(doc, { now });
  const text = item.trim();
  if (thread.waits.some((one) => one === text)) throw new Error(`待裁项已存在：${text}`);
  thread.waits.push(text);
  return { doc, thread };
}

export function dropWait(doc, { item, now = new Date() } = {}) {
  if (!item || item.trim().length < 1) throw new Error("要写 --item（可按编号前缀，如 T1）");
  const { thread } = ensureThread(doc, { now });
  const prefix = item.trim();
  const index = thread.waits.findIndex((one) => one === prefix || one.startsWith(prefix));
  if (index < 0) throw new Error(`没有匹配「${prefix}」的待裁项`);
  const [removed] = thread.waits.splice(index, 1);
  return { doc, thread, removed };
}

// --- scope (what this session delivers) ----------------------------------

export function setScope(doc, { text, kind = "里程碑", now = new Date() } = {}) {
  const session = requireSession(doc);
  if (!text || text.trim().length < 2) {
    throw new Error("范围要写清楚「这次做什么」（至少 2 个字）");
  }
  if (!SCOPE_KINDS.includes(kind)) {
    throw new Error(`范围类型只能是 ${SCOPE_KINDS.join(" / ")}`);
  }
  session.scope = { text: text.trim(), kind, since: now.toISOString(), signed: null };
  return { doc, scope: session.scope };
}

// --- segments (slices of one session) ------------------------------------

export function currentSegment(doc) {
  const session = requireSession(doc);
  const open = session.segments.filter((segment) => segment.status === "进行中");
  if (open.length > 0) return open[0];
  return session.segments[session.segments.length - 1] ?? null;
}

export function findSegment(doc, id) {
  const session = requireSession(doc);
  const segment = session.segments.find((one) => one.id === id);
  if (!segment) throw new Error(`没有段 ${String(id)}（先跑 npm run state -- work 看清单）`);
  return segment;
}

export function findPhase(doc, id) {
  return findSegment(doc, id);
}

export function addSegment(doc, { name, goal = null, now = new Date() } = {}) {
  const session = requireSession(doc);
  if (!name || name.trim().length < 2) {
    throw new Error("新的一段要写 --name「这一段交付什么」（至少 2 个字）");
  }
  if (session.segments.length >= MAX_SEGMENTS) {
    throw new Error(`一段会话最多 ${MAX_SEGMENTS} 段：旧的段先归档，或另开一个会话`);
  }
  const current = currentSegment(doc);
  if (current && current.status !== "已完成") {
    const openTasks = current.tasks.filter((task) => task.status !== "已完成");
    if (openTasks.length > 0) {
      throw new Error(
        `当前段还有 ${openTasks.length} 个任务没完成（${openTasks.map((task) => task.id).join("、")}）：先完成，或把它们带到新段`,
      );
    }
    current.status = "已完成";
    current.doneAt = now.toISOString();
  }
  const ids = new Set(session.segments.map((segment) => segment.id));
  const id = nextId("P", ids, now);
  const segment = emptySegment(id, { labeled: true, name: name.trim(), now });
  session.segments.push(segment);
  return { doc, segment, goal };
}

export function startSegment(doc, { id = null, now = new Date() } = {}) {
  const segment = id ? findSegment(doc, id) : currentSegment(doc);
  if (!segment) throw new Error("这个会话还没有段");
  if (segment.status === "已完成") throw new Error(`段 ${segment.id} 已经完成`);
  const session = requireSession(doc);
  const running = session.segments.find((one) => one.status === "进行中" && one.id !== segment.id);
  if (running) throw new Error(`段 ${running.id} 还在进行：先完成它再开始 ${segment.id}`);
  segment.status = "进行中";
  segment.startedAt = segment.startedAt ?? now.toISOString();
  return { doc, segment };
}

export function completeSegment(doc, { id = null, now = new Date() } = {}) {
  const segment = id ? findSegment(doc, id) : currentSegment(doc);
  if (!segment) throw new Error("这个会话还没有段");
  if (segment.status === "已完成") throw new Error(`段 ${segment.id} 已经完成`);
  const openTasks = segment.tasks.filter((task) => task.status !== "已完成");
  if (openTasks.length > 0) {
    throw new Error(
      `段 ${segment.id} 还有 ${openTasks.length} 个任务没完成：${openTasks.map((task) => task.id).join("、")}`,
    );
  }
  // 命名过的段才走 D/C/R/H；日常段只要求任务完成，不强迫走验收。
  if (segment.labeled) {
    const blocking = segment.acceptance.filter((item) =>
      BLOCKING_LAYERS.includes(item.layer ?? "D"),
    );
    const unchecked = blocking.filter((item) => item.status === "未验");
    const failed = blocking.filter((item) => item.status === "不通过");
    if (unchecked.length > 0)
      throw new Error(
        `段 ${segment.id} 还有 ${unchecked.length} 个验收项没判：${unchecked.map((one) => one.id).join("、")}`,
      );
    if (failed.length > 0)
      throw new Error(
        `段 ${segment.id} 有 ${failed.length} 个验收项不通过：${failed.map((one) => one.id).join("、")}`,
      );
    const openFindings = segment.acceptance.filter(
      (item) =>
        (item.layer ?? "D") === "R" &&
        (!item.resolution || !FINDING_DECISIONS.includes(item.resolution.decision)),
    );
    if (openFindings.length > 0)
      throw new Error(
        `段 ${segment.id} 还有 ${openFindings.length} 条审查发现没处置：${openFindings.map((one) => one.id).join("、")}`,
      );
  }
  segment.status = "已完成";
  segment.doneAt = now.toISOString();
  return { doc, segment };
}

export function completePhase(doc, options = {}) {
  return completeSegment(doc, options);
}

function findTask(doc, id) {
  const session = requireSession(doc);
  for (const segment of session.segments) {
    const task = segment.tasks.find((one) => one.id === id);
    if (task) return { segment, task };
  }
  throw new Error(`没有任务 ${String(id)}（先跑 npm run state -- work 看清单）`);
}

function findAcceptance(doc, id) {
  const session = requireSession(doc);
  for (const segment of session.segments) {
    const item = segment.acceptance.find((one) => one.id === id);
    if (item) return { segment, item };
  }
  throw new Error(`没有验收项 ${String(id)}（先跑 npm run state -- work 看清单）`);
}

export function addTask(doc, { text, segmentId = null, now = new Date() } = {}) {
  const segment = segmentId ? findSegment(doc, segmentId) : currentSegment(doc);
  if (!segment) throw new Error("这个会话还没有段：先 state -- start「要做什么」");
  if (segment.status === "已完成") throw new Error(`段 ${segment.id} 已经完成：先开新的一段`);
  if (!text || text.trim().length < 2) throw new Error("任务要写 --text「做什么」（至少 2 个字）");
  const id = `${segment.id}-T${segment.tasks.length + 1}`;
  const task = {
    id,
    text: text.trim(),
    status: "未完成",
    evidence: [],
    createdAt: now.toISOString(),
  };
  segment.tasks.push(task);
  return { doc, segment, task };
}

export function completeTask(doc, { id, evidence = [], now = new Date() } = {}) {
  const { task } = findTask(doc, id);
  if (task.status === "已完成") throw new Error(`任务 ${task.id} 已经完成`);
  const proofs = (Array.isArray(evidence) ? evidence : [evidence]).filter(
    (one) => typeof one === "string" && one.trim().length > 0,
  );
  if (proofs.length === 0)
    throw new Error(
      `完成任务要写 --evidence「跑过什么/看到什么」（至少 4 个字，能指向具体命令或文件）`,
    );
  if (proofs.join("").trim().length < 4)
    throw new Error(
      `完成任务要写 --evidence「跑过什么/看到什么」（至少 4 个字，能指向具体命令或文件）`,
    );
  if (proofs.some((one) => isPlaceholderWords(one)))
    throw new Error(`证据不能是占位：「${proofs.join("｜")}」。写跑过的命令、文件名或看到的输出`);
  task.status = "已完成";
  task.evidence = proofs.map((one) => one.trim());
  task.doneAt = now.toISOString();
  return { doc, task };
}

export function addAcceptance(doc, { text, layer = "D", segmentId = null, now = new Date() } = {}) {
  const segment = segmentId ? findSegment(doc, segmentId) : currentSegment(doc);
  if (!segment) throw new Error("这个会话还没有段：先 state -- start「要做什么」");
  if (!ACCEPTANCE_LAYERS.includes(layer))
    throw new Error(`验收层只能是 ${ACCEPTANCE_LAYERS.join(" / ")}`);
  if (!text || text.trim().length < 2) throw new Error("验收项要写 --text「怎么算过」");
  const id = `${segment.id}-A${segment.acceptance.length + 1}`;
  const item = {
    id,
    text: text.trim(),
    layer,
    status: "未验",
    evidence: [],
    resolution: null,
    createdAt: now.toISOString(),
  };
  segment.acceptance.push(item);
  return { doc, segment, item };
}

export function reviewPhase(doc, { id = null, what, gap, split, now = new Date() } = {}) {
  const segment = id ? findSegment(doc, id) : currentSegment(doc);
  if (!segment) throw new Error("这个会话还没有段");
  const review = {
    what: what ? String(what).trim() : null,
    gap: gap ? String(gap).trim() : null,
    split: split ? String(split).trim() : null,
    at: now.toISOString(),
  };
  if (!review.what && !review.gap && !review.split)
    throw new Error("重审要写 --what / --gap / --split 至少一项");
  segment.review = review;
  return { doc, segment, review };
}

export function setAcceptance(doc, { id, status, evidence = [], now = new Date() } = {}) {
  const { item } = findAcceptance(doc, id);
  const layer = item.layer ?? "D";
  if (layer === "R") {
    throw new Error(`验收项 ${item.id} 是审查发现：用 accept resolve --decision 已修|延期|接受`);
  }
  if (layer === "H") {
    throw new Error(
      `验收项 ${item.id} 是人签收项（H）：agent 不能自己判，用 accept human --id ${item.id} --text「用户原话」`,
    );
  }
  if (status === "未验") {
    item.status = "未验";
    item.evidence = [];
    return { doc, item };
  }
  if (status !== "通过" && status !== "不通过")
    throw new Error(`验收项状态只能是 ${ACCEPTANCE_STATUSES.join(" / ")}`);
  const proofs = (Array.isArray(evidence) ? evidence : [evidence]).filter(
    (one) => typeof one === "string" && one.trim().length > 0,
  );
  if (proofs.join("").trim().length < 4)
    throw new Error(`判「${status}」要写 --evidence「看到了什么」（至少 4 个字）`);
  if (proofs.some((one) => isPlaceholderWords(one)))
    throw new Error(`证据不能是占位：「${proofs.join("｜")}」。写跑过的命令、文件名或看到的输出`);
  item.status = status;
  item.evidence = proofs.map((one) => one.trim());
  item.doneAt = now.toISOString();
  return { doc, item };
}

export function passHumanAcceptance(doc, { id, text, now = new Date() } = {}) {
  const { item } = findAcceptance(doc, id);
  if ((item.layer ?? "D") !== "H")
    throw new Error(`验收项 ${item.id} 不是人签收项（H）：agent 自己判的用 accept set`);
  const words = typeof text === "string" ? text.trim() : "";
  if (words.length < 4) {
    throw new Error(
      `人签收要带用户原话：accept human --id ${item.id} --text「用户说了什么」（至少 4 个字）`,
    );
  }
  if (isPlaceholderWords(words)) {
    throw new Error(
      `这句不是原话，是占位：「${words}」。请把用户实际说的那句话填进去，agent 不能替人签字`,
    );
  }
  item.status = "通过";
  item.evidence = [`用户签收：${words}`];
  item.doneAt = now.toISOString();
  return { doc, item };
}

export function setAcceptanceText(doc, { id, text, now = new Date() } = {}) {
  const { item } = findAcceptance(doc, id);
  if (!text || text.trim().length < 2) throw new Error("验收项要写 --text「怎么算过」");
  item.text = text.trim();
  item.updatedAt = now.toISOString();
  return { doc, item };
}

export function resolveFinding(doc, { id, decision, note = null, now = new Date() } = {}) {
  const { item } = findAcceptance(doc, id);
  if ((item.layer ?? "D") !== "R") throw new Error(`验收项 ${item.id} 不是审查发现（R）`);
  if (!FINDING_DECISIONS.includes(decision))
    throw new Error(`处置只能是 ${FINDING_DECISIONS.join(" / ")}`);
  const reason = typeof note === "string" ? note.trim() : "";
  if (decision !== "已修" && reason.length < 4)
    throw new Error(`「${decision}」要写 --note「为什么」（至少 4 个字）`);
  if (reason && isPlaceholderWords(reason))
    throw new Error(`处置理由不能是占位：「${reason}」。写实际原因`);
  item.resolution = { decision, note: reason || null, at: now.toISOString() };
  return { doc, item };
}

export function openFindings(doc) {
  const session = focusSession(doc);
  if (!session) return [];
  return session.segments.flatMap((segment) =>
    segment.acceptance.filter(
      (item) =>
        (item.layer ?? "D") === "R" &&
        (!item.resolution || !FINDING_DECISIONS.includes(item.resolution.decision)),
    ),
  );
}

// --- signature and closing ----------------------------------------------

export function signScope(doc, { text, now = new Date() } = {}) {
  const session = requireSession(doc);
  if (session.state !== "验收") {
    throw new Error(
      `只有验收态能签收（当前是「${session.state}」）：先 state -- set 验收 --reason …`,
    );
  }
  if (!session.scope) throw new Error("还没有范围可签收：先 state -- scope「这次交付了什么」");
  if (!text || text.trim().length < 2) {
    throw new Error('签收要带用户原话：npm run state -- sign "符合预期"');
  }
  if (isPlaceholderWords(text)) {
    throw new Error(`这句不是原话，是占位：「${text.trim()}」。签收要写下用户实际说的那句话`);
  }
  const openSegments = session.segments.filter(
    (segment) => segment.labeled && segment.status !== "已完成",
  );
  if (openSegments.length > 0) {
    throw new Error(
      `还有 ${openSegments.length} 段没完成（${openSegments.map((segment) => segment.id).join("、")}）：先完成再签收`,
    );
  }
  const blockingFailures = session.segments.flatMap((segment) =>
    segment.acceptance.filter(
      (item) => BLOCKING_LAYERS.includes(item.layer ?? "D") && item.status !== "通过",
    ),
  );
  const findings = openFindings(doc);
  if (findings.length > 0) {
    throw new Error(
      `还有 ${findings.length} 条审查发现没处置（${findings.map((item) => item.id).join("、")}）：先处置再签收`,
    );
  }
  if (blockingFailures.length > 0) {
    throw new Error(
      `还有 ${blockingFailures.length} 个 D/C/H 验收项没通过（${blockingFailures.map((item) => item.id).join("、")}）：先过再签收`,
    );
  }
  session.scope.signed = { text: text.trim(), date: today(now) };
  return { doc, scope: session.scope };
}

// --- progress and next action --------------------------------------------

export function sessionProgress(session) {
  const segments = session.segments ?? [];
  const tasks = segments.flatMap((segment) => segment.tasks);
  const acceptance = segments.flatMap((segment) => segment.acceptance);
  const blocking = acceptance.filter((item) => BLOCKING_LAYERS.includes(item.layer ?? "D"));
  return {
    segments: segments.length,
    segmentsDone: segments.filter((segment) => segment.status === "已完成").length,
    tasks: tasks.length,
    tasksDone: tasks.filter((task) => task.status === "已完成").length,
    acceptance: acceptance.length,
    acceptanceDone: blocking.filter((item) => item.status === "通过").length,
    acceptanceBlocking: blocking.length,
    findings: acceptance.filter((item) => (item.layer ?? "D") === "R").length,
    openFindings: acceptance.filter((item) => (item.layer ?? "D") === "R" && !item.resolution)
      .length,
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
  const words = typeof text === "string" ? text.trim() : "";
  if (PLACEHOLDER_WORDS.has(words)) return true;
  if (/^[…\.。xX\-—_]+$/u.test(words)) return true;
  if (/[‹›]/.test(words)) return true;
  return words.includes("你的原话") || words.includes("用户原话");
}

export function workProgress(doc) {
  const session = focusSession(doc);
  if (!session) {
    return {
      state: null,
      segments: 0,
      segmentsDone: 0,
      tasks: 0,
      tasksDone: 0,
      acceptance: 0,
      acceptanceDone: 0,
      acceptanceBlocking: 0,
      findings: 0,
      openFindings: 0,
    };
  }
  return {
    state: session.state,
    ...sessionProgress(session),
    openFindings: openFindings(doc).length,
  };
}

export function nextAction(doc) {
  const session = focusSession(doc);
  if (!session) {
    return {
      label: "开一个会话",
      command: 'npm run state -- start "要交付什么"',
      detail: "当前没有在推进的交付；琐事聊天不需要会话。",
    };
  }
  if (!session.scope) {
    return {
      label: "写清这次交付",
      command: 'npm run state -- scope "这次交付什么"',
      detail: "范围只有一句话也行；产品代码提交门会要求它存在。",
    };
  }
  const segment = currentSegment(doc);
  const task = segment?.tasks.find((one) => one.status === "未完成");
  if (task) {
    return {
      label: "完成手上的任务",
      command: `npm run state -- task done --id ${task.id} --evidence '‹跑过的命令或看到的输出›'`,
      detail: task.text,
    };
  }
  const acceptance = segment?.acceptance.find(
    (item) =>
      (item.layer ?? "D") !== "H" &&
      BLOCKING_LAYERS.includes(item.layer ?? "D") &&
      item.status === "未验",
  );
  if (segment?.labeled && acceptance) {
    return {
      label: "核对验收项",
      command: `npm run state -- accept set --id ${acceptance.id} --status 通过 --evidence '‹跑过的命令或看到的输出›'`,
      detail: acceptance.text,
    };
  }
  const finding = openFindings(doc)[0];
  if (finding) {
    return {
      label: "处置审查发现",
      command: `npm run state -- accept resolve --id ${finding.id} --decision 已修`,
      detail: finding.text,
    };
  }
  const human = segment?.acceptance.find((item) => item.layer === "H" && item.status === "未验");
  if (segment?.labeled && human) {
    return {
      label: "请用户签收",
      command: `npm run state -- accept human --id ${human.id} --text '‹用户的签收原话›'`,
      detail: human.text,
    };
  }
  if (segment && segment.status !== "已完成") {
    if (segment.labeled) {
      return {
        label: "收尾这一段",
        command: `npm run state -- segment done --id ${segment.id}`,
        detail: "任务与 D/C/R/H 都清了，这段就可以结束。",
      };
    }
    return {
      label: "收尾这一段",
      command: `npm run state -- segment done --id ${segment.id}`,
      detail: "日常段只要求任务完成，不需要建验收项。",
    };
  }
  if (!session.scope.signed) {
    if (session.state !== "验收") {
      return {
        label: "进入验收",
        command: 'npm run state -- set 验收 --reason "交付完成，请核对"',
        detail: "验收时由人核对范围；不需要签收的小事可直接 state -- close 归档。",
      };
    }
    return {
      label: "请用户签收",
      command: "npm run state -- sign '‹用户的签收原话›'",
      detail: "只有用户能签收；agent 不要代替。",
    };
  }
  return {
    label: "归档这个会话",
    command: "npm run state -- close",
    detail: "签收后归档，会话数据留在历史里，随时能切回。",
  };
}

export function briefLines(doc) {
  const session = focusSession(doc);
  if (!session) {
    return ["治理：无活动会话", '下一步：npm run state -- start "要交付什么"'];
  }
  const progress = sessionProgress(session);
  const segment = currentSegment(doc);
  const lines = [
    `治理：${session.state} · 会话 ${session.id}「${session.title}」`,
    `范围：${session.scope?.text ?? "未写"}${session.scope?.signed ? "（已签收）" : ""}`,
    `现在：${segment ? `${segment.id}${segment.name ? `「${segment.name}」` : " 日常段"} · ${segment.tasks.filter((task) => task.status !== "已完成").length} 个任务未完成` : "没有段"}`,
    `进度：段 ${progress.segmentsDone}/${progress.segments} · 任务 ${progress.tasksDone}/${progress.tasks}`,
  ];
  const waits = activeThread(doc)?.waits ?? [];
  if (waits.length > 0) lines.push(`待裁：${waits.join("；")}`);
  const findings = openFindings(doc);
  if (findings.length > 0) lines.push(`未处置发现：${findings.map((item) => item.id).join("、")}`);
  const next = nextAction(doc);
  lines.push(`下一步：${next.label} → ${next.command}`);
  return lines;
}

export function progressLines(doc) {
  const session = focusSession(doc);
  if (!session) return ["会话：无（焦点为空）"];
  const progress = sessionProgress(session);
  return [
    `会话：${session.id}「${session.title}」· ${session.state}`,
    `范围：${session.scope?.text ?? "未写"}`,
    `段 ${progress.segmentsDone}/${progress.segments} · 任务 ${progress.tasksDone}/${progress.tasks} · 验收 ${progress.acceptanceDone}/${progress.acceptanceBlocking}`,
  ];
}

export function summaryLines(doc) {
  const session = focusSession(doc);
  if (!session) return ["没有打开的会话。"];
  return [
    `${session.id}「${session.title}」· ${session.state} · 开于 ${session.since}`,
    ...session.segments.map(
      (segment) =>
        `  ${segment.id} ${segment.name ?? "日常段"} · ${segment.status} · 任务 ${segment.tasks.filter((task) => task.status === "已完成").length}/${segment.tasks.length}`,
    ),
  ];
}

export function logOf(doc, sessionId = null) {
  return (doc.log ?? []).filter((entry) => (sessionId ? entry.sessionId === sessionId : true));
}
