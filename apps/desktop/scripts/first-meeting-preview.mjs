// Real, empty-profile preview. No fabricated conversation or automatic model call.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatStore } from '../src/social-chat-store.mjs';
import { connect } from './electron-cdp.mjs';

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const rendererUrl =
  process.env.NOEMA_E2E_RENDERER_URL || 'http://localhost:5173';
try {
  const response = await fetch(rendererUrl, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch (error) {
  throw new Error(
    `Start the Noema Forge dev server before this preview (${rendererUrl}): ${error.message}`,
  );
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'Noema-first-meeting-'));
const userData = path.join(scratch, 'home');
const database = path.join(scratch, 'noema.sqlite3');
const sourceProfile = process.argv
  .find((arg) => arg.startsWith('--connection-from='))
  ?.slice('--connection-from='.length);
const sourceDatabase = process.argv
  .find((arg) => arg.startsWith('--database-from='))
  ?.slice('--database-from='.length);
fs.mkdirSync(userData, { recursive: true });
if (sourceProfile) {
  // Preserve OS encryption. Never decrypt, print, or copy conversation history.
  for (const relative of ['Local State', 'credentials/model-provider.key']) {
    const source = path.join(sourceProfile, relative);
    if (fs.existsSync(source)) {
      const destination = path.join(userData, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }
  }
}
if (sourceDatabase) {
  const source = path.resolve(sourceDatabase);
  if (!fs.existsSync(source))
    throw new Error(`Preview database does not exist: ${source}`);
  const sourceDb = new Database(source, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await sourceDb.backup(database);
  } finally {
    sourceDb.close();
  }
}
const db = new Database(database);
const root = new RootStore(db);
new SocialChatStore(db);
const model = process.argv
  .find((arg) => arg.startsWith('--model='))
  ?.slice('--model='.length);
if (model) root.setSelectedModel(model);
db.close();

const probe = http.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const require = createRequire(import.meta.url);
const environment = {
  ...process.env,
  NOEMA_E2E_DATABASE_PATH: database,
  NOEMA_E2E_RENDERER_URL: rendererUrl,
};
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.NOEMA_SMOKE_TEST;
const log = fs.openSync(path.join(scratch, 'client.log'), 'a');
const child = spawn(
  require('electron'),
  ['.', `--noema-e2e-user-data-dir=${userData}`, `--noema-e2e-port=${port}`],
  {
    cwd: appDirectory,
    env: environment,
    detached: true,
    windowsHide: false,
    stdio: ['ignore', log, log],
  },
);
child.unref();
fs.closeSync(log);
let target;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    target = (
      await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
    ).find((item) => item.type === 'page');
  } catch {}
  if (target) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!target)
  throw new Error(
    `Noema did not open. See ${path.join(scratch, 'client.log')}`,
  );
const cdp = await connect(target.webSocketDebuggerUrl);
await cdp.call('Runtime.evaluate', {
  expression: 'document.title = "Noema · 初次相遇（待评）"',
});
cdp.close();
if (sourceDatabase) {
  const rename = await connect(target.webSocketDebuggerUrl);
  await rename.call('Runtime.evaluate', {
    expression: `document.title = 'Noema · 计划实测（待评）'`,
  });
  rename.close();
}
const result = { pid: child.pid, port, scratch, database, userData };
fs.writeFileSync(
  path.join(scratch, 'preview.json'),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
