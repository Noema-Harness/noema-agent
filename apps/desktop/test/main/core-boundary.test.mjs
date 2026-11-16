// Core / port / host boundary (D-20261116-platform-layers).
// Core directories must not import Electron or child processes, and must not
// branch on `process.platform`; platform facts come from the host layer
// (`src/main/platform/`, `src/main/app/`, `main.ts`) through parameters.
// Interim home: the decision puts this rule in `npm run source:check`, which is
// a maintainer path. Delete this test once that check carries the rule.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src',
);

const CORE_DIRECTORIES = [
  'main/agents',
  'main/archive',
  'main/chat',
  'main/diagnostics',
  'main/mcp',
  'main/plugins',
  'main/projects',
  'main/providers',
  'main/runtime',
  'main/storage',
  'main/tools',
  'shared',
];

const SOURCE = /\.(?:ts|tsx|mts|mjs|js)$/u;
const PLATFORM_MODULE = String.raw`(?:electron|(?:node:)?child_process)`;
const FORBIDDEN = [
  {
    rule: 'imports a platform module',
    pattern: new RegExp(
      String.raw`(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]${PLATFORM_MODULE}['"]`,
      'u',
    ),
  },
  { rule: 'compares process.platform', pattern: /\bprocess\.platform\b/u },
];

function sourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return SOURCE.test(entry.name) && !entry.name.endsWith('.d.ts')
      ? [full]
      : [];
  });
}

/** Drops comments so a module header may name what it avoids. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

function coreBoundaryViolations(root = SRC) {
  return CORE_DIRECTORIES.flatMap((dir) =>
    sourceFiles(path.join(root, dir)).flatMap((file) => {
      const body = code(fs.readFileSync(file, 'utf8'));
      return FORBIDDEN.filter(({ pattern }) => pattern.test(body)).map(
        ({ rule }) => `${path.relative(root, file)} ${rule}`,
      );
    }),
  );
}

test('core directories stay free of Electron, child processes and platform checks', () => {
  assert.deepEqual(coreBoundaryViolations(), []);
});

test('the boundary scan catches each forbidden form', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const chat = path.join(root, 'main', 'chat');
  fs.mkdirSync(chat, { recursive: true });
  const cases = {
    'a.ts': "import { app } from 'electron';",
    'b.mjs': "import { spawn } from 'node:child_process';",
    'c.ts': "type T = import('electron').BrowserWindow;",
    'd.ts': "const isWin = process.platform === 'win32';",
    'e.ts': '/** never read process.platform here */\nexport const ok = 1;',
  };
  for (const [name, text] of Object.entries(cases))
    fs.writeFileSync(path.join(chat, name), text);
  assert.deepEqual(coreBoundaryViolations(root).sort(), [
    path.join('main', 'chat', 'a.ts') + ' imports a platform module',
    path.join('main', 'chat', 'b.mjs') + ' imports a platform module',
    path.join('main', 'chat', 'c.ts') + ' imports a platform module',
    path.join('main', 'chat', 'd.ts') + ' compares process.platform',
  ]);
});
