import test from "node:test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
test("workspace tooling previews, confines cleanup and detects stale document entry points", () => {
  const runs = path.join(repositoryRoot, ".work/runs");
  fs.mkdirSync(runs, { recursive: true });
  const holder = fs.mkdtempSync(path.join(runs, "workspace-tooling-"));
  try {
    const root = path.join(holder, "repository");
    const outside = path.join(holder, "outside");
    for (const p of [
      "scripts",
      ".codex",
      "docs",
      "openspec/specs/example",
      ".work/runs",
      ".work/scratch",
      ".work/archive",
    ])
      fs.mkdirSync(path.join(root, p), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "keep"), "outside");
    fs.copyFileSync(
      path.join(repositoryRoot, "scripts/workspace.mjs"),
      path.join(root, "scripts/workspace.mjs"),
    );
    const config = {
      currentDocuments: [{ path: "README.md" }],
      historyRoots: ["docs/history"],
      artifactRoot: ".work",
      specificationRoot: "openspec/specs",
      rootDirectories: [".git", ".codex", ".work", "scripts", "docs", "openspec"],
      cleanableArtifacts: [".work/runs", ".work/scratch"],
      generatedDirectories: [],
    };
    fs.writeFileSync(path.join(root, ".codex/workspace.json"), JSON.stringify(config));
    fs.writeFileSync(path.join(root, "README.md"), "# probe");
    fs.writeFileSync(path.join(root, "openspec/specs/example/spec.md"), "# example");
    fs.writeFileSync(path.join(root, ".work/runs", "remove"), "run");
    fs.writeFileSync(path.join(root, ".work/archive", "keep"), "history");
    execFileSync("git", ["init", "--quiet"], { cwd: root, windowsHide: true, timeout: 5000 });
    function run(...args) {
      return spawnSync(process.execPath, ["scripts/workspace.mjs", ...args], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
      });
    }
    assert.equal(run("check").status, 0);
    assert.equal(run("clean").status, 0);
    assert(fs.existsSync(path.join(root, ".work/runs/remove")));
    fs.rmdirSync(path.join(root, ".work/scratch"));
    fs.symlinkSync(
      outside,
      path.join(root, ".work/scratch"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const refused = run("clean", "--apply");
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /linked cleanup/);
    assert(fs.existsSync(path.join(root, ".work/runs/remove")));
    assert(fs.existsSync(path.join(outside, "keep")));
    fs.unlinkSync(path.join(root, ".work/scratch"));
    assert.equal(run("clean", "--apply").status, 0);
    assert(!fs.existsSync(path.join(root, ".work/runs")));
    assert(fs.existsSync(path.join(root, ".work/archive/keep")));
    fs.writeFileSync(path.join(root, "docs/stale.md"), "stale");
    fs.writeFileSync(path.join(root, "README.md"), "[broken](missing.md)");
    const invalid = run("check");
    assert.notEqual(invalid.status, 0);
    assert(invalid.stdout.includes("Unclassified document"));
    assert(invalid.stdout.includes("Broken link"));
    fs.rmSync(path.join(root, "openspec/specs/example/spec.md"));
    const missingBaseline = run("check");
    assert.notEqual(missingBaseline.status, 0);
    assert.match(missingBaseline.stdout, /No baseline OpenSpec specifications found/);
  } finally {
    fs.rmSync(holder, { recursive: true });
  }
});
