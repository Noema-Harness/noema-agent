// 决策持久层测试：真实文件 roundtrip、计数、校验拒绝、临时目录读写往返。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  entryById,
  loadStore,
  parseDecisions,
  parseEntry,
  renderDecisions,
  renderEntry,
  saveStore,
  STORE_PATH,
  validateStore,
} from "./persist.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DECISIONS_FILE = path.join(ROOT, "docs", "DECISIONS.md");
const ROUND_HEADING = /^###### 第 \d+ 轮/u;
const ENTRY_HEADING =
  /^## (?:([⏳🔧🔍✅])\s+)?(?:\[#(\d+)\]\(([^)]*)\)\s+)?(D-\d{8}-[a-z0-9-]+)(?:\s+(.*))?$/u;

function readDecisions() {
  const text = fs.readFileSync(DECISIONS_FILE, "utf8");
  assert.notEqual(text.charCodeAt(0), 0xfeff, "原文件不应带 BOM");
  return text;
}

function countRounds(text) {
  return text.split(/\r?\n/u).filter((line) => ROUND_HEADING.test(line)).length;
}

// 文档中的条目原文块（到下一个 dated 条目标题前）；渲染块去掉条目间分隔空行后比较。
function entryBlocks(text) {
  const lines = text.split("\n");
  const marks = [];
  lines.forEach((line, index) => {
    const match = ENTRY_HEADING.exec(line);
    if (match) marks.push({ index, id: match[4] });
  });
  return marks.map((mark, position) => {
    const stop = marks[position + 1]?.index ?? lines.length;
    const raw = lines.slice(mark.index, stop).join("\n");
    return { id: mark.id, raw: raw.replace(/\n+$/u, "\n") };
  });
}

test("真实文件：roundtrip 幂等、24 条目、13 轮次", () => {
  const original = readDecisions();
  const store = parseDecisions(original);
  assert.equal(store.version, 1);
  assert.equal(store.entries.length, 24);
  assert.equal(countRounds(original), 13);
  assert.deepEqual(validateStore(store).errors, []);

  const rendered = renderDecisions(store);
  assert.equal(countRounds(rendered), 13);
  assert.equal(renderDecisions(parseDecisions(rendered)), rendered);
  assert.ok(rendered.endsWith("\n") && !rendered.endsWith("\n\n"));
});

test("真实文件：规范化前后 parseDecisions 逐条深相等", () => {
  const original = readDecisions();
  const rendered = renderDecisions(parseDecisions(original));
  assert.deepEqual(parseDecisions(rendered), parseDecisions(original));
});

test("渲染文档：每个条目 renderEntry(parseEntry(block)) 逐字节还原", () => {
  const rendered = renderDecisions(parseDecisions(readDecisions()));
  const blocks = entryBlocks(rendered);
  assert.equal(blocks.length, 24);
  for (const block of blocks) {
    assert.equal(renderEntry(parseEntry(block.raw)), block.raw, `${block.id} 未逐字节还原`);
  }
});

test("parseEntry 缺字段时安全降级，validateStore 拒绝缺阶段与重复 id", () => {
  const store = parseDecisions(renderDecisions(parseDecisions(readDecisions())));

  const withoutStage = structuredClone(store);
  withoutStage.entries[0].stage = null;
  const missingStage = validateStore(withoutStage).errors;
  assert.ok(
    missingStage.some((error) => error.includes("阶段")),
    `缺阶段应报错，实际：${JSON.stringify(missingStage)}`,
  );

  const duplicated = structuredClone(store);
  duplicated.entries.push(structuredClone(duplicated.entries[0]));
  const duplicateErrors = validateStore(duplicated).errors;
  assert.ok(
    duplicateErrors.some((error) => error.includes("重复")),
    `重复 id 应报错，实际：${JSON.stringify(duplicateErrors)}`,
  );

  const bare = parseEntry("## D-20260101-no-fields 只有标题\n");
  assert.equal(bare.stage, null);
  assert.deepEqual(bare.fields, {});
  assert.equal(renderEntry(bare), "## D-20260101-no-fields 只有标题\n\n");
});

test("saveStore/loadStore：临时目录往返、2 空格缩进、结尾换行", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "decisions-persist-"));
  try {
    const store = parseDecisions(renderDecisions(parseDecisions(readDecisions())));
    const file = saveStore(dir, store);
    assert.equal(file, path.join(dir, STORE_PATH));
    assert.deepEqual(loadStore(dir), store);
    assert.deepEqual(loadStore(dir, STORE_PATH), store);

    const raw = fs.readFileSync(file, "utf8");
    assert.ok(raw.endsWith("\n"));
    assert.ok(!raw.includes("\r"));
    assert.ok(raw.includes('\n  "version": 1'));
    assert.deepEqual(JSON.parse(raw), store);
    assert.equal(fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith(".tmp")).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("entryById 命中返回条目，未命中返回 null", () => {
  const store = parseDecisions(renderDecisions(parseDecisions(readDecisions())));
  const first = store.entries[0];
  assert.equal(entryById(store, first.id), first);
  assert.equal(entryById(store, "D-19990101-missing"), null);
  assert.equal(entryById({ version: 1, preamble: "", entries: [] }, first.id), null);
});