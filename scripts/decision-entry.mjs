#!/usr/bin/env node
// 新建决议条目的两步机制：先起草（不落库），确认已获用户批准后再落库。
//
// 为什么不用一句文档提醒：规则已经写着「条目由用户驱动」，同类问题仍然出现了
// 两次。默认路径必须从「直接写」换成「先起草、停下确认、再落库」，并且落库时
// 带着用户的原话——退化路径由此变成「明显编造一句原话」，可被对话记录对照。
//
// 入口：`npm run decision:draft` → `npm run decision:accept`。
// 草稿目录 `.work/decisions-draft/` 是一次性过程材料，落库后删除。

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkDecisionEntries, localToday } from "./maintenance.mjs";
import {
  ensureStore,
  parseEntry,
  renderDecisions,
  saveStore,
  validateStore,
} from "../governance/core/persist.mjs";

export const DRAFTS_DIR = path.join(".work", "decisions-draft");
export const APPROVAL_MIN_LENGTH = 10;

const ENTRY_ID = /^D-\d{8}-[a-z0-9-]+$/u;
const SLUG = /^[a-z0-9-]+$/u;
const SOURCE_LINE = /^- \*\*来源\*\*：/u;

export const CONFIRMATION_QUESTION = "本次条目创建是否已得到用户明确批准？批准原话是哪一句？";

function decisionsPath(root) {
  return path.join(root, "docs", "DECISIONS.md");
}

function hasEntry(text, id) {
  return new RegExp(`^## .*\\b${id}\\b`, "mu").test(text);
}

export function draftEntry({ root = process.cwd(), title, slug, body, now = new Date() }) {
  const cleanTitle = String(title ?? "").trim();
  if (!cleanTitle) throw new Error("缺少 --title：先写清这条要定什么");
  const cleanSlug = String(slug ?? "").trim();
  if (!SLUG.test(cleanSlug)) {
    throw new Error("缺少 --slug（小写字母、数字、连字符）：条目编号是 D-<日期>-<slug>");
  }
  const text = String(body ?? "").trim();
  if (!text) throw new Error("缺少 --body：把条目正文（四个字段 + 三层）写在文件里");

  const date = localToday(now);
  const id = `D-${date.replaceAll("-", "")}-${cleanSlug}`;
  if (!ENTRY_ID.test(id)) throw new Error(`条目编号不合法：${id}`);

  const decisions = readFileSync(decisionsPath(root), "utf8");
  if (hasEntry(decisions, id)) throw new Error(`条目已存在：${id}`);

  const draftPath = path.join(root, DRAFTS_DIR, `${id}.md`);
  if (existsSync(draftPath)) throw new Error(`草稿已存在：${path.join(DRAFTS_DIR, `${id}.md`)}`);

  const draft = [
    `<!-- 草稿，未落库。确认用户已批准创建后：npm run decision:accept -- ${id} --approval "<用户原话>" -->`,
    "",
    `## ⏳ ${id} ${cleanTitle}`,
    "",
    text,
    "",
  ].join("\n");

  mkdirSync(path.dirname(draftPath), { recursive: true });
  writeFileSync(draftPath, draft, "utf8");
  return { id, draftPath, question: CONFIRMATION_QUESTION };
}

function resolveDraft(root, id) {
  const candidate = String(id ?? "").trim();
  if (!candidate) throw new Error("缺少草稿编号：npm run decision:accept -- <D-…> --approval \"<用户原话>\"");
  const bare = candidate.endsWith(".md") ? path.basename(candidate, ".md") : path.basename(candidate);
  if (!ENTRY_ID.test(bare)) throw new Error(`草稿编号不合法：${candidate}`);
  const draftPath = path.join(root, DRAFTS_DIR, `${bare}.md`);
  if (!existsSync(draftPath)) throw new Error(`起草不存在：${path.join(DRAFTS_DIR, `${bare}.md`)}`);
  return { id: bare, draftPath };
}

function stripDraftHeader(text) {
  return text
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("<!--"))
    .join("\n")
    .trim();
}

// 批准原话写进「来源」而不是新增字段：字段白名单只有 阶段/结构/来源/阻塞，
// 多一个字段会被 docs:check 拒绝；来源本来就要求写清用户在哪一轮提出。
function withApproval(entryText, quote, date) {
  const lines = entryText.split(/\r?\n/u);
  const index = lines.findIndex((line) => SOURCE_LINE.test(line));
  if (index === -1) {
    throw new Error("草稿缺少「- **来源**：」字段：条目必须写清用户在哪一轮提出");
  }
  const line = lines[index].trimEnd();
  if (line.includes(`「${quote}」`)) return entryText;
  lines[index] = `${line}；批准创建（用户原话：「${quote}」，${date}）`;
  return lines.join("\n");
}

export function acceptEntry({ root = process.cwd(), id, approval, now = new Date() }) {
  const quote = String(approval ?? "").trim();
  if (!quote) {
    throw new Error("缺少 --approval：先拿到用户的明确批准，再带着原话落库");
  }
  if ([...quote].length < APPROVAL_MIN_LENGTH) {
    throw new Error(
      `批准原话太短（${[...quote].length} 字，至少 ${APPROVAL_MIN_LENGTH} 字）：带用户的原话，而不是「可以」「行」`,
    );
  }

  const draft = resolveDraft(root, id);
  const date = localToday(now);
  const entryText = withApproval(stripDraftHeader(readFileSync(draft.draftPath, "utf8")), quote, date);

  const store = ensureStore(root);
  const before = renderDecisions(store);
  const next = `${before.trimEnd()}\n\n${entryText}\n`;
  const check = checkDecisionEntries(next);
  if (check.errors.length) {
    throw new Error(
      `草稿落库前校验失败（条目没有写进文件）：\n${check.errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
  store.entries.push(parseEntry(entryText));
  const storeErrors = validateStore(store).errors;
  if (storeErrors.length) {
    throw new Error(`草稿落库前数据校验失败：\n${storeErrors.map((error) => `- ${error}`).join("\n")}`);
  }
  saveStore(root, store);
  writeFileSync(decisionsPath(root), renderDecisions(store), "utf8");
  rmSync(draft.draftPath);
  return { id: draft.id, approval: quote, date };
}

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`参数 ${token} 缺少值`);
    flags[key] = value;
    index += 1;
  }
  return flags;
}

const USAGE = [
  "用法：",
  '  npm run decision:draft -- --title "<标题>" --slug <短名> --body <正文文件>',
  '  npm run decision:accept -- <D-YYYYMMDD-短名> --approval "<用户原话>"',
].join("\n");

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const [command, ...rest] = argv;
  if (command === "draft") {
    const flags = parseFlags(rest);
    const bodyPath = path.resolve(root, flags.body ?? "");
    if (!flags.body || !existsSync(bodyPath)) throw new Error(`--body 指向的文件不存在：${flags.body ?? "(缺少)"}`);
    const result = draftEntry({
      root,
      title: flags.title,
      slug: flags.slug,
      body: readFileSync(bodyPath, "utf8"),
    });
    return [
      `草稿已写入 ${path.relative(root, result.draftPath)}（未落库，docs/DECISIONS.md 没有改动）。`,
      "",
      `确认问题：${result.question}`,
      "",
      `得到明确答复后：npm run decision:accept -- ${result.id} --approval "<用户原话>"`,
      "没有得到批准就不要落库；草稿可以删。",
    ].join("\n");
  }
  if (command === "accept") {
    const positional = rest.filter((token) => !token.startsWith("--"));
    const flags = parseFlags(rest);
    const id = positional[0] ?? flags.id;
    if (!id) throw new Error(`缺少条目 id\n${USAGE}`);
    const result = acceptEntry({ root, id, approval: flags.approval });
    return `已落库：${result.id}（批准原话：「${result.approval}」，${result.date}）`;
  }
  throw new Error(`未知命令：${command ?? "(缺少)"}\n${USAGE}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    process.stdout.write(`${main()}\n`);
  } catch (error) {
    process.stderr.write(`decision-entry: ${error.message}\n`);
    process.exitCode = 1;
  }
}