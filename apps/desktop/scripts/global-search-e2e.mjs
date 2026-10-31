import { createDevelopmentDirectory } from '../test-support/development-workspace.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { RootStore } from '../src/main/storage/root-store.mjs';
import { SocialChatStore } from '../src/main/chat/social-chat-store.mjs';
import { SocialProjectStore } from '../src/main/projects/social-project-store.mjs';
import { configureElectronRuntime } from './electron-runtime.mjs';
import { connect } from './electron-cdp.mjs';

// Synthetic local history only. Never connects a model or changes the real profile.
configureElectronRuntime();
const require = createRequire(import.meta.url);
const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const scratch = createDevelopmentDirectory('Noema-search-ui-');
const database = path.join(scratch, 'fixture.sqlite3');
const db = new Database(database);
new RootStore(db);
const social = new SocialChatStore(db);
const agent = social.createAgent({
  name: '资料研究员',
  headline: '搜索验收样例',
  description: '隔离的本地搜索场景。',
});
const agentId = agent.members[0].id;
const projects = new SocialProjectStore({ db, socialChatStore: social });
const project = projects.createProject({
  title: '摄影试办搜索样例',
  brief: '仅供本地搜索验收，不代表真实进展。',
  agentIds: ['noema', agentId],
});
const archived = projects.createProject({
  title: '归档预算样例',
  brief: '历史只读来源。',
  agentIds: ['noema', agentId],
});
function message(roomId, agentId, text) {
  const turn = social.beginTurn({ roomId, agentId, text, model: 'fixture' });
  social.appendAssistantDelta(turn.assistantMessageId, '样例回应。');
  social.completeReply(turn.assistantMessageId);
  return { roomId, id: turn.userMessageId };
}
const main = message('room-noema', 'noema', 'main-needle 只在主聊天中。');
const resident = message(
  agent.room.id,
  agentId,
  'resident-needle 在成员常驻私聊。',
);
const group = message(
  project.groupRoomId,
  agentId,
  'group-needle 这是共同讨论。',
);
const member = message(
  project.members.find((m) => m.agentId === agentId).sessionRoomId,
  agentId,
  'member-needle 专业成员的项目工作记录。',
);
const old = message(
  archived.groupRoomId,
  agentId,
  'archived-needle 归档项目中的原始记录。',
);
const oldMember = message(
  archived.members.find((m) => m.agentId === agentId).sessionRoomId,
  agentId,
  'oldmember-needle 归档成员的项目记录。',
);
const forwarded = social.appendForwardedMessage({
  sourceRoomId: resident.roomId,
  sourceIds: [resident.id],
  targetRoomId: 'room-noema',
});
projects.archiveProject(archived.id);
const probe = http.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const env = { ...process.env, NOEMA_E2E_DATABASE_PATH: database };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NOEMA_SMOKE_TEST;
const child = spawn(
  require('electron'),
  [
    '.',
    `--noema-e2e-user-data-dir=${path.join(scratch, 'home')}`,
    `--noema-e2e-port=${port}`,
  ],
  {
    cwd: appDirectory,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let diagnostics = '';
child.stderr.on('data', (data) => {
  diagnostics = (diagnostics + data).slice(-4000);
});
child.stdout.resume();
let cdp;
try {
  let target;
  for (let i = 0; i < 60; i++) {
    try {
      target = (
        await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      ).find((t) => t.type === 'page');
    } catch {}
    if (target) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!target) throw Error(`No debugger: ${diagnostics}`);
  cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 1264,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(`document.querySelector('[aria-label="搜索成员或项目"]')`);
  await evaluate(
    `window.__searchErrors=[];window.addEventListener('error',e=>window.__searchErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__searchErrors.push(String(e.reason)))`,
  );
  // Ctrl+K opens a separate dialog, and Escape restores the original focus.
  await evaluate(
    `document.querySelector('[aria-label="搜索成员或项目"]').focus()`,
  );
  await key('k', 'KeyK', 2);
  await wait(`document.activeElement?.matches('[cmdk-input]')`);
  assert.equal(
    await evaluate(`document.querySelectorAll('[role=dialog]').length`),
    1,
  );
  await key('Escape', 'Escape');
  await wait(
    `document.activeElement?.getAttribute('aria-label')==='搜索成员或项目'`,
  );
  // IME Escape does not dismiss the dialog.
  await open();
  await evaluate(
    `document.querySelector('[cmdk-input]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true}))`,
  );
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.global-search-dialog'))`),
    true,
  );
  await query('unfindable-xyz');
  await wait(
    `document.querySelector('.global-search-dialog [role=status]')?.textContent.includes('没有找到')`,
  );
  await key('Escape', 'Escape');
  // Old hits disappear immediately on query change; errors can retry without
  // leaving the dialog. A temporary table rename faults only the isolated DB.
  await open();
  await query('main-needle');
  await wait(
    `document.querySelector('[cmdk-item]')?.textContent.includes('main-needle')`,
  );
  await query('group-needle');
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('[cmdk-item]')).some(n=>n.textContent.includes('main-needle'))`,
    ),
    false,
  );
  await wait(
    `document.querySelector('[cmdk-item]')?.textContent.includes('group-needle')`,
  );
  db.exec('ALTER TABLE social_messages RENAME TO search_fault_fixture');
  await query('member-needle');
  await wait(`document.querySelector('.global-search-dialog [role=alert]')`);
  db.exec('ALTER TABLE search_fault_fixture RENAME TO social_messages');
  await evaluate(
    `document.querySelector('.global-search-error button').click()`,
  );
  await wait(
    `!document.querySelector('.global-search-error') && document.querySelector('[cmdk-item]')?.textContent.includes('member-needle')`,
  );
  await key('Escape', 'Escape');
  // Each result navigates to the original room and focuses the exact message.
  for (const [needle, source] of [
    ['main-needle', main],
    ['group-needle', group],
    ['member-needle', member],
    ['archived-needle', old],
    ['oldmember-needle', oldMember],
  ]) {
    await open();
    await query(needle);
    await wait(
      `document.querySelector('[cmdk-item]')?.textContent.includes(${JSON.stringify(needle)})`,
    );
    await key('ArrowDown', 'ArrowDown');
    await key('Enter', 'Enter');
    await wait(
      `!document.querySelector('.global-search-dialog') && document.activeElement?.dataset.messageId===${JSON.stringify(source.id)}`,
    );
    const visible = await evaluate(
      `(()=>{const r=document.activeElement.getBoundingClientRect();return r.height>0&&r.top<innerHeight&&r.bottom>0})()`,
    );
    assert.equal(visible, true, needle);
    if (source === old || source === oldMember) {
      assert.equal(projects.getProject(archived.id).status, 'archived');
      assert.equal(
        await evaluate(
          `Array.from(document.querySelectorAll('.group-form input,.message-composer textarea')).filter(n=>n.getClientRects().length).every(n=>n.disabled)`,
        ),
        true,
      );
    }
  }
  await open();
  await query('resident-needle');
  await wait(`document.querySelectorAll('[cmdk-item]').length===2`);
  await screenshot('global-desktop.png');
  await evaluate(
    `Array.from(document.querySelectorAll('[cmdk-item]')).find(n=>n.textContent.includes('转发内容')).click()`,
  );
  await wait(
    `document.activeElement?.dataset.messageId===${JSON.stringify(forwarded.messageId)}`,
  );
  // Current-room search excludes the original member DM; navigation filter never searches message bodies.
  await evaluate(
    `document.querySelector('[aria-label="查找当前对话"]').click()`,
  );
  await wait(`document.querySelector('[aria-label="搜索当前聊天"]')`);
  await set('[aria-label="搜索当前聊天"]', 'group-needle');
  await wait(
    `document.querySelector('.conversation-search-results')?.textContent.includes('没有找到')`,
  );
  await key('Escape', 'Escape');
  await set('[aria-label="搜索成员或项目"]', 'group-needle');
  assert.equal(
    await evaluate(
      `document.querySelectorAll('.project-list-item').length + Array.from(document.querySelectorAll('.room-list-item')).filter(n=>!n.textContent.includes('你的个人伙伴')).length`,
    ),
    0,
  );
  await set('[aria-label="搜索成员或项目"]', '');
  // Project-name hits read history without restoring; member-name hits open resident DM.
  await open();
  await query('归档预算');
  await wait(`document.querySelector('[cmdk-item]')`);
  await key('Enter', 'Enter');
  await wait(
    `document.querySelector('.work-title')?.textContent.includes('归档预算') && !document.querySelector('.global-search-dialog')`,
  );
  assert.equal(projects.getProject(archived.id).status, 'archived');
  await screenshot('archived-history.png');
  await open();
  await query('资料研究员');
  await wait(`document.querySelector('[cmdk-item]')`);
  await key('Enter', 'Enter');
  await wait(
    `!document.querySelector('.global-search-dialog') && document.querySelector('[data-room-id]')?.dataset.roomId===${JSON.stringify(agent.room.id)}`,
  );
  // Narrow-window dialog stays inside the viewport and accepts keyboard closure.
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 700,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await open();
  await query('needle');
  await wait(`document.querySelectorAll('[cmdk-item]').length>4`);
  assert.equal(
    await evaluate(`document.documentElement.scrollWidth<=innerWidth`),
    true,
  );
  await screenshot('global-narrow.png');
  await key('Escape', 'Escape');
  assert.deepEqual(await evaluate('window.__searchErrors'), []);
  console.log(
    JSON.stringify({
      result: 'passed',
      sources: 7,
      providerCalls: 0,
      screenshots: scratch,
    }),
  );
} catch (error) {
  if (cdp) {
    await screenshot('failure.png').catch(() => {});
    console.error(
      'UI:',
      await evaluate(`document.body.innerText.slice(-2400)`).catch(() => ''),
    );
  }
  throw error;
} finally {
  cdp?.close();
  db.close();
  child.kill();
}

async function evaluate(expression) {
  const r = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function wait(expression) {
  for (let i = 0; i < 60; i++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Timed out: ${expression}`);
}
async function key(key, code, modifiers = 0) {
  await cdp.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    modifiers,
  });
  await cdp.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    modifiers,
  });
}
async function open() {
  await key('k', 'KeyK', 2);
  await wait(`document.activeElement?.matches('[cmdk-input]')`);
}
async function set(selector, value) {
  await evaluate(
    `(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Field missing');Object.getOwnPropertyDescriptor(Object.getPrototypeOf(n),'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
}
async function query(value) {
  await set('[cmdk-input]', value);
}
async function screenshot(name) {
  const r = await cdp.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(scratch, name), Buffer.from(r.data, 'base64'));
}
