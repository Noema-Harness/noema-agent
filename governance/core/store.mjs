// 条目写入桥：数据文件是真相，markdown 是每次由数据渲染出来的视图。
// 这里只做「读 entry 文本 → 改 → 校验 → 存回数据 → 重渲染」，不解析整份文档。
import fs from "node:fs";
import path from "node:path";
import {
  entryById,
  loadStore,
  parseEntry,
  renderDecisions,
  renderEntry,
  saveStore,
  validateStore,
} from "./persist.mjs";

export class StoreError extends Error {}

export function readStore({ root, storePath }) {
  return loadStore(root, storePath);
}

// mutate 接收该条目的 markdown 块文本，返回新的块文本；行为门与结构校验在写盘前完成。
export function updateEntry({
  root,
  storePath,
  markdownPath,
  id,
  mutate,
  validate,
  dryRun = false,
}) {
  const store = readStore({ root, storePath });
  const current = entryById(store, id);
  if (!current) throw new StoreError(`找不到条目：${id}`);
  const before = renderEntry(current);
  const after = mutate(before);
  if (typeof after !== "string" || !after.trim()) {
    throw new StoreError("条目改写没有返回文本：操作被拒绝");
  }
  const next = parseEntry(after);
  if (next.id !== id) {
    throw new StoreError(`条目改写后 id 变成 ${next.id}：只允许修改 ${id} 自己的内容`);
  }
  const errors = [];
  validate?.(before, after, errors);
  if (errors.length > 0) throw new StoreError(`写入前校验失败：${errors.join("；")}`);
  const trial = { ...store, entries: store.entries.map((entry) => (entry.id === id ? next : entry)) };
  const storeErrors = validateStore(trial).errors;
  if (storeErrors.length > 0) throw new StoreError(`数据校验失败：${storeErrors.join("；")}`);
  if (dryRun) return { store: trial, entry: next, before, after, dryRun: true };
  saveStore(root, trial, storePath);
  const markdown = renderDecisions(trial);
  fs.mkdirSync(path.dirname(path.join(root, markdownPath)), { recursive: true });
  fs.writeFileSync(path.join(root, markdownPath), markdown, "utf8");
  return { store: trial, entry: next, before, after, markdown };
}

// 只重渲染 markdown（迁移、修复视图时用）。
export function renderStoreToMarkdown({ root, storePath, markdownPath }) {
  const store = readStore({ root, storePath });
  const errors = validateStore(store).errors;
  if (errors.length > 0) throw new StoreError(`数据校验失败：${errors.join("；")}`);
  const markdown = renderDecisions(store);
  fs.writeFileSync(path.join(root, markdownPath), markdown, "utf8");
  return markdown;
}

export { entryById, renderEntry, parseEntry };