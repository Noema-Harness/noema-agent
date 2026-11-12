import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolveGitExecutable } from "./git-exec.mjs";

// Mirrors the user-level Codex capability injection into the DSH harness home
// (`~/.dsh`): the global AGENTS.md and the user skills under `~/.codex/skills`.
// `check` never mutates anything; `import` copies missing or cleanly updatable
// files and preserves files that were adapted for DSH on purpose.
//
// Project skills are a separate, committed mirror: `npm run skills:sync`.

function option(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
  return value;
}

const command = process.argv[2] ?? "check";
if (!["check", "import"].includes(command)) {
  throw new Error(
    "Usage: node scripts/harness-sync.mjs check|import [--codex-home <dir>] [--dsh-home <dir>] [--force] [--skip-tools]",
  );
}

const codexHome = path.resolve(
  option(process.argv, "codex-home", process.env.CODEX_HOME || path.join(os.homedir(), ".codex")),
);
const dshHome = path.resolve(
  option(process.argv, "dsh-home", process.env.DSH_HOME || path.join(os.homedir(), ".dsh")),
);
const force = process.argv.includes("--force");
const skipTools = process.argv.includes("--skip-tools");
const sourceSkills = path.join(codexHome, "skills");
const targetSkills = path.join(dshHome, "skills");
const manifestPath = path.join(dshHome, "harness-import.json");
const globalInstructions = path.join(dshHome, "AGENTS.md");
const codexInstructions = path.join(codexHome, "AGENTS.md");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function filesUnder(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (["__pycache__", ".git", "node_modules"].includes(entry.name)) continue;
      files.push(...filesUnder(absolute));
    } else if (entry.isFile() && !entry.name.endsWith(".pyc")) {
      files.push(absolute);
    }
  }
  return files;
}

// Same discovery shape as @deepseek-ai/dsh-skill-filesystem: a top-level
// `<name>/SKILL.md` bundle or a flat `<name>.md`; dotted entries such as the
// Codex built-in `.system` directory are intentionally left to Codex.
function collectSkills(directory) {
  const files = new Map();
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!fs.existsSync(path.join(absolute, "SKILL.md"))) continue;
      for (const file of filesUnder(absolute)) files.set(path.relative(directory, file), file);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.set(entry.name, absolute);
    }
  }
  return files;
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) return { version: 1, files: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return { ...parsed, version: 1, files: parsed.files ?? {} };
  } catch {
    return { version: 1, files: {} };
  }
}

function writeManifest(manifest) {
  fs.mkdirSync(dshHome, { recursive: true });
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({ version: 1, source: sourceSkills, importedAt: new Date().toISOString(), files: manifest.files }, null, 2)}\n`,
  );
}

function toolPath(name, candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  try {
    const locator = process.platform === "win32" ? "where.exe" : "which";
    const output = execFileSync(locator, [name], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    return (
      output
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find(Boolean) ?? null
    );
  } catch {
    return null;
  }
}

function toolInventory() {
  const localAppData = process.env.LOCALAPPDATA ?? "";
  return {
    git: toolPath("git", [resolveGitExecutable()]),
    node: toolPath("node", []),
    npm: toolPath(process.platform === "win32" ? "npm.cmd" : "npm", []),
    gh: toolPath("gh", [path.join(localAppData, "Programs", "GitHubCLI", "bin", "gh.exe")]),
    openspec: toolPath("openspec", [
      path.join(localAppData, "Programs", "openspec", "openspec.exe"),
    ]),
    python: toolPath("python", []),
    cargo: toolPath("cargo", [path.join(os.homedir(), ".cargo", "bin", "cargo.exe")]),
    markitdown: toolPath("markitdown", [
      path.join(localAppData, "NoemaTools", "dsh", "markitdown.cmd"),
    ]),
    dsh: toolPath("dsh", [path.join(localAppData, "NoemaTools", "dsh", "dsh.cmd")]),
  };
}

function importHarness() {
  const manifest = readManifest();
  const sourceFiles = collectSkills(sourceSkills);
  const copied = [];
  const kept = [];
  const adapted = [];
  fs.mkdirSync(targetSkills, { recursive: true });

  if (fs.existsSync(codexInstructions)) {
    const same =
      fs.existsSync(globalInstructions) &&
      fs.readFileSync(codexInstructions).equals(fs.readFileSync(globalInstructions));
    if (!same && (force || !fs.existsSync(globalInstructions))) {
      fs.copyFileSync(codexInstructions, globalInstructions);
      copied.push("AGENTS.md");
    } else if (!same) {
      kept.push("AGENTS.md");
    }
  }

  for (const [relative, absolute] of sourceFiles) {
    const destination = path.join(targetSkills, relative);
    const sourceHash = sha256(absolute);
    const display = relative.replaceAll("\\", "/");
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(absolute, destination);
      manifest.files[relative] = { sourceSha256: sourceHash, targetSha256: sha256(destination) };
      copied.push(display);
      continue;
    }
    const targetHash = sha256(destination);
    const entry = manifest.files[relative];
    if (force) {
      fs.copyFileSync(absolute, destination);
      manifest.files[relative] = { sourceSha256: sourceHash, targetSha256: sha256(destination) };
      copied.push(display);
    } else if (!entry) {
      kept.push(display);
    } else if (targetHash === entry.targetSha256) {
      if (sourceHash !== entry.sourceSha256) {
        fs.copyFileSync(absolute, destination);
        manifest.files[relative] = { sourceSha256: sourceHash, targetSha256: sha256(destination) };
        copied.push(display);
      } else {
        entry.sourceSha256 = sourceHash;
        entry.targetSha256 = targetHash;
      }
    } else {
      adapted.push(display);
    }
  }
  writeManifest(manifest);
  return { copied, kept, adapted };
}

function checkHarness() {
  const errors = [];
  const warnings = [];
  const manifest = readManifest();
  const sourceFiles = collectSkills(sourceSkills);
  const targetFiles = collectSkills(targetSkills);
  const missing = [];
  const sourceUpdated = [];
  const locallyAdapted = [];

  let instructions = { present: false, matchesCodex: false };
  if (!fs.existsSync(globalInstructions)) {
    errors.push(`Missing user-global instructions: ${globalInstructions}`);
  } else {
    instructions.present = true;
    instructions.matchesCodex =
      fs.existsSync(codexInstructions) &&
      fs.readFileSync(globalInstructions).equals(fs.readFileSync(codexInstructions));
  }

  for (const [relative, absolute] of sourceFiles) {
    const display = relative.replaceAll("\\", "/");
    const destination = path.join(targetSkills, relative);
    if (!fs.existsSync(destination)) {
      missing.push(display);
      errors.push(`Missing DSH user skill file: ${display}`);
      continue;
    }
    const entry = manifest.files[relative];
    if (!entry) {
      warnings.push(`Unmanaged DSH skill file (edited without an import record): ${display}`);
      continue;
    }
    if (sha256(absolute) !== entry.sourceSha256) sourceUpdated.push(display);
    if (sha256(destination) !== entry.targetSha256) locallyAdapted.push(display);
  }
  for (const [relative] of targetFiles) {
    if (!sourceFiles.has(relative))
      warnings.push(`DSH-only skill file: ${relative.replaceAll("\\", "/")}`);
  }

  const tools = skipTools ? {} : toolInventory();
  const requiredTools = ["git", "node", "npm", "gh", "openspec", "python"];
  const missingTools = skipTools ? [] : requiredTools.filter((name) => !tools[name]);
  for (const name of missingTools) errors.push(`Missing required CLI tool on PATH: ${name}`);
  const optionalMissing = skipTools
    ? []
    : Object.entries(tools)
        .filter(([name, value]) => !value && !requiredTools.includes(name))
        .map(([name]) => name);

  return {
    status: errors.length ? "issues" : "ok",
    codexHome,
    dshHome,
    instructions,
    skills: {
      sourceCount: new Set([...sourceFiles.keys()].map((key) => key.split(path.sep)[0])).size,
      missing,
      sourceUpdated,
      locallyAdapted,
    },
    tools,
    missingTools,
    optionalMissing,
    errors,
    warnings,
  };
}

try {
  if (!fs.existsSync(sourceSkills)) {
    throw new Error(`Codex skill root not found: ${sourceSkills}`);
  }
  const checkResult = command === "check" ? checkHarness() : null;
  const result = command === "import" ? importHarness() : checkResult;
  console.log(JSON.stringify({ command, ...result }, null, 2));
  if (checkResult?.errors.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
