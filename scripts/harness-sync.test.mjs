import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = path.resolve(fileURLToPath(new URL("./harness-sync.mjs", import.meta.url)));

function run(command, codexHome, dshHome, ...extra) {
  return spawnSync(
    process.execPath,
    [script, command, "--codex-home", codexHome, "--dsh-home", dshHome, "--skip-tools", ...extra],
    { encoding: "utf8", windowsHide: true, timeout: 10000 },
  );
}

function parse(result) {
  return JSON.parse(result.stdout);
}

test("user harness import copies skills, preserves adaptations and reports drift", () => {
  const holder = fs.mkdtempSync(path.join(os.tmpdir(), "noema-harness-sync-"));
  try {
    const codex = path.join(holder, "codex");
    const dsh = path.join(holder, "dsh");
    fs.mkdirSync(path.join(codex, "skills", "alpha", "references"), { recursive: true });
    fs.mkdirSync(path.join(codex, "skills", ".system", "ignored"), { recursive: true });
    fs.writeFileSync(path.join(codex, "AGENTS.md"), "# Global\n");
    fs.writeFileSync(
      path.join(codex, "skills", "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: probe\n---\n# Alpha\n",
    );
    fs.writeFileSync(path.join(codex, "skills", "alpha", "references", "detail.md"), "detail-v1");
    fs.writeFileSync(path.join(codex, "skills", ".system", "ignored", "SKILL.md"), "ignored");

    const imported = run("import", codex, dsh);
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(fs.readFileSync(path.join(dsh, "AGENTS.md"), "utf8"), "# Global\n");
    assert.equal(fs.existsSync(path.join(dsh, "skills", "alpha", "SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(dsh, "skills", ".system")), false);
    assert.equal(fs.existsSync(path.join(dsh, "harness-import.json")), true);

    const clean = parse(run("check", codex, dsh));
    assert.equal(clean.status, "ok", JSON.stringify(clean.errors));
    assert.equal(clean.skills.missing.length, 0);

    fs.appendFileSync(path.join(dsh, "skills", "alpha", "SKILL.md"), "\nDSH note\n");
    fs.writeFileSync(path.join(codex, "skills", "alpha", "references", "detail.md"), "detail-v2");
    const drifted = parse(run("check", codex, dsh));
    assert(drifted.skills.locallyAdapted.includes("alpha/SKILL.md"));
    assert(drifted.skills.sourceUpdated.includes("alpha/references/detail.md"));

    const updated = run("import", codex, dsh);
    assert.equal(updated.status, 0, updated.stderr);
    assert.equal(
      fs.readFileSync(path.join(dsh, "skills", "alpha", "references", "detail.md"), "utf8"),
      "detail-v2",
      "clean source updates should flow through",
    );
    assert.match(
      fs.readFileSync(path.join(dsh, "skills", "alpha", "SKILL.md"), "utf8"),
      /DSH note/u,
      "locally adapted files stay untouched",
    );

    const forced = run("import", codex, dsh, "--force");
    assert.equal(forced.status, 0, forced.stderr);
    assert.doesNotMatch(
      fs.readFileSync(path.join(dsh, "skills", "alpha", "SKILL.md"), "utf8"),
      /DSH note/u,
    );
    assert.equal(parse(run("check", codex, dsh)).skills.locallyAdapted.length, 0);
  } finally {
    fs.rmSync(holder, { recursive: true, force: true });
  }
});
