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

export const PHASE_STATUSES = ["进行中", "已完成"];
export const TASK_STATUSES = ["未完成", "已完成"];
export const ACCEPTANCE_STATUSES = ["未验", "通过", "不通过"];
// D=确定性检查 C=判据对照 R=审查发现（只出清单，不判通过）H=人签收
export const ACCEPTANCE_LAYERS = ["D", "C", "R", "H"];
export const BLOCKING_LAYERS = ["D", "C", "H"];
export const MAX_PHASES = 5;

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

export function emptyWork() {
  return { scope: null, phases: [] };
}

export function emptyState(now = new Date()) {
  return {
    version: 2,
    current: { state: "讨论", since: now.toISOString(), threadId: null },
    log: [],
    threads: [],
    work: emptyWork(),
  };
}

// Version 1 stored only the state machine; the work list arrived with version
// 2. Reading an old file upgrades it in place so callers never see two shapes.
export function upgradeState(raw) {
  if (!raw || typeof raw !== "object") throw new Error("状态数据不是对象");
  if (raw.version === 2) return raw;
  if (raw.version === 1) {
    return { ...raw, version: 2, work: raw.work ?? emptyWork() };
  }
  throw new Error(`状态数据版本 ${String(raw.version)} 无法升级：只支持 1 → 2`);
}

export function validateState(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") return ["状态数据不是对象"];
  if (doc.version !== 2) errors.push(`状态数据版本应为 2，实际为 ${String(doc.version)}`);
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
  const work = doc.work;
  if (!work || typeof work !== "object") {
    errors.push("状态数据缺少 work（范围与阶段）");
  } else {
    if (
      work.scope !== null &&
      (typeof work.scope !== "object" || typeof work.scope.text !== "string")
    ) {
      errors.push("work.scope 只能是 null 或 {text, since}");
    }
    if (!Array.isArray(work.phases)) {
      errors.push("work.phases 不是数组");
    } else {
      if (work.phases.length > MAX_PHASES) {
        errors.push(`阶段最多 ${MAX_PHASES} 个，实际 ${work.phases.length} 个`);
      }
      const phaseIds = new Set();
      for (const phase of work.phases) {
        if (typeof phase.id !== "string" || !/^P\d+$/u.test(phase.id))
          errors.push(`阶段 id 不合规：${String(phase.id)}`);
        if (typeof phase.name !== "string" || phase.name.trim().length < 2)
          errors.push(`阶段 ${String(phase.id)} 缺少名字`);
        if (phase.goal !== null && typeof phase.goal !== "string")
          errors.push(`阶段 ${String(phase.id)} 的 goal 只能是字符串或 null`);
        if (!PHASE_STATUSES.includes(phase.status))
          errors.push(`阶段 ${String(phase.id)} 的 status 不合规`);
        if (phaseIds.has(phase.id)) errors.push(`阶段 id 重复：${phase.id}`);
        phaseIds.add(phase.id);
        const taskIds = new Set();
        if (!Array.isArray(phase.tasks)) {
          errors.push(`阶段 ${phase.id} 缺少 tasks 数组`);
        } else {
          for (const task of phase.tasks) {
            if (
              typeof task.id !== "string" ||
              !new RegExp(`^${phase.id}-T\\d+$`, "u").test(task.id)
            ) {
              errors.push(`任务 id 不合规：${String(task.id)}`);
            }
            if (typeof task.text !== "string" || task.text.trim().length < 2)
              errors.push(`任务 ${String(task.id)} 缺少说明`);
            if (!TASK_STATUSES.includes(task.status))
              errors.push(`任务 ${String(task.id)} 的 status 不合规`);
            if (!Array.isArray(task.evidence))
              errors.push(`任务 ${String(task.id)} 的 evidence 不是数组`);
            if (taskIds.has(task.id)) errors.push(`任务 id 重复：${task.id}`);
            taskIds.add(task.id);
          }
        }
        if (!Array.isArray(phase.acceptance)) {
          errors.push(`阶段 ${phase.id} 缺少 acceptance 数组`);
        } else {
          for (const item of phase.acceptance) {
            if (
              typeof item.id !== "string" ||
              !new RegExp(`^${phase.id}-A\\d+$`, "u").test(item.id)
            ) {
              errors.push(`验收项 id 不合规：${String(item.id)}`);
            }
            if (typeof item.text !== "string" || item.text.trim().length < 2)
              errors.push(`验收项 ${String(item.id)} 缺少说明`);
            if (!ACCEPTANCE_STATUSES.includes(item.status))
              errors.push(`验收项 ${String(item.id)} 的 status 不合规`);
            if (!Array.isArray(item.evidence))
              errors.push(`验收项 ${String(item.id)} 的 evidence 不是数组`);
            const layer = item.layer ?? "D";
            if (!ACCEPTANCE_LAYERS.includes(layer)) {
              errors.push(
                `验收项 ${String(item.id)} 的 layer 只能是 ${ACCEPTANCE_LAYERS.join(" / ")}`,
              );
            }
          }
        }
        if (phase.review !== undefined && phase.review !== null) {
          if (typeof phase.review !== "object" || Array.isArray(phase.review)) {
            errors.push(`阶段 ${phase.id} 的 review 不是对象`);
          } else {
            for (const key of ["what", "gap", "split", "at"]) {
              const value = phase.review[key];
              if (value !== null && typeof value !== "string") {
                errors.push(`阶段 ${phase.id} 的 review.${key} 只能是字符串或 null`);
              }
            }
          }
        }
      }
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

export function setState(doc, { to, reason = null, obligation = null, now = new Date() }) {
  if (!STATES.includes(to)) {
    throw new Error(`未知状态「${String(to)}」：只能是 ${STATES.join(" / ")}`);
  }
  const from = doc.current.state;
  if (from === to) throw new Error(`已经在「${to}」状态`);
  if (!reason || reason.trim().length < 2) {
    throw new Error("切换状态要写 --reason「为什么切换」（至少 2 个字）");
  }
  const work = doc.work ?? emptyWork();
  if (to === "执行" && !work.scope) {
    throw new Error('进执行前先声明范围：npm run state -- scope "这次做什么"（一句话也算）');
  }
  if (to === "验收") {
    if (!work.scope) throw new Error("还没有范围：先 state -- scope 声明这次做了什么");
    if (work.phases.length === 0) {
      throw new Error('进验收前至少要有阶段清单：state -- phase add --name "…"');
    }
    const open = work.phases.filter((phase) => phase.status !== "已完成");
    if (open.length > 0) {
      throw new Error(
        `还有 ${open.length} 个阶段没完成（${open.map((phase) => phase.id).join("、")}）：进验收前阶段要全部完成`,
      );
    }
  }
  const day = today(now);
  let threadId = doc.current.threadId;
  let closed = false;
  if (from === "讨论") {
    const active = activeThread(doc);
    if (active) {
      const ending =
        to === "执行" && active.output?.design && active.output?.kickoff ? "定案" : "归档";
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

export function findPhase(doc, id) {
  const phase = doc.work?.phases?.find((one) => one.id === id);
  if (!phase) throw new Error(`没有阶段 ${String(id)}（先跑 npm run state -- work 看清单）`);
  return phase;
}

function findTask(doc, id) {
  for (const phase of doc.work?.phases ?? []) {
    const task = phase.tasks.find((one) => one.id === id);
    if (task) return { phase, task };
  }
  throw new Error(`没有任务 ${String(id)}（先跑 npm run state -- work 看清单）`);
}

function findAcceptance(doc, id) {
  for (const phase of doc.work?.phases ?? []) {
    const item = phase.acceptance.find((one) => one.id === id);
    if (item) return { phase, item };
  }
  throw new Error(`没有验收项 ${String(id)}（先跑 npm run state -- work 看清单）`);
}

export function setScope(doc, { text, now = new Date() } = {}) {
  if (!text || text.trim().length < 2) {
    throw new Error("范围要写清楚「这次做什么」（至少 2 个字）");
  }
  doc.work = doc.work ?? emptyWork();
  doc.work.scope = { text: text.trim(), since: now.toISOString(), signed: null };
  return { doc, scope: doc.work.scope };
}

// The only human hand-off in the state model: in the acceptance state the user
// signs that the delivered scope matches what they expected. The signature is
// kept as words plus a date; it does not touch the code or the work list.
export function signScope(doc, { text, now = new Date() } = {}) {
  if (doc.current.state !== "验收") {
    throw new Error(`只有验收态能签收范围（当前是「${doc.current.state}」）`);
  }
  if (!doc.work?.scope) throw new Error("还没有范围可签收：先 state -- scope");
  if (!text || text.trim().length < 2) {
    throw new Error('签收要带用户原话：npm run state -- sign "符合预期"');
  }
  const openPhases = (doc.work.phases ?? []).filter((phase) => phase.status !== "已完成");
  if (openPhases.length > 0) {
    throw new Error(
      `还有 ${openPhases.length} 个阶段没完成（${openPhases.map((phase) => phase.id).join("、")}）：阶段验收要先过，再签收范围`,
    );
  }
  const blockingFailures = (doc.work.phases ?? []).flatMap((phase) =>
    (phase.acceptance ?? []).filter(
      (item) => BLOCKING_LAYERS.includes(item.layer ?? "D") && item.status !== "通过",
    ),
  );
  if (blockingFailures.length > 0) {
    throw new Error(
      `还有 ${blockingFailures.length} 个 D/C/H 验收项没通过（${blockingFailures.map((item) => item.id).join("、")}）：先过阶段验收再签收`,
    );
  }
  doc.work.scope.signed = { text: text.trim(), date: today(now) };
  return { doc, scope: doc.work.scope };
}

export function addPhase(doc, { name, goal = null, now = new Date() } = {}) {
  doc.work = doc.work ?? emptyWork();
  if (doc.work.phases.length >= MAX_PHASES) {
    throw new Error(`阶段最多 ${MAX_PHASES} 个：先把范围拆小，或合并阶段`);
  }
  if (!name || name.trim().length < 2) throw new Error("阶段要写 --name「这个阶段交付什么」");
  const id = `P${doc.work.phases.length + 1}`;
  const phase = {
    id,
    name: name.trim(),
    goal: goal ? goal.trim() : null,
    status: "进行中",
    createdAt: now.toISOString(),
    doneAt: null,
    tasks: [],
    acceptance: [],
  };
  doc.work.phases.push(phase);
  return { doc, phase };
}

export function completePhase(doc, { id, now = new Date() } = {}) {
  const phase = findPhase(doc, id);
  if (phase.status === "已完成") throw new Error(`阶段 ${phase.id} 已经完成`);
  const openTasks = phase.tasks.filter((task) => task.status !== "已完成");
  if (openTasks.length > 0) {
    throw new Error(
      `阶段 ${phase.id} 还有 ${openTasks.length} 个任务没完成：${openTasks.map((task) => task.id).join("、")}`,
    );
  }
  // R 层是审查发现清单，只记录不判通过；D/C/H 必须全部通过。
  const blocking = phase.acceptance.filter((item) => BLOCKING_LAYERS.includes(item.layer ?? "D"));
  const unchecked = blocking.filter((item) => item.status === "未验");
  const failed = blocking.filter((item) => item.status === "不通过");
  if (unchecked.length > 0)
    throw new Error(
      `阶段 ${phase.id} 还有 ${unchecked.length} 个验收项没判：${unchecked.map((one) => one.id).join("、")}`,
    );
  if (failed.length > 0)
    throw new Error(
      `阶段 ${phase.id} 还有不通过的验收项：${failed.map((one) => one.id).join("、")}`,
    );
  phase.status = "已完成";
  phase.doneAt = now.toISOString();
  return { doc, phase };
}

export function addTask(doc, { phase: phaseId, text, now = new Date() } = {}) {
  const phase = findPhase(doc, phaseId);
  if (!text || text.trim().length < 2) throw new Error("任务要写 --text「一句话交付物」");
  const id = `${phase.id}-T${phase.tasks.length + 1}`;
  const task = { id, text: text.trim(), status: "未完成", evidence: [], doneAt: null };
  phase.tasks.push(task);
  return { doc, phase, task };
}

export function completeTask(doc, { id, evidence = null, now = new Date() } = {}) {
  const { phase, task } = findTask(doc, id);
  task.status = "已完成";
  task.doneAt = now.toISOString();
  if (evidence && String(evidence).trim().length > 0) task.evidence.push(String(evidence).trim());
  return { doc, phase, task };
}

export function addAcceptance(doc, { phase: phaseId, text, layer = "D", now = new Date() } = {}) {
  const phase = findPhase(doc, phaseId);
  if (!text || text.trim().length < 2) throw new Error("验收项要写 --text「这一条怎么算过」");
  if (!ACCEPTANCE_LAYERS.includes(layer)) {
    throw new Error(
      `验收层只能是 ${ACCEPTANCE_LAYERS.join(" / ")}（D 确定性检查 / C 判据对照 / R 审查发现 / H 人签收）`,
    );
  }
  const id = `${phase.id}-A${phase.acceptance.length + 1}`;
  const item = { id, layer, text: text.trim(), status: "未验", evidence: [], checkedAt: null };
  phase.acceptance.push(item);
  return { doc, phase, item };
}

// 进入阶段时的三条最小重审：本阶段验什么、可能漏什么、要不要拆/并阶段。
export function reviewPhase(
  doc,
  { id, what = null, gap = null, split = null, now = new Date() } = {},
) {
  const phase = findPhase(doc, id);
  if (!what && !gap && !split) throw new Error("阶段重审至少写一条：--what / --gap / --split");
  phase.review = {
    what: what ? String(what).trim() : null,
    gap: gap ? String(gap).trim() : null,
    split: split ? String(split).trim() : null,
    at: now.toISOString(),
  };
  return { doc, phase };
}

export function setAcceptance(doc, { id, status, evidence = null, now = new Date() } = {}) {
  if (!ACCEPTANCE_STATUSES.includes(status)) {
    throw new Error(`验收结论只能是 ${ACCEPTANCE_STATUSES.join(" / ")}`);
  }
  const { phase, item } = findAcceptance(doc, id);
  item.status = status;
  item.checkedAt = now.toISOString();
  if (evidence && String(evidence).trim().length > 0) item.evidence.push(String(evidence).trim());
  return { doc, phase, item };
}

export function workProgress(doc) {
  const phases = doc.work?.phases ?? [];
  const tasks = phases.flatMap((phase) => phase.tasks);
  const items = phases.flatMap((phase) => phase.acceptance);
  const blocking = items.filter((item) => BLOCKING_LAYERS.includes(item.layer ?? "D"));
  return {
    phases: {
      done: phases.filter((phase) => phase.status === "已完成").length,
      total: phases.length,
    },
    tasks: { done: tasks.filter((task) => task.status === "已完成").length, total: tasks.length },
    acceptance: {
      passed: blocking.filter((item) => item.status === "通过").length,
      failed: blocking.filter((item) => item.status === "不通过").length,
      unchecked: blocking.filter((item) => item.status === "未验").length,
      total: blocking.length,
      findings: items.filter((item) => item.layer === "R").length,
    },
  };
}

export function progressLines(doc) {
  const progress = workProgress(doc);
  const lines = [];
  const scope = doc.work?.scope;
  if (scope) lines.push(`范围：${scope.text}`);
  lines.push(
    `阶段 ${progress.phases.done}/${progress.phases.total} · 任务 ${progress.tasks.done}/${progress.tasks.total} · 验收 ${progress.acceptance.passed}/${progress.acceptance.total}${progress.acceptance.failed > 0 ? `（不通过 ${progress.acceptance.failed}）` : ""}${progress.acceptance.findings > 0 ? ` · 审查发现 ${progress.acceptance.findings} 条` : ""}`,
  );
  const currentPhase = (doc.work?.phases ?? []).find((phase) => phase.status === "进行中");
  if (currentPhase) lines.push(`当前阶段：${currentPhase.id} ${currentPhase.name}`);
  return lines;
}

export function logOf(doc, { limit = 10 } = {}) {
  return doc.log.slice(-limit);
}

export function summaryLines(doc) {
  const current = doc.current;
  const thread = current.threadId ? threadById(doc, current.threadId) : null;
  const lines = [`状态：${current.state}（${current.since}）`];
  lines.push(...progressLines(doc));

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
