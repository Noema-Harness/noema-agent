import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Pass Markdown as a file; read it back as JSON, never shell line arrays.
const [number, filename] = process.argv.slice(2);
if (!/^\d+$/u.test(number ?? "") || !filename)
  throw new Error("Usage: node scripts/set-github-issue-body.mjs <issue> <body.md>");
const installed = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "NoemaTools", "github-cli", "bin", "gh.exe")
  : null;
const cli = installed && fs.existsSync(installed) ? installed : "gh";
const repository = "c3115644151/noema-agent";
const expected = fs.readFileSync(filename, "utf8");
function run(args) {
  const result = spawnSync(cli, args, { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message ?? result.stderr.trim());
  return result.stdout;
}
run(["issue", "edit", number, "-R", repository, "--body-file", path.resolve(filename)]);
const actual = JSON.parse(run(["issue", "view", number, "-R", repository, "--json", "body"])).body;
const normalize = (text) => text.replaceAll("\r\n", "\n").trimEnd();
if (normalize(actual) !== normalize(expected))
  throw new Error(`Issue #${number} body differs after upload; do not advance its state.`);
console.log(JSON.stringify({ issue: Number(number), verified: true, characters: actual.length }));
