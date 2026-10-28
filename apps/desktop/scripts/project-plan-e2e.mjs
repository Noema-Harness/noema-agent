import assert from 'node:assert/strict';
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
import { SocialProjectStore } from '../src/social-project-store.mjs';
import { configureElectronRuntime } from './electron-runtime.mjs';
import { connect } from './electron-cdp.mjs';

// Isolated, visibly labeled UI fixture. No provider calls or real profile writes.
configureElectronRuntime();
const require = createRequire(import.meta.url);
const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'Noema-plan-ui-'));
const database = path.join(scratch, 'fixture.sqlite3');
const db = new Database(database);
new RootStore(db);
const social = new SocialChatStore(db);
const ids = ['资料研究员', '预算分析员'].map(
  (name) =>
    social.createAgent({
      name,
      headline: '界面验收样例成员',
      description: '仅用于隔离界面验收。',
      projectWork: false,
    }).members[0].id,
);
const projects = new SocialProjectStore({ db, socialChatStore: social });
const project = projects.createProject({
  title: '共享计划界面验收样例',
  brief:
    '合成场景：先核对需求证据，再依据已验收成果形成预算；不代表真实项目进展。',
  agentIds: ['noema', ...ids],
});
projects.plans.replace({
  projectId: project.id,
  expectedRevision: 0,
  reason: '展示项目结果、分阶段交付、阶段出口与后续工作。',
  plan: {
    objective: '核实摄影工作坊的实际需求，在约束内完成一次可复盘的小规模试办。',
    phases: [
      {
        id: 'research',
        title: '预研究与可行性判断',
        outcome: '得到有来源支撑的需求判断，明确预算和现场试办仍有哪些未知。',
        exitCriteria:
          '来源可复核；事实、推断和未核实事项分开；是否试办有清楚依据。',
        dependsOn: [],
        status: 'done',
        evidence: '两份原始来源、访谈记录和未核实事项已由 Noema 复核。',
        workItems: [
          {
            id: 'demand-evidence',
            title: '汇总需求证据与未核实项',
            ownerAgentId: ids[0],
            acceptance: '保留原始来源，区分事实与推断，并列出未核实项。',
            dependsOn: [],
            status: 'done',
            evidence: '两份原始来源及访谈记录已存档；场租仍需核价。',
            blocker: '',
          },
        ],
      },
      {
        id: 'pilot',
        title: '试办筹备与现场验证',
        outcome: '在小规模、明确预算上限内完成试办，并记录真实成本和反馈。',
        exitCriteria: '完成现场交付；费用有依据；参与者反馈与偏差进入复盘。',
        dependsOn: ['research'],
        status: 'pending',
        evidence: '',
        workItems: [
          {
            id: 'venue-budget',
            title: '核实场地报价并形成试办预算',
            ownerAgentId: ids[1],
            acceptance: '预算逐项对应需求证据，注明报价来源和仍待确认的费用。',
            dependsOn: [],
            status: 'blocked',
            evidence: '',
            blocker: '等待场地方提供含设备和清洁费的正式报价。',
          },
        ],
      },
      {
        id: 'review',
        title: '结果复盘与后续决策',
        outcome: '根据实际试办结果决定继续、调整或结束。',
        exitCriteria: '形成可复核的实际成本、反馈和建议；后续决定说明依据。',
        dependsOn: ['pilot'],
        status: 'pending',
        evidence: '',
        workItems: [],
      },
    ],
  },
});
// This is a real persisted source in the isolated fixture, never production data.
const sourceTime = new Date().toISOString();
db.prepare(`INSERT INTO social_messages
  (id,room_id,turn_id,role,agent_id,content,status,runtime,created_at,updated_at)
  VALUES ('plan-evidence-ui',?,'evidence-ui','assistant',?,'界面样例来源：场地报价包含清洁费。','complete','local',?,?)`).run(
  project.groupRoomId,
  ids[1],
  sourceTime,
  sourceTime,
);
projects.plans.updateItem({
  projectId: project.id,
  itemId: 'venue-budget',
  expectedRevision: projects.plans.get(project.id).revision,
  actorAgentId: ids[1],
  evidence: '报价来源保留在项目群记录。',
  evidenceSources: [{ kind: 'message', messageId: 'plan-evidence-ui' }],
  reason: '为界面回归加入可读取的持久来源。',
});
const probe = http.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const environment = { ...process.env, NOEMA_E2E_DATABASE_PATH: database };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.NOEMA_SMOKE_TEST;
const child = spawn(
  require('electron'),
  [
    '.',
    `--noema-e2e-user-data-dir=${path.join(scratch, 'home')}`,
    `--noema-e2e-port=${port}`,
  ],
  {
    cwd: appDirectory,
    env: environment,
    detached: process.env.NOEMA_E2E_KEEP_OPEN === '1',
    windowsHide: process.env.NOEMA_E2E_KEEP_OPEN !== '1',
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let diagnostic = '';
child.stderr.on('data', (data) => {
  diagnostic = (diagnostic + data).slice(-4000);
});
child.stdout.resume();
let cdp;
try {
  let target;
  for (let i = 0; i < 60; i++) {
    try {
      target = (
        await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      ).find((item) => item.type === 'page');
    } catch {}
    if (target) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!target) throw new Error(`No client debugger: ${diagnostic}`);
  cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 1264,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(
    `document.querySelector('.arrival-enter') || document.querySelector('.project-list-item')`,
  );
  if (await evaluate(`Boolean(document.querySelector('.arrival-enter'))`)) {
    await click('进入聊天', '.first-meeting');
    await wait(`!document.querySelector('.first-meeting')`);
  }
  await wait(
    `document.querySelector('.project-list-item') && !document.querySelector('.first-meeting')`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.project-list-item')).find(n=>n.textContent.includes('共享计划界面验收样例')).click()`,
  );
  await wait(
    `document.querySelector('.project-plan-phase-overview')?.textContent.includes('33%')`,
  );
  assert.equal(projects.plans.get(project.id).phaseProgress.percentage, 33);
  assert.equal(
    await evaluate(
      `document.querySelectorAll('.project-plan-phases > li').length`,
    ),
    3,
  );
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('.project-plan-phase')).find(n=>n.textContent.includes('结果复盘与后续决策')).textContent.includes('等待前置阶段')`,
    ),
    true,
  );
  await screenshot('three-phase-plan.png');
  await evaluate(
    `document.querySelector('[data-plan-item-id="venue-budget"] .project-plan-evidence').open=true`,
  );
  await click('核对来源版本', '[data-plan-item-id="venue-budget"]');
  await wait(
    `document.querySelector('[data-plan-item-id="venue-budget"]')?.textContent.includes('来源版本一致')`,
  );
  await evaluate(
    `document.querySelector('[data-plan-item-id="venue-budget"] .project-plan-evidence details').open=true; document.querySelector('[data-plan-item-id="venue-budget"] .project-plan-evidence').scrollIntoView({block:'center'})`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-plan-item-id="venue-budget"]')?.textContent.includes('场地报价包含清洁费')`,
    ),
    true,
  );
  const evidenceScreenshot = await cdp.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  fs.writeFileSync(
    path.join(scratch, 'source-inspection.png'),
    Buffer.from(evidenceScreenshot.data, 'base64'),
  );
  await click('继续工作', '[data-plan-item-id="venue-budget"]');
  await wait(
    `document.querySelector('[data-plan-item-id="venue-budget"]')?.textContent.includes('进行中')`,
  );
  await click('提交成果', '[data-plan-item-id="venue-budget"]');
  await set(
    '本次交付的结果与可核验依据',
    '合成验收记录：已取得正式报价并列出包含设备、清洁费的总价。',
    '.project-plan-action-form',
  );
  await click('保存', '.project-plan-action-form');
  await wait(
    `document.querySelector('[data-plan-item-id="venue-budget"]')?.textContent.includes('待验收')`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-plan-item-id="venue-budget"]')?.textContent.includes('提交者：用户')`,
    ),
    true,
  );
  await screenshot('submitted-evidence.png');
  await click('验收工作项', '[data-plan-item-id="venue-budget"]');
  await click('核验阶段出口', '[data-plan-phase-id="pilot"]');
  await set(
    '阶段成果与出口核验依据',
    '合成阶段验收：正式报价覆盖退出条件要求，试办预算有可复核来源。',
    '[data-plan-phase-id="pilot"]',
  );
  await click('验收阶段并解锁后续工作', '[data-plan-phase-id="pilot"]');
  await wait(
    `document.querySelector('.project-plan-phase-overview')?.textContent.includes('67%')`,
  );
  assert.equal(projects.plans.get(project.id).phaseProgress.percentage, 67);
  await screenshot('phase-gate-opened.png');
  // An editor opened before another actor writes must not overwrite that actor.
  await click('调整计划');
  const current = projects.plans.get(project.id);
  projects.plans.replace({
    projectId: project.id,
    expectedRevision: current.revision,
    reason: '另一个规划者补充了复盘阶段的验收细节。',
    plan: {
      objective: current.objective,
      phases: current.phases.map((phase) =>
        phase.id === 'review'
          ? {
              ...phase,
              outcome: `${phase.outcome} 后续仅在真实试办结果可复核时作出决策。`,
            }
          : phase,
      ),
    },
  });
  await set('本次计划调整的原因', '验证陈旧版本保护。');
  await click('保存计划修订');
  await wait(
    `document.querySelector('[role=alert]')?.textContent.includes('计划已被更新')`,
  );
  assert.equal(projects.plans.get(project.id).revision, current.revision + 1);
  await click('载入最新计划');
  await click('取消编辑');
  await evaluate('window.__noemaPlanBeforeReload = true');
  await cdp.call('Page.reload');
  await wait(
    `!window.__noemaPlanBeforeReload && Array.from(document.querySelectorAll('.project-list-item')).some(n=>n.textContent.includes('共享计划界面验收样例'))`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.project-list-item')).find(n=>n.textContent.includes('共享计划界面验收样例')).click()`,
  );
  await wait(
    `document.querySelector('.project-plan')?.textContent.includes('后续仅在真实试办结果可复核时作出决策')`,
  );
  await screenshot('persisted.png');
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 600,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await screenshot('narrow.png');
  assert.equal(
    await evaluate(`document.documentElement.scrollWidth <= innerWidth`),
    true,
  );
  if (process.env.NOEMA_E2E_KEEP_OPEN === '1') {
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: 1264,
      height: 950,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(`document.querySelector('.work-content')?.scrollTo(0, 0)`);
    await screenshot('review-open.png');
  }
  console.log(
    JSON.stringify({
      result: 'passed',
      projectId: project.id,
      revision: projects.plans.get(project.id).revision,
      screenshots: scratch,
      providerCalls: 0,
    }),
  );
} finally {
  cdp?.close();
  db.close();
  if (process.env.NOEMA_E2E_KEEP_OPEN === '1') {
    child.unref();
    child.stdout?.destroy();
    child.stderr?.destroy();
  } else {
    child.kill();
  }
}

async function evaluate(expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function wait(expression) {
  for (let i = 0; i < 50; i++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`UI condition timed out: ${expression}`);
}
async function click(text, scope = '.project-plan') {
  await evaluate(
    `(() => { const root=document.querySelector(${JSON.stringify(scope)}); const button=Array.from(root.querySelectorAll('button')).find(n=>n.textContent.trim()===${JSON.stringify(text)}); if(!button||button.disabled)throw Error('Button unavailable: '+${JSON.stringify(text)});button.scrollIntoView({block:'nearest'});button.click(); })()`,
  );
}
async function set(label, value, scope = '.project-plan-editor') {
  await evaluate(
    `(() => { const root=document.querySelector(${JSON.stringify(scope)}); const field=Array.from(root.querySelectorAll('label')).find(n=>n.firstChild?.textContent.trim()===${JSON.stringify(label)}); const input=field?.querySelector('input,textarea,select');if(!input)throw Error('Field unavailable: '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true})); })()`,
  );
}
async function screenshot(filename) {
  await evaluate(`document.querySelector('.work-content')?.scrollTo(0,0)`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const image = await cdp.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  fs.writeFileSync(
    path.join(scratch, filename),
    Buffer.from(image.data, 'base64'),
  );
}
