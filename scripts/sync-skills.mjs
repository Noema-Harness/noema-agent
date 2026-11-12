import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// DSH discovers project skills under `.dsh/skills`; Codex authors them under
// `.codex/skills`. The repository keeps one authored source (Codex) and a
// committed DSH mirror, so both harnesses see the same project capabilities.
// Skills are small text bundles; a byte-for-byte mirror with a check mode is
// more predictable than symlinks on Windows and works in a clean checkout.
const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

function parseArguments(argv) {
  const options = { command: argv[0] ?? "check", source: ".codex/skills", target: ".dsh/skills" };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source" || argument === "--target") {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument.startsWith("--source=") || argument.startsWith("--target=")) {
      const [name, value] = argument.slice(2).split("=");
      options[name] = value;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!["check", "mirror"].includes(options.command)) {
    throw new Error(
      "Usage: node scripts/sync-skills.mjs check|mirror [--source <dir>] [--target <dir>]",
    );
  }
  options.source = path.resolve(repositoryRoot, options.source);
  options.target = path.resolve(repositoryRoot, options.target);
  return options;
}

function isSkippedName(name) {
  return name.startsWith(".");
}

function filesUnder(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Skill sources must be regular files, not links: ${absolute}`);
    }
    if (entry.isDirectory()) files.push(...filesUnder(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

// A skill is `<name>/SKILL.md` or a flat `<name>.md` directly under the root,
// matching @deepseek-ai/dsh-skill-filesystem discovery.
function collectSkills(directory) {
  const files = new Map();
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (isSkippedName(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Skill sources must be regular files, not links: ${absolute}`);
    }
    if (entry.isDirectory()) {
      const manifest = path.join(absolute, "SKILL.md");
      if (!fs.existsSync(manifest)) continue;
      for (const file of filesUnder(absolute)) files.set(path.relative(directory, file), file);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.set(entry.name, absolute);
    }
  }
  return files;
}

function sameContent(left, right) {
  const a = fs.readFileSync(left);
  const b = fs.readFileSync(right);
  return a.equals(b);
}

function removeEmptyDirectories(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    removeEmptyDirectories(child);
    if (fs.readdirSync(child).length === 0) fs.rmdirSync(child);
  }
}

function mirror({ source, target }) {
  const sourceFiles = collectSkills(source);
  const targetFiles = collectSkills(target);
  const copied = [];
  const removed = [];

  for (const [relative, absolute] of sourceFiles) {
    const destination = path.join(target, relative);
    if (fs.existsSync(destination) && sameContent(absolute, destination)) continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(absolute, destination);
    copied.push(relative.replaceAll("\\", "/"));
  }
  for (const [relative] of targetFiles) {
    if (sourceFiles.has(relative)) continue;
    fs.rmSync(path.join(target, relative), { force: true });
    removed.push(relative.replaceAll("\\", "/"));
  }
  removeEmptyDirectories(target);
  return { copied, removed };
}

function check({ source, target }) {
  const errors = [];
  const sourceFiles = collectSkills(source);
  const targetFiles = collectSkills(target);
  let pending = 0;
  let stale = 0;
  for (const [relative, absolute] of sourceFiles) {
    const display = relative.replaceAll("\\", "/");
    const destination = path.join(target, relative);
    if (!fs.existsSync(destination)) {
      errors.push(`Missing mirror file: ${display}`);
      pending += 1;
    } else if (!sameContent(absolute, destination)) {
      errors.push(`Mirror is stale: ${display}`);
      pending += 1;
    }
  }
  for (const [relative] of targetFiles) {
    if (!sourceFiles.has(relative)) {
      errors.push(`Unexpected mirror file: ${relative.replaceAll("\\", "/")}`);
      stale += 1;
    }
  }
  return { errors, pending, stale };
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === "mirror") {
    const result = mirror(options);
    console.log(
      JSON.stringify(
        {
          command: "mirror",
          source: path.relative(repositoryRoot, options.source).replaceAll("\\", "/"),
          target: path.relative(repositoryRoot, options.target).replaceAll("\\", "/"),
          copied: result.copied.length,
          removed: result.removed.length,
          errors: [],
        },
        null,
        2,
      ),
    );
  } else {
    const result = check(options);
    console.log(
      JSON.stringify(
        {
          command: "check",
          source: path.relative(repositoryRoot, options.source).replaceAll("\\", "/"),
          target: path.relative(repositoryRoot, options.target).replaceAll("\\", "/"),
          pending: result.pending,
          stale: result.stale,
          errors: result.errors,
        },
        null,
        2,
      ),
    );
    if (result.errors.length) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
