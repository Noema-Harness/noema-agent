// 条目正文的字段级编辑与阶段事件整理。
// 只做文本操作，不认识项目路径、命令或门；适配层负责校验与写盘。
const STAGE_EVENT = /^- ((?:转待验收|退回|转执行中|重开|暂停|恢复|中断))[:：]\s*(.*)$/u;
const CURRENT_EVENT = /^- 当前：(转待验收|退回|重开)（(\d{4}-\d{2}-\d{2})）：(.*)$/u;
const FIELD_LINES = {
  blocker: { match: /^- \*\*阻塞\*\*：/u, write: (value) => `- **阻塞**：${value}` },
  pending: { match: /^- 要定：/u, write: (value) => `- 要定：${value}` },
  conclusion: { match: /^- 结论：/u, write: (value) => `- 结论：${value}` },
};
// 阶段事件写在「发生它的那个阶段」小节里，不写决策层、不写目标阶段。
const EVENT_SECTION = {
  转待验收: "#### 2 执行",
  重开: "#### 3 验收",
  用户确认: "#### 3 验收",
  暂停: "#### 1 决策",
  恢复: "#### 1 决策",
  中断: "#### 1 决策",
};

function entrySpan(lines, id) {
  const head = lines.findIndex((line) => /^##\s/u.test(line) && line.includes(id));
  if (head < 0) throw new Error(`找不到条目 ${id}`);
  let end = lines.length;
  for (let index = head + 1; index < lines.length; index += 1) {
    if (/^##\s/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { head, end };
}

function sectionRange(lines, head, end, heading) {
  const start = lines.findIndex((line, at) => at > head && at < end && line.trim() === heading);
  if (start < 0) return null;
  let stop = end;
  for (let index = start + 1; index < end; index += 1) {
    if (/^####\s/u.test(lines[index])) {
      stop = index;
      break;
    }
  }
  return { start, stop };
}

function dateOf(line) {
  const full = /（(\d{4}-\d{2}-\d{2})）/u.exec(line);
  if (full) return full[1];
  const bare = /[:：]\s*(\d{4}-\d{2}-\d{2})/u.exec(line);
  return bare ? bare[1] : "";
}

export function editEntryFields(text, id, fields = {}) {
  const lines = text.split("\n");
  const { head, end } = entrySpan(lines, id);
  const changed = [];
  for (const [key, field] of Object.entries(FIELD_LINES)) {
    const value = fields[key];
    if (value === undefined) continue;
    const index = lines.findIndex((line, at) => at > head && at < end && field.match.test(line));
    if (index < 0) throw new Error(`条目 ${id} 没有「${key}」字段，先用命令补结构再改值`);
    lines[index] = field.write(value);
    changed.push(key);
  }
  return { text: lines.join("\n"), changed };
}

export function normaliseStageEvents(text, id) {
  const lines = text.split("\n");
  const { head, end } = entrySpan(lines, id);
  const found = [];
  for (let index = head + 1; index < end; index += 1) {
    const match = STAGE_EVENT.exec(lines[index]);
    if (match)
      found.push({ index, kind: match[1], date: dateOf(lines[index]), line: lines[index] });
  }
  if (found.length < 2) return { text, removed: 0, order: found.map((item) => item.kind) };
  const seen = new Set();
  const unique = [];
  for (const item of found) {
    const key = item.line.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  // 每个阶段都在自己的小节里留记录：这里只按类型留最新一条，位置交给 distributeStageEvents。
  const newest = new Map();
  for (const item of unique) {
    const previous = newest.get(item.kind);
    if (!previous || previous.date <= item.date) newest.set(item.kind, item);
  }
  const kept = new Set([...newest.values()].map((item) => item.line.trim()));
  const without = lines.filter((line, index) => {
    if (!found.some((item) => item.index === index)) return true;
    return kept.has(line.trim());
  });
  return {
    text: without.join("\n"),
    removed: found.length - kept.size,
    order: [...newest.values()].map((item) => item.kind),
  };
}

export function distributeStageEvents(text, id) {
  const lines = text.split("\n");
  let span = entrySpan(lines, id);
  const events = [];
  for (let index = span.head + 1; index < span.end; index += 1) {
    const match = STAGE_EVENT.exec(lines[index]);
    if (match) {
      events.push({ index, kind: match[1], rest: match[2], date: dateOf(lines[index]) });
      continue;
    }
    const current = CURRENT_EVENT.exec(lines[index]);
    if (current) events.push({ index, kind: current[1], rest: current[3], date: current[2] });
  }
  if (events.length === 0) return { text, moved: 0, placed: [] };
  for (let index = events.length - 1; index >= 0; index -= 1) lines.splice(events[index].index, 1);
  span = entrySpan(lines, id);
  const placed = [];
  const insertions = [];
  for (const event of events) {
    const heading = EVENT_SECTION[event.kind];
    if (!heading) continue;
    const range = sectionRange(lines, span.head, span.end, heading);
    if (!range) continue;
    let at = range.stop;
    while (at - 1 > range.start && lines[at - 1].trim() === "") at -= 1;
    const suffix = event.rest.trim().endsWith(`（${event.date}）`) ? "" : `（${event.date}）`;
    insertions.push({ at, line: `- ${event.kind}：${event.rest.trim()}${suffix}` });
  }
  insertions.sort((left, right) => right.at - left.at);
  for (const insertion of insertions) {
    lines.splice(insertion.at, 0, insertion.line);
    placed.push(insertion.line);
  }
  return { text: lines.join("\n"), moved: events.length, placed };
}

/** 把一条阶段事件追加到「发生它的那个阶段」小节末尾（同类型只留最新）。 */
export function appendStageEvent(text, id, { kind, rest = "", date = "", section }) {
  const heading = section ?? EVENT_SECTION[kind];
  if (!heading) throw new Error(`未知阶段事件：${kind}`);
  const lines = text.split("\n");
  const span = entrySpan(lines, id);
  const range = sectionRange(lines, span.head, span.end, heading);
  if (!range) throw new Error(`条目 ${id} 没有「${heading}」小节`);
  for (let index = range.stop - 1; index > range.start; index -= 1) {
    if (lines[index].startsWith(`- ${kind}：`)) lines.splice(index, 1);
  }
  const again = entrySpan(lines, id);
  const target = sectionRange(lines, again.head, again.end, heading);
  let at = target.stop;
  while (at - 1 > target.start && lines[at - 1].trim() === "") at -= 1;
  const suffix = date && !rest.trim().endsWith(`（${date}）`) ? `（${date}）` : "";
  const line = rest.trim()
    ? `- ${kind}：${rest.trim()}${suffix}`
    : `- ${kind}${date ? `（${date}）` : ""}`;
  lines.splice(at, 0, line);
  return { text: lines.join("\n"), line };
}

export function appendExecutionLine(text, id, line) {
  const lines = text.split("\n");
  const span = entrySpan(lines, id);
  const range = sectionRange(lines, span.head, span.end, "#### 2 执行");
  if (!range) throw new Error(`条目 ${id} 没有「#### 2 执行」小节`);
  const prefix = line.split("：")[0] + "：";
  for (let index = range.stop - 1; index > range.start; index -= 1) {
    if (lines[index].startsWith(prefix)) lines.splice(index, 1);
  }
  const again = entrySpan(lines, id);
  const target = sectionRange(lines, again.head, again.end, "#### 2 执行");
  let at = target.stop;
  while (at - 1 > target.start && lines[at - 1].trim() === "") at -= 1;
  lines.splice(at, 0, line);
  return { text: lines.join("\n"), line };
}

export function addWaitingItem(text, id, item) {
  const lines = text.split("\n");
  const span = entrySpan(lines, id);
  const range = sectionRange(lines, span.head, span.end, "###### 待裁");
  if (!range) throw new Error(`条目 ${id} 没有「###### 待裁」小节`);
  for (let index = range.stop - 1; index > range.start; index -= 1) {
    if (/^- 待裁：无/u.test(lines[index])) lines.splice(index, 1);
  }
  const again = entrySpan(lines, id);
  const target = sectionRange(lines, again.head, again.end, "###### 待裁");
  let at = target.stop;
  while (at - 1 > target.start && lines[at - 1].trim() === "") at -= 1;
  const line = `- ${String(item).trim()}`;
  lines.splice(at, 0, line);
  return { text: lines.join("\n"), line };
}

export function dropWaitingItem(text, id, item) {
  const key = String(item)
    .trim()
    .split(/[\s　：:]/u)[0];
  if (!key) throw new Error("--item 为空：写成「- T1 …」里的编号或整行文字");
  const lines = text.split("\n");
  const span = entrySpan(lines, id);
  const range = sectionRange(lines, span.head, span.end, "###### 待裁");
  if (!range) throw new Error(`条目 ${id} 没有「###### 待裁」小节`);
  let removed = null;
  for (let index = range.stop - 1; index > range.start; index -= 1) {
    if (lines[index].replace(/^- /u, "").startsWith(key)) {
      removed = lines[index];
      lines.splice(index, 1);
      break;
    }
  }
  if (!removed) throw new Error(`待裁块里没有以「${key}」开头的项`);
  const again = entrySpan(lines, id);
  const empty = sectionRange(lines, again.head, again.end, "###### 待裁");
  const hasItem = empty
    ? lines.slice(empty.start + 1, empty.stop).some((line) => /^- (?!待裁：无)/u.test(line))
    : true;
  if (!hasItem) lines.splice(empty.stop - 1, 0, "- 待裁：无");
  return { text: lines.join("\n"), removed };
}

export function addUpdateNote(text, id, note) {
  const lines = text.split("\n");
  let { head, end } = entrySpan(lines, id);
  const prefixMatch = /^- ([^：]+)：/u.exec(note);
  const prefix = prefixMatch ? `- ${prefixMatch[1]}：` : null;
  if (prefix) {
    for (let index = end - 1; index > head; index -= 1) {
      if (lines[index].startsWith(prefix)) lines.splice(index, 1);
    }
    const again = entrySpan(lines, id);
    end = again.end;
  }
  const decisionAt = lines.findIndex(
    (line, at) => at > head && at < end && /^#### 1 决策/u.test(line),
  );
  const pendingAt = lines.findIndex((line, at) => at > head && at < end && /^- 要定：/u.test(line));
  const at = pendingAt >= 0 ? pendingAt + 1 : decisionAt >= 0 ? decisionAt + 1 : head + 1;
  lines.splice(at, 0, note);
  return lines.join("\n");
}
