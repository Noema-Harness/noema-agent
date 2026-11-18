import fs from "node:fs";
import path from "node:path";
import { buildAcceptancePage } from "../governance/core/acceptance.mjs";
import { readEntry } from "../governance/core/entries.mjs";

const USAGE = `用法：npm run acceptance -- --entry <D-…> [--write]

  --entry <id>   要生成验收页的条目
  --write        写到 .work/review/<date>-<id>-acceptance.md（默认打到标准输出）
`;

function localToday(now = new Date()) {
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
}

function main(argv, root = process.cwd()) {
  const flags = parseFlags(argv);
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  const id = typeof flags.entry === "string" ? flags.entry : null;
  if (!id) {
    console.error("缺少 --entry：验收页必须对着一个条目生成。\n" + USAGE);
    return 2;
  }
  const text = fs.readFileSync(path.join(root, "docs", "DECISIONS.md"), "utf8");
  let entry;
  try {
    entry = readEntry(text, id);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const { text: page, report } = buildAcceptancePage({
    entry,
    today: localToday(),
    source: "docs/DECISIONS.md",
  });
  if (flags.write) {
    const directory = path.join(root, ".work", "review");
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${localToday()}-${id}-acceptance.md`);
    fs.writeFileSync(file, page, "utf8");
    console.log(`验收页：${path.relative(root, file).replaceAll("\\", "/")}`);
    console.log(
      `决定 ${report.decisions.length} 项、验收项 ${report.items.length} 条、未覆盖 E ${report.uncovered.length} 项`,
    );
  } else {
    console.log(page);
  }
  return report.uncovered.length > 0 ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("acceptance.mjs")) {
  process.exitCode = main(process.argv.slice(2));
}

export { main };