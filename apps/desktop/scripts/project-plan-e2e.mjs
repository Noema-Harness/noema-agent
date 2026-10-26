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
    windowsHide: true,
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
  await wait(`document.querySelector('.project-list-item')`);
  await evaluate(
    `Array.from(document.querySelectorAll('.project-list-item')).find(n=>n.textContent.includes('共享计划界面验收样例')).click()`,
  );
  await wait(
    `document.querySelector('.project-plan') && document.querySelector('.project-plan').textContent.includes('建立计划')`,
  );
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.project-plan progress'))`),
    false,
  );
  await click('建立计划');
  await set('当前阶段', '可行性预研究');
  await set('本阶段目标', '判断摄影工作坊是否值得进入小规模试办。');
  for (let i = 0; i < 2; i++) {
    await click('＋ 添加交付项');
    const scope = `.project-plan-editor fieldset:nth-of-type(${i + 1})`;
    await set('交付成果', i ? '试办预算草案' : '需求与定价证据', scope);
    await set('负责人', ids[i], scope);
    await set(
      '完成条件',
      i
        ? '列出固定成本、单人成本和待核实项，依据已验收的研究结论。'
        : '提供原始来源、事实与推断，明确无法核实的部分。',
      scope,
    );
  }
  await evaluate(
    `document.querySelectorAll('.project-plan-editor fieldset')[1].querySelector('details').open=true; document.querySelectorAll('.project-plan-editor fieldset')[1].querySelector('input[type=checkbox]').click()`,
  );
  await set('本次调整的原因', '建立本轮研究范围；预算依赖研究结论。');
  await screenshot('editor.png');
  await click('保存计划');
  await wait(`document.querySelectorAll('.project-plan-list > li').length===2`);
  assert.equal(projects.plans.get(project.id).revision, 1);
  assert.equal(
    await evaluate(
      `document.querySelectorAll('.project-plan-list > li')[1].textContent.includes('前置尚未验收') && document.querySelectorAll('.project-plan-list > li')[1].querySelector('button').disabled`,
    ),
    true,
  );
  await click('开始', '.project-plan-list > li:first-child');
  await wait(
    `document.querySelector('.project-plan-list > li').textContent.includes('进行中')`,
  );
  await click('提交成果', '.project-plan-list > li:first-child');
  await set(
    '成果与核验依据',
    '样例资料：记录两份原始来源及访谈要点；场租尚未核实。',
    '.project-plan-action-form',
  );
  await click('保存', '.project-plan-action-form');
  await wait(
    `document.querySelector('.project-plan-list > li').textContent.includes('待验收')`,
  );
  assert.equal(projects.plans.get(project.id).progress.percentage, 0);
  await screenshot('submitted.png');
  await click('验收通过', '.project-plan-list > li:first-child');
  await wait(
    `document.querySelector('.project-plan-progress').textContent.includes('50%')`,
  );
  await click('开始', '.project-plan-list > li:nth-child(2)');
  await wait(
    `document.querySelectorAll('.project-plan-list > li')[1].textContent.includes('进行中')`,
  );
  await screenshot('accepted.png');
  // An editor opened before another actor writes must not overwrite that actor.
  await click('编辑计划');
  const current = projects.plans.get(project.id);
  projects.plans.updateItem({
    projectId: project.id,
    expectedRevision: current.revision,
    itemId: current.items[1].id,
    status: 'blocked',
    blocker: '样例：等待场租报价。',
    actorAgentId: ids[1],
    reason: '记录成本核实阻塞。',
  });
  await set('本次调整的原因', '验证陈旧版本保护。');
  await click('保存计划');
  await wait(
    `document.querySelector('[role=alert]')?.textContent.includes('计划已被更新')`,
  );
  assert.equal(projects.plans.get(project.id).revision, current.revision + 1);
  await click('载入最新计划');
  await click('取消编辑');
  await cdp.call('Page.reload');
  await wait(`document.querySelector('.project-list-item')`);
  await evaluate(
    `Array.from(document.querySelectorAll('.project-list-item')).find(n=>n.textContent.includes('共享计划界面验收样例')).click()`,
  );
  await wait(
    `document.querySelector('.project-plan')?.textContent.includes('等待场租报价')`,
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
  child.kill();
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
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timer);
    if (data.error) entry.reject(new Error(data.error.message));
    else entry.resolve(data.result);
  });
  socket.addEventListener('close', () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Client debugger disconnected'));
    }
    pending.clear();
  });
  return {
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const key = ++id;
        const timer = setTimeout(() => {
          pending.delete(key);
          reject(new Error(`Debugger timeout: ${method}`));
        }, 15000);
        pending.set(key, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: key, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}
