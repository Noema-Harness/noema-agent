#!/usr/bin/env node
// 把当前 state.json 原样归档进 history.json，然后清空焦点。
// 用它处理「旧版本数据打不开」或「想重新开始时保留证据」。
import fs from "node:fs";
import path from "node:path";

const root = process.env.NOEMA_STATE_ROOT || process.cwd();
const statePath = path.join(root, "governance", "data", "state.json");
const historyPath = path.join(root, "governance", "data", "history.json");

if (!fs.existsSync(statePath)) {
  console.error(`没有找到 ${path.relative(root, statePath)}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, "utf8")) : [];
const entry = {
  kind: `legacy-v${String(raw.version ?? "?")}`,
  archivedAt: new Date().toISOString(),
  state: raw,
};
history.push(entry);
fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");

console.log(
  `已归档 ${path.relative(root, statePath)}（版本 ${String(raw.version ?? "?")}）到 history.json 第 ${history.length} 条。\n` +
    `下一步：npm run state -- start "要交付什么" 开新会话。`,
);
