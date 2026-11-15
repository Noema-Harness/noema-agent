import test from "node:test";
import assert from "node:assert/strict";
import { classifyBranches, parseRefs } from "./branches.mjs";

const NOW = Date.parse("2026-11-15T00:00:00Z");
const DAY = 86_400;

function branch(name, daysAgo) {
  return {
    ref: `origin/${name}`,
    name,
    sha: "0000000",
    committedAt: Math.floor(NOW / 1000) - daysAgo * DAY,
  };
}

test("merged branches are a cleanup notice, not a failed check", () => {
  const refs = [
    branch("main", 0),
    branch("codex/merged", 3),
    branch("codex/old-topic", 90),
    branch("codex/fresh-topic", 5),
  ];
  const result = classifyBranches({
    refs,
    base: "origin/main",
    now: NOW,
    isMerged: (b) => b.name === "codex/merged",
    aheadCount: (b) => (b.name === "codex/old-topic" ? 4 : 1),
  });
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.stale, ["codex/merged"]);
  assert.equal(result.notices.length, 2);
  assert.match(result.notices[0], /codex\/merged 已完全合入 origin\/main/);
  assert.match(result.notices[1], /codex\/old-topic 已 90 天未动且未合入（ahead=4）/);
});

test("branch refs parse the tab-free format used by for-each-ref", () => {
  const refs = parseRefs("origin/main abc1234 1763000000\norigin/codex/x def5678 1763000100\n");
  assert.deepEqual(
    refs.map((r) => r.name),
    ["main", "codex/x"],
  );
  assert.equal(refs[1].committedAt, 1763000100);
});
