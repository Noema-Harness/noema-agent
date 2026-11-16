import fs from "node:fs";
import path from "node:path";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const ts = createRequire(path.join(repositoryRoot, "apps/desktop/package.json"))("typescript");
const layers = new Set(["main", "preload", "renderer", "shared"]);
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/u, "")));
const extensions = ["", ".ts", ".tsx", ".mjs", ".js", ".d.ts", ".css"];
// TypeScript migration ratchet: src/**/*.mjs may only shrink. Lower this after each converted batch.
const maxJavaScriptSources = 28;
// Core / port / host boundary (D-20261116-platform-layers, issue #156): core modules carry
// product logic and must not reach the platform directly. Platform facts arrive as parameters
// from the host layer (`main.ts`, `platform/`, `app/`); `execution/` is not core yet.
const coreDirectories = [
  "main/agents",
  "main/archive",
  "main/chat",
  "main/diagnostics",
  "main/mcp",
  "main/plugins",
  "main/projects",
  "main/providers",
  "main/runtime",
  "main/storage",
  "main/tools",
  "shared",
];

function isCoreModule(name) {
  return coreDirectories.some(
    (directory) => name === directory || name.startsWith(`${directory}/`),
  );
}

function isPlatformDependency(name) {
  return (
    name === "electron" || name.startsWith("electron/") || /^(?:node:)?child_process$/u.test(name)
  );
}

/** Comments and strings are not AST property accesses, so a header may name what it avoids. */
function readsProcessPlatform(source) {
  let found = false;
  function visit(node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process" &&
      node.name.text === "platform"
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function imports(source) {
  const entries = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const clause = node.importClause;
      const typeOnly = Boolean(
        node.isTypeOnly ||
        clause?.isTypeOnly ||
        (clause?.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          !clause.name &&
          clause.namedBindings.elements.length &&
          clause.namedBindings.elements.every((entry) => entry.isTypeOnly)),
      );
      entries.push({ name: node.moduleSpecifier.text, kind: typeOnly ? "type" : "static" });
    } else if (
      ts.isCallExpression(node) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
        entries.push({ name: node.arguments[0].text, kind: "dynamic" });
      else if (ts.isIdentifier(node.expression) && node.expression.text === "require")
        entries.push({ name: node.arguments[0].text, kind: "static" });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      entries.push({ name: node.argument.literal.text, kind: "type" });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return entries;
}

export function inspectSourceStructure(sourceRoot) {
  sourceRoot = path.resolve(sourceRoot);
  const relative = (file) => path.relative(sourceRoot, file).replaceAll("\\", "/");
  const errors = [];
  const sources = walk(sourceRoot).filter((file) => /\.(?:[cm]?[jt]s|[jt]sx)$/u.test(file));
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    // Marks src/**/*.ts as ESM for Node type stripping (tests import sources directly).
    if (entry.isFile() && entry.name === "package.json") continue;
    if (!entry.isDirectory() || !layers.has(entry.name))
      errors.push(`Unclassified source entry: ${entry.name}`);
  }
  for (const entry of ["main/main.ts", "preload/preload.ts", "renderer/renderer.tsx"]) {
    if (!fs.existsSync(path.join(sourceRoot, entry))) errors.push(`Missing entry: ${entry}`);
  }
  const graph = new Map(sources.map((file) => [file, []]));
  const sizes = [];
  for (const file of sources) {
    const text = fs.readFileSync(file, "utf8");
    const name = relative(file);
    const layer = name.split("/")[0];
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const core = isCoreModule(name);
    if (core && readsProcessPlatform(source))
      errors.push(`Core module branches on process.platform: ${name}`);
    sizes.push({ file: name, lines: text.split("\n").length });
    for (const dependency of imports(source)) {
      if (!dependency.name.startsWith(".")) {
        if (core && isPlatformDependency(dependency.name))
          errors.push(`Core module imports platform dependency: ${name} -> ${dependency.name}`);
        const platform =
          dependency.name.startsWith("node:") ||
          builtins.has(dependency.name) ||
          dependency.name === "electron" ||
          dependency.name.startsWith("electron/");
        if (dependency.kind !== "type" && platform && ["renderer", "shared"].includes(layer))
          errors.push(`Platform import in ${name}: ${dependency.name}`);
        continue;
      }
      const target = path.resolve(path.dirname(file), dependency.name);
      const resolved = [
        ...extensions.map((extension) => target + extension),
        ...extensions.slice(1).map((extension) => path.join(target, "index" + extension)),
      ].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (!resolved) {
        errors.push(`Unresolved import in ${name}: ${dependency.name}`);
        continue;
      }
      const destination = relative(resolved);
      const targetLayer = destination.split("/")[0];
      const external = destination.startsWith("../");
      if (external && dependency.kind !== "type") {
        const probe = /^(?:\.\.\/test-support\/electron\/(?:probes|scenarios)\.ts)$/u.test(
          destination,
        );
        if (!(name === "main/main.ts" && dependency.kind === "dynamic" && probe))
          errors.push(`Source depends on development material: ${name} -> ${destination}`);
      }
      if (destination.startsWith("main/legacy/") && !name.startsWith("main/legacy/"))
        errors.push(`Production imports quarantined runtime: ${name} -> ${destination}`);
      if (layer === "shared" && !external && targetLayer !== "shared")
        errors.push(`Shared code depends on ${targetLayer}: ${name} -> ${destination}`);
      if (
        dependency.kind !== "type" &&
        ((layer === "renderer" && !["renderer", "shared"].includes(targetLayer)) ||
          (layer === "main" && ["preload", "renderer"].includes(targetLayer)) ||
          (layer === "preload" && ["main", "renderer"].includes(targetLayer)))
      )
        errors.push(`Cross-process import: ${name} -> ${destination}`);
      if (dependency.kind !== "type" && graph.has(resolved)) graph.get(file).push(resolved);
    }
  }
  const visited = new Set();
  const active = [];
  function visit(file) {
    const index = active.indexOf(file);
    if (index !== -1) {
      errors.push(
        `Runtime import cycle: ${[...active.slice(index), file].map(relative).join(" -> ")}`,
      );
      return;
    }
    if (visited.has(file)) return;
    active.push(file);
    for (const dependency of graph.get(file)) visit(dependency);
    active.pop();
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file);
  const javaScriptSources = sources.filter((file) => /\.[cm]?js$/u.test(file)).length;
  if (javaScriptSources > maxJavaScriptSources)
    errors.push(
      `JavaScript sources grew to ${javaScriptSources} (max ${maxJavaScriptSources}); write new code in TypeScript.`,
    );
  return {
    sourceFiles: sources.length,
    javaScriptSources,
    largest: sizes.sort((a, b) => b.lines - a.lines).slice(0, 6),
    errors: [...new Set(errors)],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectSourceStructure(path.join(repositoryRoot, "apps/desktop/src"));
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
