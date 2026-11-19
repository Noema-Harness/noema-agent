// 条目持久层：数据文件是唯一真相，markdown 是渲染产物。
// 契约：render(parse(rendered)) === rendered（幂等）；迁移时用 parse 的深比较证明内容没有被改写。
import fs from "node:fs";
import path from "node:path";

export const STORE_PATH = path.join("governance", "data", "decisions.json");
export const STORE_VERSION = 1;
export const STAGE_VALUES = ["决策中", "执行中", "待验收", "已收口"];
export const FIELD_ORDER = ["阶段", "结构", "来源", "阻塞"];
const FIELD_KEYS = [
  ["结构", "structure"],
  ["来源", "source"],
  ["阻塞", "blocker"],
];

const ENTRY_START = /^## (?=[^\n]*\bD-[0-9])/gmu;
const HEADING = /^## (?:(?<lead>[^\n]*?)\s)?(?<id>D-[0-9][A-Za-z0-9-]*)(?:\s+(?<title>[^\n]*))?$/u;
const FIELD = /^- \*\*(阶段|结构|来源|阻塞)\*\*：\s*(.*)$/u;
const SECTION = /^#### ([123]) (决策|执行|验收)\s*$/u;

function lines(text) {
  return String(text).replaceAll("\r\n", "\n").split("\n");
}

function trimBlank(list) {
  let start = 0;
  let end = list.length;
  while (start < end && list[start].trim() === "") start += 1;
  while (end > start && list[end - 1].trim() === "") end -= 1;
  return list.slice(start, end);
}

/** 把一个 `## …` 块解析成条目：旧条目保留原始 body，结构化条目拆字段与三段。 */
export function parseEntry(block) {
  const list = lines(block);
  const heading = list[0] ?? "";
  const match = HEADING.exec(heading);
  if (!match) throw new Error(`条目标题无法解析：${heading}`);
  const emoji = (match.groups.lead ?? "").trim() || null;
  const id = match.groups.id;
  const title = (match.groups.title ?? "").trim();
  const rest = list.slice(1);
  const firstSection = rest.findIndex((line) => SECTION.test(line.trim()));
  if (firstSection === -1) {
    return { kind: "legacy", id, title, emoji, body: trimBlank(rest).join("\n") };
  }
  const fields = {};
  for (const line of rest.slice(0, firstSection)) {
    const field = FIELD.exec(line.trim());
    if (field) fields[field[1]] = field[2].trim() || null;
  }
  const buffer = { 1: [], 2: [], 3: [] };
  let current = null;
  for (const raw of rest.slice(firstSection)) {
    const section = SECTION.exec(raw.trim());
    if (section) {
      current = section[1];
      continue;
    }
    if (current) buffer[current].push(raw);
  }
  return {
    kind: "structured",
    id,
    title,
    emoji,
    stage: fields.阶段 ?? null,
    fields: {
      structure: fields.结构 ?? null,
      source: fields.来源 ?? null,
      blocker: fields.阻塞 ?? null,
    },
    sections: {
      decision: trimBlank(buffer[1]).join("\n"),
      execution: trimBlank(buffer[2]).join("\n"),
      acceptance: trimBlank(buffer[3]).join("\n"),
    },
  };
}

const SECTION_LABELS = [
  ["decision", "#### 1 决策"],
  ["execution", "#### 2 执行"],
  ["acceptance", "#### 3 验收"],
];

/** 渲染单条：结构化条目用固定格式，旧条目原样输出 body。 */
export function renderEntry(entry) {
  const heading = [entry.emoji, entry.id, entry.title].filter(Boolean).join(" ");
  if (entry.kind === "legacy") {
    return `## ${heading}\n\n${String(entry.body ?? "").trimEnd()}`;
  }
  const fieldLines = [];
  if (entry.stage) fieldLines.push(`- **阶段**：${entry.stage}`);
  for (const [label, key] of FIELD_KEYS) {
    const value = entry.fields?.[key];
    if (value) fieldLines.push(`- **${label}**：${value}`);
  }
  const parts = [`## ${heading}`, fieldLines.join("\n")];
  for (const [key, label] of SECTION_LABELS) {
    parts.push(label, String(entry.sections?.[key] ?? "").trimEnd());
  }
  return parts.join("\n\n");
}

export function parseDecisions(text) {
  const source = String(text).replaceAll("\r\n", "\n");
  const starts = [...source.matchAll(ENTRY_START)].map((match) => match.index);
  const preamble = starts.length ? source.slice(0, starts[0]).trimEnd() : source.trimEnd();
  const entries = starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : source.length;
    return parseEntry(source.slice(start, end).trimEnd());
  });
  return { version: STORE_VERSION, preamble, entries };
}

export function renderDecisions(store) {
  const preamble = String(store?.preamble ?? "").trimEnd();
  const blocks = (store?.entries ?? []).map(renderEntry);
  const body = [preamble, blocks.join("\n\n")].filter((part) => part.length > 0).join("\n\n");
  return body.length ? `${body}\n` : "";
}

export function validateStore(store) {
  const errors = [];
  if (!store || typeof store !== "object") return { errors: ["数据不是对象"] };
  if (store.version !== STORE_VERSION) errors.push(`version 必须是 ${STORE_VERSION}`);
  if (!Array.isArray(store.entries)) errors.push("entries 必须是数组");
  if (typeof store.preamble !== "string") errors.push("preamble 必须是字符串");
  const seen = new Set();
  for (const entry of store.entries ?? []) {
    if (!entry?.id) {
      errors.push("条目缺少 id");
      continue;
    }
    if (seen.has(entry.id)) errors.push(`条目 id 重复：${entry.id}`);
    seen.add(entry.id);
    if (entry.kind === "legacy") {
      if (typeof entry.body !== "string") errors.push(`${entry.id} 的 body 必须是字符串`);
      continue;
    }
    if (!entry.stage || !STAGE_VALUES.includes(entry.stage)) {
      errors.push(`${entry.id} 的阶段不合法：${entry.stage ?? "(缺少)"}`);
    }
    for (const key of ["decision", "execution", "acceptance"]) {
      if (typeof entry.sections?.[key] !== "string") errors.push(`${entry.id} 缺少 ${key} 段`);
    }
  }
  return { errors };
}

export function entryById(store, id) {
  return (store?.entries ?? []).find((entry) => entry.id === id) ?? null;
}

function resolvePath(root, storePath) {
  return path.join(root ?? process.cwd(), storePath ?? STORE_PATH);
}

export function loadStore(root = process.cwd(), storePath = STORE_PATH) {
  const file = resolvePath(root, storePath);
  if (!fs.existsSync(file)) throw new Error(`条目数据文件不存在：${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function saveStore(root, store, storePath = STORE_PATH) {
  const file = resolvePath(root, storePath);
  const errors = validateStore(store).errors;
  if (errors.length) throw new Error(`数据校验失败：${errors.join("；")}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = `${JSON.stringify(store, null, 2)}\n`;
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, text, "utf8");
  fs.renameSync(temporary, file);
  return text;
}

/** 渲染后的 markdown 与当前文件是否一致。 */
export function decisionsMatchStore(store, markdown) {
  return renderDecisions(store) === String(markdown).replaceAll("\r\n", "\n");
}
/** 命令入口的引导：数据文件缺失时，从当前 markdown 解析一次并落盘。 */
export function ensureStore(root = process.cwd(), storePath = STORE_PATH) {
  const file = resolvePath(root, storePath);
  if (fs.existsSync(file)) return loadStore(root, storePath);
  const markdownPath = path.join(root ?? process.cwd(), "docs", "DECISIONS.md");
  const markdown = fs.readFileSync(markdownPath, "utf8");
  const store = parseDecisions(markdown);
  saveStore(root, store, storePath);
  return store;
}
