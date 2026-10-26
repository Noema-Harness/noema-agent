import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { configureElectronRuntime } from './electron-runtime.mjs';
import { connect } from './electron-cdp.mjs';

// Real UI and provider, isolated conversation. No prompt mentions teams or tools.
configureElectronRuntime();
const require = createRequire(import.meta.url);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'Noema-r0-experience-'));
const home = path.join(scratch, 'home');
fs.mkdirSync(path.join(home, 'credentials'), { recursive: true });
for (const name of ['Local State', 'credentials/model-provider.key']) {
  const source = path.join(process.env.APPDATA, 'Noema', name);
  if (!fs.existsSync(source))
    throw Error('Configured local provider profile is required.');
  fs.copyFileSync(source, path.join(home, name));
}
const database = path.join(scratch, 'noema.sqlite3');
const seed = new RootStore(database);
seed.setSelectedModel(process.env.NOEMA_E2E_MODEL || 'deepseek-flash');
seed.db.close();
const probe = http.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const env = { ...process.env, NOEMA_E2E_DATABASE_PATH: database };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NOEMA_SMOKE_TEST;
const child = spawn(
  require('electron'),
  ['.', `--noema-e2e-user-data-dir=${home}`, `--noema-e2e-port=${port}`],
  { cwd: appDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let diagnostics = '';
child.stdout.resume();
child.stderr.on('data', (data) => {
  diagnostics = (diagnostics + data).slice(-3000);
});
const keepOpen =
  process.argv.includes('--keep-open') ||
  process.env.NOEMA_E2E_KEEP_OPEN === '1';
let db, cdp, result;
const phases = [];
try {
  let target;
  for (let i = 0; i < 60; i++) {
    try {
      target = (
        await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      ).find((tab) => tab.type === 'page');
    } catch {}
    if (target) break;
    await delay(200);
  }
  if (!target) throw Error('Client debugger unavailable: ' + diagnostics);
  cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 1264,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(
    async () =>
      evaluate(
        "Boolean(document.querySelector('.composer textarea')&&!document.querySelector('.composer textarea').disabled)",
      ),
    30000,
  );
  db = new Database(database, { readonly: true });
  await send(
    'sharing',
    '最近在想，周末也许可以办一场摄影小聚。只是一个念头，还没想好，也担心把休息时间填满。',
  );
  assert.equal(
    phases[0].projects.length,
    0,
    'sharing an idea must not itself start a project',
  );
  await send(
    'clarification',
    '更倾向于让六到十个零基础朋友轻松体验半天，而不是做正式培训。我自己有相机，可以借到一个场地，场地费六百元。每个人的材料大约三十元。我最多能拿三千元出来，还没决定是否要做，也不确定收费两百元是否合适；先一起分析怎样才不会挤掉我的休息。',
  );
  assert.equal(
    phases[1].projects.length,
    0,
    'exploration and life constraints must not be converted to an execution order',
  );
  await send(
    'entrusted_research',
    '这件事我确实想往前推进。请先研究小规模试办可行性，形成一页供我决定是否试办的方案：受众真正需要什么、半天怎样安排、招生与退款怎么处理，以及收支和未知成本。资料不够的明确标记待核实，可以先用现有信息推进；不要替我对外联系、报名、发布或支出。',
  );
  const projects = readProjects();
  const issues = projects
    .filter(
      (project) =>
        !project.plan.revision || project.plan.progress.percentage !== 100,
    )
    .map((project) => ({
      projectId: project.id,
      status: project.status,
      progress: project.plan.progress,
    }));
  result = {
    outcome: issues.length ? 'needs_followup' : 'observed',
    phases,
    projects,
    issues,
    review: 'User judgment of value and aesthetics remains pending.',
  };
  await capture('noema-main.png');
  for (const project of projects.slice(0, 1)) {
    await evaluate(
      `Array.from(document.querySelectorAll('.project-list-item')).find(n=>n.textContent.includes(${JSON.stringify(project.title)}))?.click()`,
    );
    await wait(
      async () => evaluate("Boolean(document.querySelector('.project-plan'))"),
      5000,
    );
    await capture('project-plan.png');
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='共同讨论')?.click()",
    );
    await wait(
      async () => evaluate("Boolean(document.querySelector('.discussion'))"),
      5000,
    );
    await capture('project-discussion.png');
    await evaluate(
      "Array.from(document.querySelectorAll('.room-list-item')).find(b=>b.textContent.includes('Noema'))?.click()",
    );
  }
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 600,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await capture('noema-narrow.png');
  await cdp.call('Emulation.clearDeviceMetricsOverride');
} catch (error) {
  result = { outcome: 'failed', error: error.message, phases };
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(scratch, 'result.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        outcome: result?.outcome,
        error: result?.error,
        phases: phases.map(({ name, replyStatus, projects }) => ({
          name,
          replyStatus,
          projects: projects.length,
        })),
        issues: result?.issues,
        directory: scratch,
        keptOpen: keepOpen,
        pid: child.pid,
      },
      null,
      2,
    ),
  );
  cdp?.close();
  db?.close();
  if (keepOpen) {
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
  } else child.kill();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function evaluate(expression) {
  const response = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails)
    throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function wait(predicate, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(200);
  }
  throw Error('Timed out waiting for the desktop workflow');
}
function readProjects() {
  return db
    .prepare('SELECT id,title,status FROM social_projects ORDER BY created_at')
    .all()
    .map((project) => {
      const plan = db
        .prepare(
          'SELECT revision,stage,objective,items_json FROM social_project_plan_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 1',
        )
        .get(project.id);
      const items = plan ? JSON.parse(plan.items_json) : [];
      const active = items.filter((item) => item.status !== 'canceled');
      const done = active.filter((item) => item.status === 'done').length;
      return {
        ...project,
        plan: {
          revision: plan?.revision ?? 0,
          stage: plan?.stage ?? '',
          objective: plan?.objective ?? '',
          items,
          progress: {
            done,
            total: active.length,
            percentage: active.length
              ? Math.round((done / active.length) * 100)
              : null,
          },
        },
      };
    });
}
async function send(name, text) {
  const before = db
    .prepare(
      "SELECT COUNT(*) AS n FROM social_messages WHERE room_id='room-noema' AND role='user'",
    )
    .get().n;
  await evaluate(
    `(()=>{const input=document.querySelector('.composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await delay(100);
  await evaluate("document.querySelector('.composer').requestSubmit()");
  await wait(
    async () =>
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM social_messages WHERE room_id='room-noema' AND role='user'",
        )
        .get().n > before,
    10000,
  );
  const user = db
    .prepare(
      "SELECT id,turn_id AS turnId FROM social_messages WHERE room_id='room-noema' AND role='user' ORDER BY seq DESC LIMIT 1",
    )
    .get();
  let idle = 0;
  await wait(async () => {
    const reply = db
      .prepare(
        "SELECT status FROM social_messages WHERE room_id='room-noema' AND turn_id=? AND role='assistant'",
      )
      .get(user.turnId);
    if (reply && ['failed', 'interrupted'].includes(reply.status))
      throw Error('Main reply did not complete; inspect the preserved client.');
    const running = db
      .prepare(
        "SELECT COUNT(*) AS n FROM social_messages WHERE status='streaming'",
      )
      .get().n;
    const queued = db
      .prepare(
        "SELECT COUNT(*) AS n FROM social_project_group_inbox i JOIN social_projects p ON p.id=i.project_id WHERE p.status='active'",
      )
      .get().n;
    const reports = db
      .prepare(
        "SELECT COUNT(*) AS n FROM social_project_reports r JOIN social_projects p ON p.id=r.project_id WHERE r.status IN ('pending','processing') AND p.status='active'",
      )
      .get().n;
    idle =
      reply?.status === 'complete' && !running && !queued && !reports
        ? idle + 1
        : 0;
    return idle >= 3;
  }, 7 * 60_000);
  const replies = db
    .prepare(
      "SELECT id,content,status FROM social_messages WHERE room_id='room-noema' AND role='assistant' ORDER BY seq",
    )
    .all();
  const reply = replies.find(
    (row) =>
      row.id ===
      db
        .prepare(
          "SELECT id FROM social_messages WHERE room_id='room-noema' AND turn_id=? AND role='assistant'",
        )
        .get(user.turnId)?.id,
  );
  assert.ok(reply?.content.trim());
  phases.push({
    name,
    input: text,
    userMessageId: user.id,
    replyStatus: reply.status,
    replies,
    projects: readProjects(),
  });
  await capture(`${name}.png`);
  fs.writeFileSync(
    path.join(scratch, 'phase-checkpoint.json'),
    JSON.stringify(phases, null, 2),
  );
}
async function capture(filename) {
  await delay(150);
  const screenshot = await cdp.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  fs.writeFileSync(
    path.join(scratch, filename),
    Buffer.from(screenshot.data, 'base64'),
  );
}
