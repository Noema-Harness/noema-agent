import test from "node:test";
import assert from "node:assert/strict";

import { deliveryTargets, detectRepo, formatEvents, mergeConfig } from "./index.js";

const idle = { status: "idle" };
const running = { status: "running" };
const unknown = {};

test("only idle agents take a notice now; running ones are deferred", () => {
  const { ready, deferred } = deliveryTargets(new Set([idle, running]), {});
  assert.deepEqual(ready, [idle]);
  assert.deepEqual(deferred, [running]);
});

test("the interrupt switch delivers to running agents too", () => {
  const { ready, deferred } = deliveryTargets(new Set([idle, running]), {
    injectWhileRunning: true,
  });
  assert.deepEqual(ready, [idle, running]);
  assert.deepEqual(deferred, []);
});

test("an agent without a status field is treated as idle", () => {
  const { ready } = deliveryTargets(new Set([unknown]), {});
  assert.deepEqual(ready, [unknown]);
});

test("the plugin watches the repository the workspace points at", () => {
  assert.equal(detectRepo("C:/Users/NUC/Desktop/noema"), "Noema-Harness/noema-agent");
  assert.equal(detectRepo("C:/Users/NUC/Desktop"), null);
});

test("the notice says when it was queued and how to stop the reminder", () => {
  const text = formatEvents(
    [
      {
        key: "ci:1",
        kind: "ci",
        ref: "run 1",
        title: "verify failed",
        url: "https://example.test/1",
      },
      { key: "ci:2", kind: "ci", ref: "run 2", title: "package failed" },
    ],
    { maxEvents: 1, label: "外部收件箱" },
  );
  assert.match(text, /本轮开始前注入/u);
  assert.match(text, /其余 1 条/u);
  assert.match(text, /inbox:ack --done/u);
});

test("config keeps the turn-boundary default and merges poll/ack commands", () => {
  const options = mergeConfig({ cwd: "C:/Users/NUC/Desktop/noema" });
  assert.equal(options.injectWhileRunning, false);
  assert.equal(options.repo, "Noema-Harness/noema-agent");
  assert.deepEqual(options.poll.args, ["scripts/inbox-bridge.mjs", "poll"]);
});
