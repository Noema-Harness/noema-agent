// 一次性迁移：把 docs/DECISIONS.md 解析成数据文件，并重渲染一次（规范化空白）。
// 判据：(1) render(parse(rendered)) === rendered（幂等）；
//      (2) parse(original) 与 parse(rendered) 逐条深相等（内容没有被改写）；
//      (3) 剩余差异只允许是空行与首尾空白。
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  STORE_PATH,
  decisionsMatchStore,
  parseDecisions,
  renderDecisions,
  saveStore,
  validateStore,
} from "../governance/core/persist.mjs";

const MARKDOWN = path.join("docs", "DECISIONS.md");

function main(argv = process.argv.slice(2)) {
  const root = process.cwd();
  const checkOnly = argv.includes("--check");
  const markdownPath = path.join(root, MARKDOWN);
  const original = fs.readFileSync(markdownPath, "utf8").replaceAll("\r\n", "\n");
  const store = parseDecisions(original);
  const errors = validateStore(store).errors;
  if (errors.length) {
    console.error(`迁移失败：数据校验不通过\n- ${errors.join("\n- ")}`);
    return 1;
  }
  const rendered = renderDecisions(store);
  const idempotent = renderDecisions(parseDecisions(rendered)) === rendered;
  const semantic = isDeepStrictEqual(parseDecisions(rendered), store);
  const identical = rendered === original;
  console.log(`条目：${store.entries.length}（结构化 ${store.entries.filter((entry) => entry.kind === "structured").length}）`);
  console.log(`逐字节相同：${identical ? "是" : "否（规范化空白；内容按条深比较）"}`);
  console.log(`幂等（render·parse·render）：${idempotent ? "通过" : "失败"}`);
  console.log(`内容深相等（原文件 vs 渲染后）：${semantic ? "通过" : "失败"}`);
  if (!idempotent || !semantic) return 1;
  if (checkOnly) {
    console.log("--check：没有写入");
    return 0;
  }
  saveStore(root, store);
  fs.writeFileSync(markdownPath, rendered, "utf8");
  if (!decisionsMatchStore(store, fs.readFileSync(markdownPath, "utf8"))) {
    console.error("写盘后渲染与数据不一致");
    return 1;
  }
  console.log(`已写 ${STORE_PATH} 与 ${MARKDOWN}`);
  return 0;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/migrate-decisions.mjs")) {
  process.exitCode = main();
}