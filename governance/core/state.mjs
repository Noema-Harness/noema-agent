// Tracks what the agent is doing (discussion / execution / acceptance) and the
// discussion sessions that belong to the current run. Pure logic: no file IO,
// no project names, no repository paths. The adapter layer picks the paths.

export const STATES = ["讨论", "执行", "验收"];

export const PACK_BY_STATE = {
  讨论: "discussion",
  执行: "execution",
  验收: "acceptance",
};

export const ENDINGS = ["定案", "归档"];

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
  if (kind === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === kind;
}

function isDateLike(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/u.test(value);
}

function today(now) {
  return now.toISOString().slice(0, 10);
}

function nextThreadId(doc, now) {
  const stamp = today(now).replaceAll("-", "");
  const used = new Set(doc.threads.map((thread) => thread.id));
  let index = doc.threads.length + 1;
  let candidate = `thread-${stamp}-${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `thread-${stamp}-${index}`;
  }
  return candidate;
}

export function emptyState(now = new Date()) {
  return {
    version: 1,
    current: { state: "讨论", since: now.toISOString(), threadId: null },
    log: [],
    threads: [],
  };
}

export function validateState(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") return ["状态数据不是对象"];
  if (doc.version !== 1) errors.push(`状态数据版本应为 1，实际为 ${String(doc.version)}`);
  if (!Array.isArray(doc.log)) errors.push("状态数据缺少 log 数组");
  if (!Array.isArray(doc.threads)) errors.push("状态数据缺少 threads 数组");
  if (!doc.current || typeof doc.current !== "object") {
    errors.push("状态数据缺少 current");
  } else {
    if (!STATES.includes(doc.current.state)) {
      errors.push(`当前状态「${String(doc.current.state)}」不在允许列表（${STATES.join(" / ")}）`);
    }
    if (!isDateLike(doc.current.since)) errors.push("current.since 不是日期");
    const threadId = doc.current.threadId;
    if (threadId !== null && !doc.threads?.some((thread) => thread.id === threadId)) {
      errors.push(`current.threadId 指向不存在的会话：${String(threadId)}`);
    }
  }
  const ids = new Set();
  for (const thread of doc.threads ?? []) {
    for (const [field, kind] of Object.entries(THREAD_FIELDS)) {
      const value = thread[field];
      const allowed = Array.isArray(kind) ? kind : [kind];
      if (!allowed.some((one) => matchesKind(value, one))) {
        errors.push(`会话 ${String(thread.id)} 的 ${field} 不合规`);
      }
    }
    if (ids.has(thread.id)) errors.push(`会话 id 重复：${thread.id}`);
    ids.add(thread.id);
    if (thread.status !== "active" && thread.status !== "archived") {
      errors.push(`会话 ${String(thread.id)} 的 status 只能是 active 或 archived`);
    }
    if (thread.ending !== null && !ENDINGS.includes(thread.ending)) {
      errors.push(`会话 ${String(thread.id)} 的 ending 只能是 ${ENDINGS.join(" / ")} 或 null`);
    }
  }
  return errors;
}

export function activeThread(doc) {
  return doc.threads.find((thread) => thread.status === "active") ?? null;
}

export function threadById(doc, id) {
  return doc.threads.find((thread) => thread.id === id) ?? null;
}

export function ensureThread(doc, { title = null, now = new Date() } = {}) {
  const active = activeThread(doc);
  if (active) return { doc, thread: active, created: false };
  const thread = {
    id: nextThreadId(doc, now),
    title: title ?? "未命名讨论",
    startedAt: now.toISOString(),
    status: "active",
    endedAt: null,
    ending: null,
    rounds: [],
    waits: [],
    evidence: [],
    output: { design: null, kickoff: null, scope: null },
  };
  doc.threads.push(thread);
  doc.current.threadId = thread.id;
  return { doc, thread, created: true };
}

export function lastArchivedThread(doc) {
  const archived = doc.threads.filter((thread) => thread.status === "archived");
  return archived.length > 0 ? archived[archived.length - 1] : null;
}

export function archiveThread(doc, { id = null, ending = "归档", now = new Date() } = {}) {
  const thread = id ? threadById(doc, id) : activeThread(doc);
  if (!thread) throw new Error("没有可归档的会话");
  if (thread.status === "archived") throw new Error(`会话 ${thread.id} 已经归档`);
  if (!ENDINGS.includes(ending)) throw new Error(`结束方式只能是 ${ENDINGS.join(" / ")}`);
  thread.status = "archived";
  thread.endedAt = now.toISOString();
  thread.ending = ending;
  if (doc.current.threadId === thread.id) doc.current.threadId = null;
  return { doc, thread };
}

export function resumeThread(doc, { id = null, now = new Date() } = {}) {
  const target = id ? threadById(doc, id) : lastArchivedThread(doc);
  if (!target) throw new Error("没有可恢复的会话");
  if (target.status === "active" && doc.current.threadId === target.id) {
    return { doc, thread: target, resumed: false };
  }
  const current = activeThread(doc);
  if (current) archiveThread(doc, { id: current.id, ending: "归档", now });
  target.status = "active";
  target.endedAt = null;
  target.ending = null;
  doc.current.threadId = target.id;
  return { doc, thread: target, resumed: true };
}

export function setState(doc, { to, reason = null, scope = null, obligation = null, now = new Date() }) {
  if (!STATES.includes(to)) {
    throw new Error(`未知状态「${String(to)}」：只能是 ${STATES.join(" / ")}`);
  }
  const from = doc.current.state;
  if (from === to) throw new Error(`已经在「${to}」状态`);
  if (!reason || reason.trim().length < 2) {
    throw new Error("切换状态要写 --reason「为什么切换」（至少 2 个字）");
  }
  const day = today(now);
  let threadId = doc.current.threadId;
  let closed = false;
  if (from === "讨论") {
    const active = activeThread(doc);
    if (active) {
      const ending = to === "执行" && active.output?.design && active.output?.kickoff ? "定案" : "归档";
      archiveThread(doc, { id: active.id, ending, now });
      threadId = active.id;
      closed = ending === "定案";
    }
  }
  if (to === "讨论") {
    const resume = resumeThread(doc, { now });
    threadId = resume.thread.id;
  } else if (threadId === null || !threadById(doc, threadId)) {
    threadId = null;
  }
  const resolved = obligation ?? (closed ? "关闭" : "挂起");
  doc.current = { state: to, since: now.toISOString(), threadId };
  if (scope) doc.current.scope = scope;
  doc.log.push({
    from,
    to,
    date: day,
    reason: reason.trim(),
    obligation: resolved,
    threadId,
  });
  return { doc, log: doc.log[doc.log.length - 1] };
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

export function logOf(doc, { limit = 10 } = {}) {
  return doc.log.slice(-limit);
}

export function summaryLines(doc) {
  const current = doc.current;
  const thread = current.threadId ? threadById(doc, current.threadId) : null;
  const lines = [`状态：${current.state}（${current.since}）`];
  if (current.scope) lines.push(`范围：${current.scope}`);
  if (thread) {
    const last = thread.rounds[thread.rounds.length - 1];
    lines.push(`会话：${thread.title}（第 ${thread.rounds.length} 轮）`);
    if (last) lines.push(`上轮结论：${last.conclusion}`);
    lines.push(`待裁：${thread.waits.length === 0 ? "无" : thread.waits.join("；")}`);
    const output = thread.output ?? {};
    const done = ["design", "kickoff"].filter((key) => Boolean(output[key]));
    if (done.length > 0) lines.push(`产出：${done.join("、")}`);
  } else {
    lines.push("会话：无（进入讨论时自动开始，或在讨论中记录）");
  }
  return lines;
}