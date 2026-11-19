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
      ["round", "--conclusion", "结论：先做最小一版"],
      ["wait", "add", "--item", "T1 用哪种布局"],
      ["scope", "把工作台补上缺的入口", "--kind", "修复"],
      ["set", "执行", "--reason", "范围已定"],
      ["phase", "add", "--name", "入口补齐"],
      ["phase", "start", "--id", "P1"],
      ["task", "add", "--phase", "P1", "--text", "补入口"],
      ["task", "done", "--id", "P1-T1", "--evidence", "点开入口能看到页面"],
      ["accept", "add", "--phase", "P1", "--layer", "D", "--text", "入口可点击"],
      ["accept", "add", "--phase", "P1", "--layer", "H", "--text", "用户认可入口位置"],
      ["accept", "set", "--id", "P1-A1", "--status", "通过", "--evidence", "手动点了一次"],
      ["accept", "human", "--id", "P1-A2", "--text", "入口位置可以"],
      ["phase", "done", "--id", "P1"],
      ["set", "验收", "--reason", "验收项全绿"],
      ["sign", "这一版可以交付"],
      ["clean"],
    ];
    for (const step of steps) run(root, step);

    const state = readState(root);
    assert.equal(state.current.state, "讨论");
    assert.equal(state.work.scope, null);
    assert.equal(state.work.phases.length, 0);
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
    assert.match(output, /开始一次讨论会话/u);
    const verify = run(root, ["verify"]);
    assert.match(verify, /合规/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
