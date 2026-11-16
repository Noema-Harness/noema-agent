// Inbox CLI locator.
//
// The inbox bridge is its own project (https://github.com/Noema-Harness/dsh-inbox-bridge):
// this repository only points at it. Resolution order: `INBOX_CLI`, then the
// sibling checkout this workspace normally has (`..\dsh-inbox-bridge`).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLI_REL = resolve("scripts", "inbox-bridge.mjs");

const candidates = [
  process.env.INBOX_CLI,
  resolve(here, "..", "..", "dsh-inbox-bridge", CLI_REL),
].filter((candidate) => typeof candidate === "string" && candidate.length > 0);

const cli = candidates.find((candidate) => existsSync(candidate));

if (!cli) {
  console.error(
    [
      "inbox: 找不到收件箱工具。它不在本仓库里，单独维护在 Noema-Harness/dsh-inbox-bridge。",
      "",
      "  1) 克隆/更新到同级目录：git clone https://github.com/Noema-Harness/dsh-inbox-bridge ..\\dsh-inbox-bridge",
      "  2) 或指路：$env:INBOX_CLI = \"C:\\path\\to\\dsh-inbox-bridge\\scripts\\inbox-bridge.mjs\"",
    ].join("\n"),
  );
  process.exitCode = 2;
} else {
  execFileSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit" });
}
