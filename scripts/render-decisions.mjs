// 从数据文件重渲染 markdown 视图（不做任何内容判断）。
import path from "node:path";
import { renderStoreToMarkdown } from "../governance/core/store.mjs";

function main() {
  const root = process.cwd();
  const markdown = renderStoreToMarkdown({
    root,
    storePath: path.join("governance", "data", "decisions.json"),
    markdownPath: path.join("docs", "DECISIONS.md"),
  });
  console.log(`已从 governance/data/decisions.json 重渲染 docs/DECISIONS.md（${markdown.split("\n").length} 行）`);
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/render-decisions.mjs")) {
  main();
}