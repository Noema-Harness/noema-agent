import assert from "node:assert/strict";
import { test } from "node:test";

import { classify, describeEvent, readState, transition } from "./inbox-bridge.mjs";

const AT = "2026-11-16T00:00:00.000Z";

test("a missing state file means nothing was delivered yet", () => {
  assert.deepEqual(readState("C:/does/not/exist/state.json"), { events: {} });
});

test("an event moves pending -> delivered -> done and never back", () => {
  const first = transition({ events: {} }, ["ci:1"], "delivered", AT);
  assert.deepEqual(first.marked, ["ci:1"]);
  assert.equal(first.state.events["ci:1"].status, "delivered");

  const second = transition(first.state, ["ci:1"], "done", AT);
  assert.equal(second.state.events["ci:1"].status, "done");

  const third = transition(second.state, ["ci:1"], "delivered", AT);
  assert.deepEqual(third.marked, []);
  assert.equal(third.state.events["ci:1"].status, "done");
});

test("classify splits events by the state they carry", () => {
  const events = [
    { key: "ci:1", kind: "ci" },
    { key: "ci:2", kind: "ci" },
    { key: "ci:3", kind: "ci" },
  ];
  const state = {
    events: { "ci:1": { status: "pending" }, "ci:2": { status: "delivered" }, "ci:3": { status: "done" } },
  };
  const groups = classify(events, state);
  assert.deepEqual(groups.pending.map((event) => event.key), ["ci:1"]);
  assert.deepEqual(groups.delivered.map((event) => event.key), ["ci:2"]);
  assert.deepEqual(groups.done.map((event) => event.key), ["ci:3"]);
});

test("an event line keeps kind, ref, title and url", () => {
  assert.equal(
    describeEvent({ kind: "ci", ref: "run 1", title: "verify failed", url: "https://example.test/1" }),
    "[ci] run 1 verify failed https://example.test/1",
  );
});
