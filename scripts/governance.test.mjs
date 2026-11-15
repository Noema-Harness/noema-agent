import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  INVARIANTS,
  PROFILES,
  RULES,
  auditRules,
  profileNames,
  profileScripts,
} from "./governance.mjs";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

test("the commit profile only runs the local gate, and CI reuses the milestone profile", () => {
  assert.deepEqual(
    PROFILES.commit.map((step) => [step.kind, step.script, step.args]),
    [["node", "scripts/maintenance.mjs", ["precommit"]]],
  );
  assert.deepEqual(PROFILES.ci, PROFILES.milestone);
  assert.deepEqual(profileNames(), ["commit", "milestone", "ci"]);
});

test("every script a profile runs exists, so the entry cannot point at a deleted file", () => {
  for (const name of profileNames()) {
    for (const script of profileScripts(name)) {
      assert.ok(fs.existsSync(path.join(root, script)), `${name} references ${script}`);
    }
  }
});

test("every rule serves an invariant, names the failure it prevents and where it runs", () => {
  assert.equal(new Set(RULES.map((rule) => rule.id)).size, RULES.length);
  for (const rule of RULES) {
    assert.ok(rule.id, "rule id");
    assert.ok(INVARIANTS.includes(rule.invariant), `${rule.id} invariant ${rule.invariant}`);
    assert.ok(rule.prevents.length > 0, `${rule.id} prevents`);
    assert.ok(rule.where.length > 0, `${rule.id} where`);
    assert.ok(rule.level === "block" || rule.level === "notice", `${rule.id} level`);
    assert.ok(rule.evidence.length > 0, `${rule.id} evidence`);
  }
});

test("the audit separates proven rules from the ones still on probation", () => {
  const audit = auditRules();
  assert.deepEqual(audit.unsupported, []);
  assert.ok(audit.blocks.length > 0);
  assert.ok(audit.notices.length > 0);
  assert.ok(
    audit.provisional.length < audit.blocks.length,
    "some blocking rules must have a real failure behind them",
  );
  for (const rule of audit.provisional) {
    assert.ok(rule.evidence.startsWith("观察期"), rule.id);
  }
});
