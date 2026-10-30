import { createDevelopmentDirectory } from '../test-support/development-workspace.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
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
const rendererUrl =
  process.env.NOEMA_E2E_RENDERER_URL || 'http://localhost:5173';
let rendererResponse;
try {
  rendererResponse = await fetch(rendererUrl, {
    signal: AbortSignal.timeout(5000),
  });
} catch (error) {
  throw Error(
    `Start the Noema Forge dev server before this isolated-client run (${rendererUrl}): ${error.message}`,
  );
}
if (!rendererResponse.ok)
  throw Error(
    `Noema renderer returned HTTP ${rendererResponse.status} at ${rendererUrl}`,
  );
const scratch = createDevelopmentDirectory('Noema-r0-experience-');
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
const env = {
  ...process.env,
  NOEMA_E2E_DATABASE_PATH: database,
  NOEMA_E2E_RENDERER_URL: rendererUrl,
  NOEMA_E2E_SILENT_NOTIFICATIONS: '1',
};
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
        "Boolean(document.querySelector('#social-message-input')&&!document.querySelector('#social-message-input').disabled)",
      ),
    30000,
  );
  await capture('first-meeting.png');
  db = new Database(database, { readonly: true });
  await send(
    'sharing',
    '最近几家 AI 平台的价格变来变去，我总是发现得很晚。要是有个地方能把它们放在一起看就好了，不过做这个又像个大坑，我也不确定有没有人真需要。',
  );
  assert.equal(
    phases[0].projects.length,
    0,
    'sharing an idea must not itself start a project',
  );
  await send(
    'clarification',
    '我主要是想比较自己常用的 AI 服务 API 成本，也许之后能给小团队用。最好能看价格历史、按用量估算月成本。数据从哪里来我还没摸清，先不接触平台账号。我每周最多能拿两个晚上做这件事。',
  );
  assert.equal(
    phases[1].projects.length,
    0,
    'exploration and life constraints must not be converted to an execution order',
  );
  await send(
    'entrusted_research',
    '我想认真看看这个工具值不值得做，也希望把它推进成可以开始开发的方案。请先查清首批平台的价格数据能否可靠获取、各自的更新频率和许可边界，再定最小产品范围、价格历史与月成本估算的技术方案，以及后续维护成本和分阶段交付。资料不足的标为待核实；可以先按明确假设开展可逆工作，不要注册账号、联系平台或花钱。',
  );
  const projects = readProjects();
  assert.ok(
    projects.length > 0,
    'an explicitly entrusted multi-discipline product investigation should create a project',
  );
  assert.ok(
    projects.some(
      (project) =>
        project.plan.revision > 0 &&
        project.plan.phases.length > 0 &&
        project.plan.progress.total > 0,
    ),
    'the entrusted request should produce a structured plan with executable work packages',
  );
  const issues = projects
    .filter((project) => !project.plan.revision || !project.plan.phases.length)
    .map((project) => ({ projectId: project.id, status: project.status }));
  result = {
    outcome: issues.length ? 'needs_followup' : 'plan_created',
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
  result = {
    outcome: 'failed',
    error: error.message,
    phases,
    rendererUrl,
    diagnostics,
  };
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
    try {
      if (await predicate()) return;
    } catch (error) {
      if (
        !String(error?.message).includes(
          'Cannot find default execution context',
        )
      )
        throw error;
    }
    await delay(200);
  }
  throw Error(`Timed out waiting for the desktop workflow (${ms} ms)`);
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
      const document = plan ? JSON.parse(plan.items_json) : null;
      const phases = document?.phases ?? [];
      const items = phases.flatMap((phase) => phase.workItems ?? []);
      const active = items.filter(
        (item) => item.kind === 'work_package' && item.status !== 'canceled',
      );
      const accepted = (item) =>
        item.status === 'done' &&
        item.submittedByAgentId &&
        item.evidenceReview?.actorId &&
        item.evidenceReview.actorId !== item.submittedByAgentId;
      const done = active.filter(accepted).length;
      const acceptedPhases = phases.filter((phase) => {
        const workPackages = (phase.workItems ?? []).filter(
          (item) => item.kind === 'work_package' && item.status !== 'canceled',
        );
        return (
          phase.status === 'done' &&
          phase.evidence &&
          workPackages.length > 0 &&
          workPackages.every(accepted)
        );
      }).length;
      return {
        ...project,
        plan: {
          revision: plan?.revision ?? 0,
          stage: plan?.stage ?? '',
          objective: document?.objective ?? '',
          phases,
          items,
          progress: {
            done,
            total: active.length,
            percentage: active.length
              ? Math.round((done / active.length) * 100)
              : null,
            submitted: active.filter((item) => item.status === 'submitted')
              .length,
            acceptedPhases,
            totalPhases: phases.filter((phase) => phase.status !== 'canceled')
              .length,
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
    `(()=>{const input=document.querySelector('#social-message-input');if(!input)throw Error('Main conversation composer is missing');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await delay(100);
  await evaluate(
    "document.querySelector('#social-message-input').closest('form').requestSubmit()",
  );
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
