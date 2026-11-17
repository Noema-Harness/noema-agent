import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGit } from "./git-exec.mjs";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const config = JSON.parse(
  fs.readFileSync(path.join(root, "scripts", "workspace.config.json"), "utf8"),
);
const command = process.argv[2] ?? "check";
const apply = process.argv.includes("--apply");
const generated = process.argv.includes("--generated");
const inside = (candidate, parent) => {
  const relative = path.relative(parent, candidate);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
};
const resolve = (relative) => {
  const target = path.resolve(root, relative);
  if (!inside(target, root)) throw new Error(`Path escaped repository: ${relative}`);
  return target;
};
const within = (name, parent) => name === parent || name.startsWith(`${parent}/`);
function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...filesUnder(target));
    else files.push(target);
  }
  return files;
}

if (command === "check") {
  const errors = [];
  const current = new Set(config.currentDocuments);
  if (config.specificationRoot) {
    const specificationFiles = filesUnder(resolve(config.specificationRoot)).filter(
      (file) => path.basename(file) === "spec.md",
    );
    if (!specificationFiles.length)
      errors.push(`No baseline OpenSpec specifications found: ${config.specificationRoot}`);
  }
  for (const name of current) {
    if (!fs.existsSync(resolve(name))) errors.push(`Missing current document: ${name}`);
  }
  for (const file of filesUnder(resolve("docs"))) {
    const name = path.relative(root, file).replaceAll("\\", "/");
    if (
      file.endsWith(".md") &&
      !current.has(name) &&
      !(config.historyRoots ?? []).some((h) => within(name, h))
    ) {
      errors.push(
        `Unclassified document: ${name}. Maintain it explicitly or keep it in ${config.artifactRoot}.`,
      );
    }
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !config.rootDirectories.includes(entry.name))
      errors.push(`Unclassified root directory: ${entry.name}`);
    if (entry.isFile() && entry.name.endsWith(".md") && !current.has(entry.name))
      errors.push(`Unclassified root document: ${entry.name}`);
  }
  for (const name of current) {
    const file = resolve(name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/\]\(([^)]+)\)/gu)) {
      const link = match[1].replace(/^<|>$/gu, "").split("#")[0];
      if (!link || /^[a-z]+:|^\/\//iu.test(link)) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), link)))
        errors.push(`Broken link in ${name}: ${link}`);
    }
  }
  const tracked = runGit(["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0");
  for (const name of tracked) {
    if (within(name, config.artifactRoot))
      errors.push(`Process material tracked as source: ${name}`);
  }
  console.log(
    JSON.stringify(
      { currentDocuments: current.size, historicalRoots: config.historyRoots, errors },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
} else if (command === "clean") {
  const retention = config.artifactRetention ?? { days: 0, keep: [] };
  const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || retention.days || 0;
  const keep = [...(retention.keep ?? []), ...(generated ? config.generatedDirectories : [])];
  const stale = days
    ? fs
        .readdirSync(resolve(config.artifactRoot), { withFileTypes: true })
        .map((entry) => path.join(resolve(config.artifactRoot), entry.name))
        .filter((target) => {
          const relative = path.relative(root, target).replaceAll("\\", "/");
          if (keep.some((name) => within(relative, name))) return false;
          return Date.now() - fs.statSync(target).mtimeMs > days * 86_400_000;
        })
    : [];
  const names = [
    ...config.cleanableArtifacts.map(resolve),
    ...(generated ? config.generatedDirectories.map(resolve) : []),
    ...stale,
  ];
  const targets = [...new Set(names)].filter((target) => fs.existsSync(target));
  const bytes = (target) =>
    fs.statSync(target).isDirectory()
      ? filesUnder(target).reduce((sum, file) => sum + fs.statSync(file).size, 0)
      : fs.statSync(target).size;
  // Preflight every path before changing any target. Archives and dependencies
  // are not included; symlinked parents cannot redirect deletion elsewhere.
  for (const target of targets) {
    for (let cursor = target; cursor !== root; cursor = path.dirname(cursor)) {
      if (fs.lstatSync(cursor).isSymbolicLink())
        throw new Error(`Refusing linked cleanup path: ${cursor}`);
    }
    if (!inside(fs.realpathSync(target), fs.realpathSync(root)))
      throw new Error(`Cleanup target escaped repository: ${target}`);
  }
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "preview",
        retentionDays: days,
        targets: targets.map((target) => ({
          path: path.relative(root, target).replaceAll("\\", "/"),
          megabytes: Math.round(bytes(target) / 1e6),
        })),
      },
      null,
      2,
    ),
  );
  if (apply) for (const target of targets) fs.rmSync(target, { recursive: true, force: true });
} else {
  throw new Error(
    "Usage: node scripts/workspace.mjs check|clean [--generated] [--days N] [--apply]",
  );
}
