import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO, "scripts", "state.mjs");

function run(root, args) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: REPO,
    env: { ...process.env, NOEMA_STATE_ROOT: root },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readState(root) {
  return JSON.parse(fs.readFileSync(path.join(root, "governance", "data", "state.json"), "utf8"));
}

test("the readme quickstart runs end to end on a blank state", async () => {
  const { emptyState } = await import("../governance/core/state.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-quickstart-"));
  fs.mkdirSync(path.join(root, "governance", "data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "governance", "data", "state.json"),
    `${JSON.stringify(emptyState(), null, 2)}\n`,
  );

  try {
    const steps = [
      ["start", "给工作台补上缺的入口"],
      ["scope", "把工作台补上缺的入口", "--kind", "修复"],
      ["segment", "add", "--name", "入口补齐"],
      ["segment", "start", "--id", "P2"],
      ["task", "add", "--text", "补入口"],
      ["task", "done", "--id", "P2-T1", "--evidence", "点开入口能看到页面"],
      ["accept", "add", "--layer", "D", "--text", "入口可点击"],
      ["accept", "add", "--layer", "H", "--text", "用户认可入口位置"],
      ["accept", "set", "--id", "P2-A1", "--status", "通过", "--evidence", "手动点了一次"],
      ["accept", "human", "--id", "P2-A2", "--text", "入口位置可以"],
      ["segment", "done", "--id", "P2"],
      ["set", "验收", "--reason", "验收项全绿"],
      ["sign", "这一版可以交付"],
      ["close"],
    ];
    for (const step of steps) run(root, step);

    const state = readState(root);
    assert.equal(state.version, 4);
    assert.equal(state.focus, null);
    assert.equal(state.sessions.length, 1);
    assert.equal(state.sessions[0].status, "archived");
    assert.equal(state.sessions[0].scope.signed.text, "这一版可以交付");
    const history = JSON.parse(
      fs.readFileSync(path.join(root, "governance", "data", "history.json"), "utf8"),
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].signed.text, "这一版可以交付");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a blank state reports the first command instead of failing", async () => {
  const { emptyState } = await import("../governance/core/state.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-quickstart-"));
  fs.mkdirSync(path.join(root, "governance", "data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "governance", "data", "state.json"),
    `${JSON.stringify(emptyState(), null, 2)}\n`,
  );
  try {
    const output = run(root, ["next"]);
    assert.match(output, /开一个会话/u);
    const verify = run(root, ["verify"]);
    assert.match(verify, /合规/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
