// 条目正文的字段级编辑与阶段事件整理。
// 只做文本操作，不认识项目路径、命令或门；适配层负责校验与写盘。
const STAGE_EVENT = /^- ((?:转待验收|退回|转执行中|重开|暂停|恢复|中断))[:：]\s*(.*)$/u;
const FIELD_LINES = {
  blocker: { match: /^- \*\*阻塞\*\*：/u, write: (value) => `- **阻塞**：${value}` },
  pending: { match: /^- 要定：/u, write: (value) => `- 要定：${value}` },
  conclusion: { match: /^- 结论：/u, write: (value) => `- 结论：${value}` },
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
    if (match) found.push({ index, kind: match[1], date: dateOf(lines[index]), line: lines[index] });
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
  unique.sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : left.index - right.index));
  const first = found[0].index;
  const without = lines.filter((line, index) => !found.some((item) => item.index === index));
  const insertAt = first - found.filter((item) => item.index < first).length;
  without.splice(insertAt, 0, ...unique.map((item) => item.line));
  return { text: without.join("\n"), removed: found.length - unique.length, order: unique.map((item) => item.kind) };
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
  const decisionAt = lines.findIndex((line, at) => at > head && at < end && /^#### 1 决策/u.test(line));
  const pendingAt = lines.findIndex((line, at) => at > head && at < end && /^- 要定：/u.test(line));
  const at = pendingAt >= 0 ? pendingAt + 1 : decisionAt >= 0 ? decisionAt + 1 : head + 1;
  lines.splice(at, 0, note);
  return lines.join("\n");
}
