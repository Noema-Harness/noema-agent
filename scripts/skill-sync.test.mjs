import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SKILL_NAMES,
  checkSkill,
  installSkill,
  installSkills,
  profileSkillPath,
  repoSkillPath,
} from "./skill-sync.mjs";

function makeFixture(text = "# SKILL\n\n骨架。\n") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-skill-root-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "noema-skill-home-"));
  for (const name of SKILL_NAMES) {
    const file = repoSkillPath(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${text}${name}\n`, "utf8");
  }
  return { root, home };
}

test("uninstalled skills are notices, not failures", () => {
  const { root, home } = makeFixture();
  const { errors, notices } = checkSkill(root, { home, ci: false });
  assert.deepEqual(errors, []);
  const text = notices.join("\n");
  assert.match(text, /npm run skill:install/u);
  for (const name of SKILL_NAMES) assert.match(text, new RegExp(name, "u"));
});

test("installing copies every repo skill and the copies then match", () => {
  const { root, home } = makeFixture();
  const installed = installSkills(root, home);
  assert.deepEqual(
    installed.map((item) => item.name),
    SKILL_NAMES,
  );
  for (const item of installed) {
    assert.equal(item.target, profileSkillPath(home, item.name));
    assert.equal(fs.readFileSync(item.target, "utf8"), fs.readFileSync(item.source, "utf8"));
  }
  assert.deepEqual(checkSkill(root, { home, ci: false }).errors, []);
});

test("installing one skill by name only touches that skill", () => {
  const { root, home } = makeFixture();
  const [, governance] = SKILL_NAMES;
  const installed = installSkill(root, home, governance);
  assert.equal(installed.target, profileSkillPath(home, governance));
  assert.equal(fs.existsSync(profileSkillPath(home, SKILL_NAMES[0])), false);
});

test("one drifted installed copy fails locally and only warns in CI", () => {
  const { root, home } = makeFixture();
  installSkills(root, home);
  fs.writeFileSync(repoSkillPath(root, SKILL_NAMES[1]), "# SKILL\n\n新步骤。\n", "utf8");
  const local = checkSkill(root, { home, ci: false });
  assert.equal(local.errors.length, 1);
  assert.match(local.errors.join("\n"), new RegExp(`${SKILL_NAMES[1]}.*skill:install`, "u"));
  const ci = checkSkill(root, { home, ci: true });
  assert.deepEqual(ci.errors, []);
  assert.match(ci.notices.join("\n"), /skill:install/u);
});

test("a missing repo skill file is an error", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noema-skill-empty-"));
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  const { errors } = checkSkill(root, { home: root, ci: false });
  assert.equal(errors.length, SKILL_NAMES.length);
  assert.match(errors.join("\n"), /SKILL\.md/u);
});