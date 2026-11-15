import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkSkill, installSkill, profileSkillPath, repoSkillPath } from "./skill-sync.mjs";

function makeFixture(text = "# SKILL\n\n步骤。\n") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-skill-root-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "noema-skill-home-"));
  fs.mkdirSync(path.dirname(repoSkillPath(root)), { recursive: true });
  fs.writeFileSync(repoSkillPath(root), text, "utf8");
  return { root, home };
}

test("an uninstalled skill is a notice, not a failure", () => {
  const { root, home } = makeFixture();
  const { errors, notices } = checkSkill(root, { home, ci: false });
  assert.deepEqual(errors, []);
  assert.match(notices.join("\n"), /npm run skill:install/u);
});

test("installing copies the repo source and the copies then match", () => {
  const { root, home } = makeFixture();
  const { target } = installSkill(root, home);
  assert.equal(target, profileSkillPath(home));
  assert.equal(fs.readFileSync(target, "utf8"), fs.readFileSync(repoSkillPath(root), "utf8"));
  assert.deepEqual(checkSkill(root, { home, ci: false }).errors, []);
});

test("a drifted installed copy fails locally and only warns in CI", () => {
  const { root, home } = makeFixture();
  installSkill(root, home);
  fs.writeFileSync(repoSkillPath(root), "# SKILL\n\n新步骤。\n", "utf8");
  assert.match(checkSkill(root, { home, ci: false }).errors.join("\n"), /skill:install/u);
  const ci = checkSkill(root, { home, ci: true });
  assert.deepEqual(ci.errors, []);
  assert.match(ci.notices.join("\n"), /skill:install/u);
});

test("a missing repo skill file is an error", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-skill-empty-"));
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  const { errors } = checkSkill(root, { home: root, ci: false });
  assert.match(errors.join("\n"), /SKILL\.md/u);
});
