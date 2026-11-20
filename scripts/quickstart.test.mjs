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

  const tasks = path.join(root, "tasks.txt");
  fs.writeFileSync(
    tasks,
    [
      "- [ ] 补上入口按钮",
      "      标准：点一下能打开对应界面",
      "      阶段：入口",
      "- [ ] 补上入口的说明",
      "      标准：第一次打开的人能照着做完",
      "      阶段：入口",
      "",
    ].join("\n"),
  );
  const findings = path.join(root, "findings.txt");
  fs.writeFileSync(findings, "入口按钮没有键盘焦点样式 | 建议补 focus-visible\n");
  const empty = path.join(root, "empty.txt");
  fs.writeFileSync(empty, "\n");

  try {
    const steps = [
      ["start", "把工作台的入口补齐"],
      ["scope", "把工作台的入口补齐并交付", "--kind", "修复"],
      ["tasks", "plan", tasks],
      ["task", "done", "T1", "--evidence", "手动点了一次按钮"],
      ["task", "done", "T2", "--evidence", "照着说明走了一遍"],
      ["review", "log", "--scope", "段", "--phase", "入口", "--from", findings],
      ["finding", "task", "F1"],
      ["task", "done", "T3", "--evidence", "补了 focus-visible 并重拍截图"],
      ["finding", "fix", "F1", "--note", "补了键盘焦点样式"],
      ["review", "log", "--scope", "总体", "--from", empty],
      ["set", "验收", "--reason", "任务与审查都齐了"],
      ["sign", "行，这一版可以交"],
      ["close"],
    ];
    for (const step of steps) run(root, step);

    const state = readState(root);
    assert.equal(state.version, 5);
    assert.equal(state.focus, null);
    assert.equal(state.sessions.length, 1);
    assert.equal(state.sessions[0].status, "archived");
    assert.equal(state.sessions[0].sign.text, "行，这一版可以交");
    assert.equal(state.sessions[0].findings[0].status, "已修");
    const history = JSON.parse(
      fs.readFileSync(path.join(root, "governance", "data", "history.json"), "utf8"),
    );
    assert.equal(history.at(-1).sessionId, "S1");
    assert.ok(history.at(-1).signed, "归档记录应带签收时间");
    assert.equal(history.at(-1).open, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI refuses a commit when a task has no standard", async () => {
  const { emptyState } = await import("../governance/core/state.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-quickstart-"));
  fs.mkdirSync(path.join(root, "governance", "data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "governance", "data", "state.json"),
    `${JSON.stringify(emptyState(), null, 2)}\n`,
  );
  try {
    run(root, ["start", "把一件小事做完"]);
    let failure = null;
    try {
      run(root, ["task", "add", "--text", "做点事情"]);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "缺标准的任务应当被拒");
    assert.match(String(failure.stderr), /做完的标准/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
