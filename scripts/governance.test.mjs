import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PROFILES, profileNames, profileScripts } from "./governance.mjs";

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
