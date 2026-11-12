import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = path.resolve(fileURLToPath(new URL("./sync-skills.mjs", import.meta.url)));

function run(command, source, target) {
  return spawnSync(process.execPath, [script, command, "--source", source, "--target", target], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  });
}

test("skill mirror copies the Codex source, detects drift and removes stale entries", () => {
  const holder = fs.mkdtempSync(path.join(os.tmpdir(), "noema-skill-mirror-"));
  try {
    const source = path.join(holder, "codex-skills");
    const target = path.join(holder, "dsh-skills");
    fs.mkdirSync(path.join(source, "alpha", "references"), { recursive: true });
    fs.mkdirSync(path.join(source, ".system", "ignored"), { recursive: true });
    fs.writeFileSync(
      path.join(source, "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: probe\n---\n# Alpha\n",
    );
    fs.writeFileSync(path.join(source, "alpha", "references", "detail.md"), "detail");
    fs.writeFileSync(path.join(source, ".system", "ignored", "SKILL.md"), "ignored");
    fs.writeFileSync(path.join(source, "flat.md"), "# Flat\n");

    assert.notEqual(run("check", source, target).status, 0, "empty target must fail the check");
    assert.equal(run("mirror", source, target).status, 0);
    assert.equal(run("check", source, target).status, 0);
    assert.equal(
      fs.readFileSync(path.join(target, "alpha", "references", "detail.md"), "utf8"),
      "detail",
    );
    assert.equal(
      fs.existsSync(path.join(target, ".system")),
      false,
      "system skills stay Codex-only",
    );
    assert.equal(fs.existsSync(path.join(target, "flat.md")), true, "flat skills mirror as well");

    fs.writeFileSync(path.join(source, "alpha", "SKILL.md"), "changed");
    const stale = run("check", source, target);
    assert.notEqual(stale.status, 0);
    assert.match(stale.stdout, /Mirror is stale: alpha\/SKILL\.md/);

    fs.writeFileSync(path.join(target, "stale.md"), "stale");
    const unexpected = run("check", source, target);
    assert.match(unexpected.stdout, /Unexpected mirror file: stale\.md/);

    assert.equal(run("mirror", source, target).status, 0);
    assert.equal(run("check", source, target).status, 0);
    assert.equal(fs.existsSync(path.join(target, "stale.md")), false);
  } finally {
    fs.rmSync(holder, { recursive: true, force: true });
  }
});
