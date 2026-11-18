// 条目历史只增：批次、完成、决定、验收项、阶段事件这几类行是「已经发生过的事实」，
// 只允许追加或改写，不允许减少；整条带历史的条目也不允许消失。
// 纯文本，不认识项目路径与命令。
const ENTRY_ID = /^##\s+.*?\b(D-\d{8}-[a-z0-9-]+)\b/u;
const HISTORY_KINDS = [
  ["批次", /^- (?:批次|当前批次|批次历史)：/u],
  ["完成", /^- 完成：/u],
  ["决定", /^- 决定：/u],
  ["阶段事件", /^- (?:转待验收|偏差|重开|用户确认|暂停|恢复|中断)[:：]/u],
];

export function entryIdOfHeading(line) {
  return ENTRY_ID.exec(line)?.[1] ?? null;
}

export function historyCounts(entryText) {
  const counts = {};
  for (const [kind, pattern] of HISTORY_KINDS) {
    counts[kind] = entryText.split("\n").filter((line) => pattern.test(line)).length;
  }
  return counts;
}

export function historyOf(text) {
  const lines = text.split("\n");
  const map = new Map();
  let current = null;
  let body = [];
  const flush = () => {
    if (current) map.set(current, historyCounts(body.join("\n")));
  };
  for (const line of lines) {
    const id = ENTRY_ID.exec(line)?.[1] ?? null;
    if (id) {
      flush();
      current = id;
      body = [];
      continue;
    }
    if (current) body.push(line);
  }
  flush();
  return map;
}

const total = (counts) => Object.values(counts).reduce((sum, value) => sum + value, 0);

/** 返回被删掉的历史行与消失的带历史条目。 */
export function compareEntryHistory(previousText, currentText) {
  const before = historyOf(previousText);
  const after = historyOf(currentText);
  const removed = [];
  const dropped = [];
  for (const [id, counts] of before) {
    if (!after.has(id)) {
      if (total(counts) > 0) dropped.push(id);
      continue;
    }
    const now = after.get(id);
    for (const [kind] of HISTORY_KINDS) {
      if (now[kind] < counts[kind]) {
        removed.push({ id, kind, before: counts[kind], after: now[kind] });
      }
    }
  }
  return { removed, dropped };
}

export { HISTORY_KINDS };