import { createDevelopmentDirectory } from '../test-support/development-workspace.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { RootStore } from '../src/main/storage/root-store.mjs';
import { SocialChatStore } from '../src/main/chat/social-chat-store.mjs';
import { SocialProjectStore } from '../src/main/projects/social-project-store.mjs';
import { configureElectronRuntime } from './electron-runtime.mjs';
import { connect } from './electron-cdp.mjs';

// Synthetic local history only. Never connects a model or changes the real profile.
configureElectronRuntime();
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
const main = message(
  'room-noema',
  'noema',
  'main-needle **main-needle** 只在主聊天中。',
);
const stale = message(
  'room-noema',
  'noema',
  'stale-source-needle 仅用于验证结果被删除后的恢复反馈。',
);
// Each fixture turn creates a user and assistant message; 102 turns plus the
// two seeded turns gives 208 messages, enough to verify the 200-message page.
for (let index = 0; index < 102; index++) {
  message('room-noema', 'noema', `分页填充 ${index}`);
}
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
const env = {
  ...process.env,
  NOEMA_E2E_DATABASE_PATH: database,
  NOEMA_E2E_SOCIAL_AGENT_WORKFLOW: '1',
  NOEMA_SMOKE_TEST: '1',
  NOEMA_SMOKE_USER_DATA_DIR: path.join(scratch, 'home'),
  NOEMA_DEV_REMOTE_DEBUGGING_PORT: String(port),
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.execPath, ['scripts/start.mjs'], {
  cwd: appDirectory,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
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
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  const frameTree = await cdp.call('Page.getFrameTree');
  console.log(
    JSON.stringify({
      targetUrl: target.url,
      frameUrl: frameTree.frameTree.frame.url,
    }),
  );
  const healthPath = path.join(scratch, 'home', 'renderer-health.jsonl');
  const mountDeadline = Date.now() + 60_000;
  while (Date.now() < mountDeadline) {
    if (
      fs.existsSync(healthPath) &&
      fs.readFileSync(healthPath, 'utf8').includes('"event":"renderer-mounted"')
    )
      break;
    if (child.exitCode !== null)
      throw Error(`Noema exited before renderer mount: ${diagnostics}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (
    !fs.existsSync(healthPath) ||
    !fs.readFileSync(healthPath, 'utf8').includes('"event":"renderer-mounted"')
  )
    throw Error(`Renderer did not mount: ${diagnostics}`);
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 1264,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(`document.querySelector('[aria-label="搜索成员或项目"]')`);
  await wait(
    `document.querySelector('[data-room-id="room-noema"] .history-page-control button')`,
  );
  const firstHistoryWindow = await evaluate(
    `document.querySelectorAll('[data-room-id="room-noema"] [data-message-id]').length`,
  );
  assert.ok(firstHistoryWindow > 0 && firstHistoryWindow <= 200);
  console.log('[global-search-e2e] initial history rendered');
  await evaluate(
    `document.querySelector('[data-room-id="room-noema"] .history-page-control button').click()`,
  );
  await wait(
    `document.querySelectorAll('[data-room-id="room-noema"] [data-message-id]').length>${firstHistoryWindow}`,
  );
  assert.ok(
    (await evaluate(
      `document.querySelectorAll('[data-room-id="room-noema"] [data-message-id]').length`,
    )) <= 400,
  );
  console.log('[global-search-e2e] history pagination rendered');
  await evaluate(
    `window.__searchErrors=[];window.addEventListener('error',e=>window.__searchErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__searchErrors.push(String(e.reason)))`,
  );
  // Ctrl+K opens a separate dialog, and Escape restores the original focus.
  await evaluate(
    `document.querySelector('[aria-label="搜索成员或项目"]').focus()`,
  );
  await key('k', 'KeyK', 2);
  console.log('[global-search-e2e] shortcut dispatched');
  await wait(`document.querySelector('.global-search-dialog')`);
  console.log('[global-search-e2e] search dialog rendered');
  await wait(`document.activeElement?.matches('[cmdk-input]')`);
  console.log('[global-search-e2e] search input focused');
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
  console.log('[global-search-e2e] search retry rendered');
  await key('Escape', 'Escape');
  // A result removed after search stays open with an actionable source error.
  await open();
  await query('stale-source-needle');
  await wait(
    `document.querySelector('[cmdk-item]')?.textContent.includes('stale-source-needle')`,
  );
  db.prepare('DELETE FROM social_messages WHERE id = ?').run(stale.id);
  await key('ArrowDown', 'ArrowDown');
  await key('Enter', 'Enter');
  await wait(
    `document.querySelector('.global-search-error')?.textContent.includes('这条消息已移除')`,
  );
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.global-search-dialog'))`),
    true,
  );
  await screenshot('global-stale-source.png');
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
      `!document.querySelector('.global-search-dialog') && document.activeElement?.dataset.messageId===${JSON.stringify(source.id)} && (()=>{const r=document.activeElement.getBoundingClientRect();return r.height>0&&r.top<innerHeight&&r.bottom>0})()`,
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
  console.log('[global-search-e2e] source navigation rendered');
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
    `document.querySelector('[aria-label="搜索当前聊天"]').click()`,
  );
  await wait(`document.querySelector('[aria-label="搜索当前聊天"]')`);
  await set('input[aria-label="搜索当前聊天"]', 'group-needle');
  await wait(
    `document.querySelector('.conversation-search-results')?.textContent.includes('没有找到')`,
  );
  await key('Escape', 'Escape');
  await evaluate(
    `document.querySelector('[aria-label="搜索当前聊天"]').click()`,
  );
  await wait(`document.querySelector('[aria-label="搜索当前聊天"]')`);
  await set('input[aria-label="搜索当前聊天"]', 'main-needle');
  await wait(
    `document.querySelector('.conversation-search-result')?.textContent.includes('main-needle')`,
  );
  await evaluate(
    `document.querySelector('.conversation-search-result').click()`,
  );
  await wait(
    `Array.from(document.querySelectorAll('[data-message-id]')).some(n=>n.dataset.messageId===${JSON.stringify(main.id)}&&n.getClientRects().length>0) && CSS.highlights.get('noema-current-chat-search')?.size===2`,
  );
  assert.deepEqual(
    await evaluate(
      `Array.from(CSS.highlights.get('noema-current-chat-search'),range=>range.toString())`,
    ),
    ['main-needle', 'main-needle'],
  );
  await screenshot('current-chat-search-hit.png');
  await wait(
    `!document.querySelector('.conversation-search-dialog') && CSS.highlights.get('noema-current-chat-search')?.size===2`,
  );
  console.log('[global-search-e2e] current-chat search rendered');
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 420,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(
    `document.querySelector('[aria-label="搜索当前聊天"]').click()`,
  );
  await wait(`document.querySelector('[aria-label="搜索当前聊天"]')`);
  await set('input[aria-label="搜索当前聊天"]', 'main-needle');
  await wait(
    `document.querySelector('.conversation-search-result')?.textContent.includes('main-needle')`,
  );
  const currentSearchNarrow = await evaluate(`(()=>{
    const dialog=document.querySelector('.conversation-search-dialog');
    const results=dialog?.querySelector('.conversation-search-results');
    const rect=dialog?.getBoundingClientRect();
    return {
      viewport:innerWidth,
      dialogInsideViewport:Boolean(rect&&rect.left>=0&&rect.right<=innerWidth),
      documentNoOverflow:document.documentElement.scrollWidth<=innerWidth,
      resultsInsideDialog:Boolean(dialog&&results&&results.scrollWidth<=results.clientWidth+1),
      hitVisible:Boolean(document.querySelector('.conversation-search-result')?.getClientRects().length),
    };
  })()`);
  assert.deepEqual(currentSearchNarrow, {
    viewport: 420,
    dialogInsideViewport: true,
    documentNoOverflow: true,
    resultsInsideDialog: true,
    hitVisible: true,
  });
  await screenshot('current-chat-search-narrow.png');
  await key('Escape', 'Escape');
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 1264,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(
    `document.querySelector('[aria-label="搜索当前聊天"]').click()`,
  );
  await wait(`document.querySelector('[aria-label="搜索当前聊天"]')`);
  await set('input[aria-label="搜索当前聊天"]', 'scoped-search-failure');
  db.exec('ALTER TABLE social_messages RENAME TO room_search_fault_fixture');
  await wait(
    `document.querySelector('.conversation-search-results [role=alert]')`,
  );
  db.exec('ALTER TABLE room_search_fault_fixture RENAME TO social_messages');
  await evaluate(
    `Array.from(document.querySelectorAll('.conversation-search-results [role=alert] button')).find(button=>button.textContent.includes('重试'))?.click()`,
  );
  await wait(
    `document.querySelector('.conversation-search-results')?.textContent.includes('没有找到') && !document.querySelector('.conversation-search-results [role=alert]')`,
  );
  console.log('[global-search-e2e] current-chat error recovery rendered');
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
    width: 420,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await open();
  await query('needle');
  await wait(`document.querySelectorAll('[cmdk-item]').length>4`);
  const narrowLayout = await evaluate(`(()=>{
    const dialog=document.querySelector('.global-search-dialog');
    const list=dialog?.querySelector('[cmdk-list]');
    const rect=dialog?.getBoundingClientRect();
    const sources=[...(dialog?.querySelectorAll('.global-search-source')??[])];
    return {
      viewport:innerWidth,
      dialogInsideViewport:Boolean(rect&&rect.left>=0&&rect.right<=innerWidth),
      documentNoOverflow:document.documentElement.scrollWidth<=innerWidth,
      resultListScrollable:Boolean(list&&list.scrollHeight>list.clientHeight),
      sourceRowsInsideDialog:Boolean(rect&&sources.every(source=>{
        const row=source.getBoundingClientRect();
        return row.left>=rect.left&&row.right<=rect.right;
      })),
    };
  })()`);
  assert.deepEqual(narrowLayout, {
    viewport: 420,
    dialogInsideViewport: true,
    documentNoOverflow: true,
    resultListScrollable: true,
    sourceRowsInsideDialog: true,
  });
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
  if (diagnostics) console.error('Electron:', diagnostics);
  throw error;
} finally {
  cdp?.close();
  db.close();
  child.kill();
}

async function evaluate(expression) {
  let r;
  try {
    r = await cdp.call(
      'Runtime.evaluate',
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
      },
      60_000,
    );
  } catch (error) {
    console.error(
      '[global-search-e2e] renderer evaluation stalled:',
      expression.replace(/\s+/gu, ' ').slice(0, 220),
    );
    throw error;
  }
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
  await evaluate(
    `(()=>{const n=document.querySelector('[cmdk-input]');n.setSelectionRange(n.value.length,n.value.length)})()`,
  );
}
async function screenshot(name) {
  const r = await cdp.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(scratch, name), Buffer.from(r.data, 'base64'));
}
