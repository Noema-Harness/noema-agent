import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { RootStore } from '../src/root-store.mjs';
import { SocialChatStore } from '../src/social-chat-store.mjs';
import { SocialProjectStore } from '../src/social-project-store.mjs';
import { configureElectronRuntime } from './electron-runtime.mjs';

// A visual comparison only: fixture data stays outside the user's profile.
// Requires the dev build produced by `npm run dev`; never calls a remote model.
configureElectronRuntime();
const require = createRequire(import.meta.url);
const electron = require('electron');
const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const scratch = fs.mkdtempSync(path.join(tmpdir(), 'Noema-C-fidelity-'));
const database = path.join(scratch, 'fixture.sqlite3');
const db = new Database(database);
new RootStore(db);
const social = new SocialChatStore(db);
const people = [
  [
    '新闻观察者',
    '研究 · 来源核对',
    '寻找原始信息，核对变化与时间，分清事实和推断。',
  ],
  [
    '界面设计师',
    '交互 · 视觉',
    '把需求转成可审阅的界面，说明设计取舍并修正体验。',
  ],
  [
    '应用工程师',
    '实现 · 验证',
    '实现经过确认的方案，验证结果，维护项目的可运行状态。',
  ],
];
const ids = people.map(([name, headline, description], index) => {
  const created = social.createAgent({ name, headline, description });
  const date = `2026-10-22T0${9 - index}:00:00.000Z`;
  db.prepare(
    'UPDATE social_rooms SET created_at=?,updated_at=? WHERE id=?',
  ).run(date, date, created.room.id);
  db.prepare(
    'UPDATE social_messages SET created_at=?,updated_at=? WHERE room_id=?',
  ).run(date, date, created.room.id);
  return created.members[0].id;
});
const projects = new SocialProjectStore({ db, socialChatStore: social });
const project = projects.createProject({
  title: '价格追踪器',
  brief: '本轮先完成价格比较与变化记录的第一版，需要你判断阅读顺序和整体观感。',
  agentIds: ['noema', ...ids],
});
db.prepare("UPDATE social_projects SET status='awaiting_user' WHERE id=?").run(
  project.id,
);
const messages = [
  ['assistant', '上次说到想换工作，这几天有新的想法吗？', '09:18', 'initial'],
  [
    'user',
    '有一点。我发现不是不喜欢现在的工作，而是最近一直没有自己的时间。',
    '09:20',
    'one',
  ],
  [
    'assistant',
    '听起来，你想改变的首先是工作占据生活的方式。最近哪一段时间最像是被工作拿走了？',
    '09:21',
    'one',
  ],
  ['user', '下班后还在接着想项目，周末也在盯进度。', '09:22', 'two'],
  [
    'assistant',
    '那可以先从周末试起：项目继续推进，需要你判断时我再带着具体成果来找你。你不用守在窗口前。',
    '09:23',
    'two',
  ],
];
for (const [index, [role, content, time, turn]] of messages.entries()) {
  const created = new Date(`2026-10-23T${time}:00+08:00`).toISOString();
  db.prepare(
    `INSERT INTO social_messages (id,room_id,turn_id,role,agent_id,content,status,runtime,created_at,updated_at) VALUES (?,'room-noema',?,?,?,?, 'complete','local',?,?)`,
  ).run(
    `c-fixture-${index}`,
    turn,
    role,
    role === 'assistant' ? 'noema' : null,
    content,
    created,
    created,
  );
}
db.prepare('DELETE FROM social_messages WHERE room_id=?').run(
  project.groupRoomId,
);
for (const [index, [agentId, text, time]] of [
  [
    ids[0],
    '官方来源和计价单位已经核对。@应用工程师 数据表里保留原币种和生效日期，便于后续回查。',
    '13:10',
  ],
  [ids[2], '收到。单位字段已拆开，不把不同计价口径直接混排。', '13:18'],
  [
    ids[1],
    '@Noema 第一版界面已交付。视觉和阅读顺序需要用户确认，可以进入评审。',
    '14:25',
  ],
  [
    'noema',
    '@所有人 当前先等待界面评审，相关开发暂停。已有资料保留，收到用户反馈后继续。',
    '14:26',
  ],
].entries()) {
  const created = new Date(`2026-10-23T${time}:00+08:00`).toISOString();
  db.prepare(
    `INSERT INTO social_messages (id,room_id,turn_id,role,agent_id,content,status,runtime,created_at,updated_at) VALUES (?,?,?,'assistant',?,?,'complete','local',?,?)`,
  ).run(
    `group-fixture-${index}`,
    project.groupRoomId,
    `group-turn-${index}`,
    agentId,
    text,
    created,
    created,
  );
}
db.close();

const referenceScript = path.join(scratch, 'reference.cjs');
fs.writeFileSync(
  referenceScript,
  `const {app,BrowserWindow}=require('electron');const fs=require('node:fs');app.setPath('userData',${JSON.stringify(path.join(scratch, 'reference-home'))});app.whenReady().then(async()=>{try{const w=new BrowserWindow({width:1264,height:760,frame:false,show:false,webPreferences:{backgroundThrottling:false}});await w.loadFile(${JSON.stringify(path.join(appDirectory, 'design-studies/noema-continuity-structures.html'))});w.showInactive();w.webContents.debugger.attach('1.3');await w.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1264,height:760,deviceScaleFactor:1,mobile:false});await w.webContents.executeJavaScript(\`state.layout='c';state.scene='daily';state.workspace=null;state.name='Noema';render();document.querySelectorAll('.study-head,.study-controls,.study-note,.preview-exit').forEach(n=>n.style.display='none');document.querySelector('.stage').style.padding='0';const a=document.querySelector('.app');Object.assign(a.style,{width:'100vw',height:'100dvh',minHeight:'0',border:'0',borderRadius:'0',margin:'0',boxShadow:'none'});a.style.setProperty('--index-width','232px');a.classList.remove('index-closed');document.querySelector('.chat-scroll').scrollTop=0;\`);await new Promise(r=>setTimeout(r,350));fs.writeFileSync(${JSON.stringify(path.join(scratch, 'C-reference.png'))},Buffer.from((await w.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));fs.writeFileSync(${JSON.stringify(path.join(scratch, 'reference-metrics.json'))},JSON.stringify(await w.webContents.executeJavaScript(${JSON.stringify(metricsExpression())})));}catch(e){console.error(e);process.exitCode=1}finally{app.quit()}});`,
);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
await runReference();
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      data: [
        { id: 'auto:noema-free', available: true, execution_status: 'ready' },
      ],
    }),
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const providerPort = server.address().port;
const debugProbe = http.createServer();
await new Promise((resolve) => debugProbe.listen(0, '127.0.0.1', resolve));
const debugPort = debugProbe.address().port;
await new Promise((resolve) => debugProbe.close(resolve));
const child = spawn(
  electron,
  [
    '.',
    `--noema-e2e-user-data-dir=${path.join(scratch, 'product-home')}`,
    `--noema-e2e-port=${debugPort}`,
  ],
  {
    cwd: appDirectory,
    env: { ...environment, NOEMA_E2E_DATABASE_PATH: database },
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
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      target = (
        await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      ).find((item) => item.type === 'page');
      if (target) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!target) throw new Error(`Product debugger unavailable: ${diagnostic}`);
  cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 1264,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (
      await evaluate(
        `Boolean(window.noema && document.querySelector('.chat-body .message'))`,
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const fixtureState = await evaluate('window.noema.getSocialState()', true);
  if (!fixtureState.projects.some((item) => item.id === project.id))
    throw new Error('Refusing to use a renderer outside this isolated fixture');
  await evaluate(
    `window.noema.configureProvider({baseUrl:'http://127.0.0.1:${providerPort}/v1',apiKey:'isolated-visual-fixture'})`,
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  await evaluate(
    `document.querySelector('.chat-scroll').scrollTop=0;document.activeElement.blur();true`,
  );
  await cdp.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 0,
    y: 0,
  });
  await capture('C-production.png');
  const production = await evaluate(metricsExpression());
  fs.writeFileSync(
    path.join(scratch, 'production-metrics.json'),
    JSON.stringify(production, null, 2),
  );
  const reference = JSON.parse(
    fs.readFileSync(path.join(scratch, 'reference-metrics.json'), 'utf8'),
  );
  const differences = Object.fromEntries(
    Object.entries(reference).map(([name, value]) => [
      name,
      value && production[name]
        ? Object.fromEntries(
            ['x', 'y', 'width', 'height'].map((key) => [
              key,
              Number((production[name][key] - value[key]).toFixed(2)),
            ]),
          )
        : null,
    ]),
  );
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 600,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  await capture('C-production-narrow.png');
  const narrow = await evaluate(
    `({overflow:document.documentElement.scrollWidth>innerWidth,inputVisible:document.querySelector('textarea').getBoundingClientRect().right<=innerWidth})`,
  );
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 1264,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(`document.querySelector('.project-list-item').click()`);
  await settleUntil(`Boolean(document.querySelector('.workspace .work-tabs'))`);
  await capture('C-project-delivery.png');
  await evaluate(`document.querySelectorAll('.work-tabs button')[1].click()`);
  await settleUntil(
    `Boolean(document.querySelector('.workspace .discussion .group-msg'))`,
  );
  await capture('C-project-discussion.png');
  const groupRoute = await evaluate(
    `document.querySelector('.workspace [data-room-id]').dataset.roomId===${JSON.stringify(project.groupRoomId)}`,
  );
  await evaluate(`document.querySelectorAll('.work-tabs button')[2].click()`);
  await capture('C-project-members.png');
  await evaluate(
    `document.querySelectorAll('.workspace .member-row')[1].click()`,
  );
  await settleUntil(`Boolean(document.querySelector('.session-scroll'))`);
  const expectedSession = await evaluate(
    `window.noema.getSocialProjectSession(${JSON.stringify(project.id)},${JSON.stringify(ids[0])})`,
    true,
  );
  const memberRoute = await evaluate(
    `document.querySelector('.session-scroll').dataset.roomId===${JSON.stringify(expectedSession.room.room.id)}`,
  );
  await capture('C-member-session.png');
  await evaluate(`document.querySelector('[aria-label="成员资料"]').click()`);
  await settleUntil(`Boolean(document.querySelector('.profile-hero'))`);
  await capture('C-member-profile.png');
  await evaluate(`document.querySelector('.room-list-item').click()`);
  await settleUntil(
    `Boolean(document.querySelector('.chat-body .message.user'))`,
  );
  await evaluate(
    `[...document.querySelector('.message.user').querySelectorAll('button')].find(button=>button.textContent==='引用').click()`,
  );
  await settleUntil(`Boolean(document.querySelector('.draft-quote'))`);
  const quote = await evaluate(
    `document.querySelector('.draft-quote').textContent.includes(${JSON.stringify(messages[1][1])})`,
  );
  await capture('C-message-quote.png');
  await evaluate(`document.querySelector('[aria-label="取消引用"]').click()`);
  const archived = await evaluate(
    `window.noema.createSocialProject({title:'归档恢复检查',brief:'隔离视觉检查，不是用户项目',agentIds:${JSON.stringify(['noema', ids[0]])}})`,
    true,
  );
  const archiveBefore = await evaluate(
    `window.noema.getSocialProjectSession(${JSON.stringify(archived.id)},${JSON.stringify(ids[0])})`,
    true,
  );
  await evaluate(
    `window.noema.archiveSocialProject(${JSON.stringify(archived.id)})`,
    true,
  );
  await evaluate(
    `[...document.querySelectorAll('.bottom-link')].find(button=>button.textContent.includes('已归档项目')).click()`,
  );
  await settleUntil(
    `Boolean(document.querySelector('.workspace .project-link'))`,
  );
  await capture('C-archives.png');
  await evaluate(`document.querySelector('.workspace .project-link').click()`);
  await settleUntil(`Boolean(document.querySelector('.workspace .work-tabs'))`);
  const archiveAfter = await evaluate(
    `window.noema.getSocialProjectSession(${JSON.stringify(archived.id)},${JSON.stringify(ids[0])})`,
    true,
  );
  const restoredState = await evaluate(`window.noema.getSocialState()`, true);
  const archiveRestored =
    archiveBefore.room.room.id === archiveAfter.room.room.id &&
    restoredState.projects.find((item) => item.id === archived.id)?.status ===
      'active';
  const maximized = await evaluate(
    `window.noema.controlWindow('maximize')`,
    true,
  );
  const restored = await evaluate(
    `window.noema.controlWindow('maximize')`,
    true,
  );
  if (
    Object.values(differences).some(
      (region) =>
        !region || Object.values(region).some((delta) => Math.abs(delta) > 0.5),
    )
  )
    throw new Error('Primary layout differs from the C prototype');
  if (
    narrow.overflow ||
    !narrow.inputVisible ||
    !groupRoute ||
    !memberRoute ||
    !quote ||
    !archiveRestored ||
    !maximized ||
    restored
  )
    throw new Error('A reconstructed UI interaction failed');
  console.log(
    JSON.stringify(
      {
        scratch,
        fixtureOnly: true,
        geometricDifferences: differences,
        narrow,
        interactions: {
          groupRoute,
          memberRoute,
          quote,
          archiveRestored,
          windowControls: maximized === true && restored === false,
        },
      },
      null,
      2,
    ),
  );
} finally {
  if (cdp) {
    try {
      await evaluate(`window.noema.controlWindow('close')`, true);
    } catch {}
    cdp.close();
  }
  if (child.exitCode === null) child.kill();
  server.close();
}

async function evaluate(expression, awaitPromise = false) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function capture(name) {
  const result = await cdp.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  fs.writeFileSync(
    path.join(scratch, name),
    Buffer.from(result.data, 'base64'),
  );
}
function metricsExpression() {
  return `(()=>{const selectors={titlebar:'.window-head',navigation:'.index',header:'.pane-head',scroll:'.chat-scroll',transcript:'.chat-body',composer:'.composer',input:'.composer textarea',send:'.send'};return Object.fromEntries(Object.entries(selectors).map(([k,s])=>{const e=document.querySelector(s);if(!e)return[k,null];const r=e.getBoundingClientRect();return[k,{x:r.x,y:r.y,width:r.width,height:r.height}]}))})()`;
}
async function settleUntil(expression) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate(expression)) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`UI state not reached: ${expression}`);
}
async function runReference() {
  const p = spawn(electron, [referenceScript], {
    cwd: appDirectory,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let error = '';
  p.stderr.on('data', (data) => {
    error += data;
  });
  const code = await new Promise((resolve) => p.once('exit', resolve));
  if (code !== 0) throw new Error(error);
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
    const p = pending.get(data.id);
    if (p) {
      pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error.message));
      else p.resolve(data.result);
    }
  });
  return {
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const key = ++id;
        pending.set(key, { resolve, reject });
        socket.send(JSON.stringify({ id: key, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}
