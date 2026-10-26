import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { configureElectronRuntime } from './electron-runtime.mjs';

// Explicit opt-in: real low-cost model, isolated product DB, no files or commands.
if (!process.versions.electron) {
  if (!process.argv.includes('--live'))
    throw Error('Use --live to permit real model calls.');
  configureElectronRuntime();
  const require = createRequire(import.meta.url);
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), 'Noema-collaboration-live-'),
  );
  const env = { ...process.env, NOEMA_COLLABORATION_LIVE_DIRECTORY: scratch };
  delete env.ELECTRON_RUN_AS_NODE;
  const bootstrap = path.join(scratch, 'bootstrap.cjs');
  const home = path.join(scratch, 'home');
  fs.mkdirSync(home);
  const localState = path.join(process.env.APPDATA, 'Noema', 'Local State');
  if (fs.existsSync(localState))
    fs.copyFileSync(localState, path.join(home, 'Local State'));
  fs.writeFileSync(
    bootstrap,
    `const {app}=require('electron');app.setName('Noema');app.setPath('userData',${JSON.stringify(home)});app.whenReady().then(()=>import(${JSON.stringify(new URL(import.meta.url).href)})).catch(error=>{require('node:fs').writeFileSync(${JSON.stringify(path.join(scratch, 'result.json'))},JSON.stringify({outcome:'failed',error:error.message}));app.exit(1);});`,
  );
  const child = spawn(require('electron'), [bootstrap], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => {
    diagnostics = (diagnostics + data).slice(-2000);
  });
  const timeout = setTimeout(() => child.kill(), 6 * 60_000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  clearTimeout(timeout);
  const resultPath = path.join(scratch, 'result.json');
  const result = fs.existsSync(resultPath)
    ? JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    : { outcome: 'missing_result', diagnostics };
  console.log(
    JSON.stringify(
      {
        outcome: result.outcome,
        error: result.error,
        model: result.model,
        calls: result.calls,
        progress: result.plan?.progress,
        failed: result.failed,
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter,
        directory: scratch,
      },
      null,
      2,
    ),
  );
  if (code !== 0 || result.outcome !== 'passed') process.exitCode = 1;
} else {
  const { app, safeStorage } = await import('electron');
  const scratch = process.env.NOEMA_COLLABORATION_LIVE_DIRECTORY;
  if (!scratch || !path.isAbsolute(scratch) || !fs.existsSync(scratch))
    throw Error('Isolated test directory required.');
  app.setPath('userData', path.join(scratch, 'home'));
  await app.whenReady();
  const { RootStore } = await import('../src/root-store.mjs');
  const { SocialChatStore } = await import('../src/social-chat-store.mjs');
  const { SocialProjectStore } =
    await import('../src/social-project-store.mjs');
  const { SocialChatService } = await import('../src/social-chat-service.mjs');
  const { EncryptedSecretStore } =
    await import('../src/encrypted-secret-store.mjs');
  const { OpenAICompatibleClient } =
    await import('../src/openai-compatible-client.mjs');
  let root,
    service,
    calls = 0,
    requestCharacters = 0;
  const steps = [];
  let result;
  try {
    const secrets = new EncryptedSecretStore({
      safeStorage,
      filePath: path.join(
        process.env.APPDATA,
        'Noema',
        'credentials',
        'model-provider.key',
      ),
    });
    const baseUrl = secrets.getBaseUrl();
    if (!baseUrl || new URL(baseUrl).hostname !== 'api.deepseek.com')
      throw Error(
        'This bounded live check requires the configured DeepSeek provider.',
      );
    const balance = async () => {
      const response = await fetch('https://api.deepseek.com/user/balance', {
        headers: { authorization: `Bearer ${secrets.get()}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw Error('Balance read failed: ' + response.status);
      const body = await response.json();
      return body.balance_infos?.map(({ currency, total_balance }) => ({
        currency,
        total_balance,
      }));
    };
    const before = await balance();
    if (!before?.some((row) => Number(row.total_balance) > 5))
      throw Error('Insufficient balance for the bounded test.');
    root = new RootStore(path.join(scratch, 'noema.sqlite3'));
    root.setSelectedModel('deepseek-flash');
    const store = new SocialChatStore(root.db);
    const projects = new SocialProjectStore({
      db: root.db,
      socialChatStore: store,
    });
    const a = store.createAgent({
      name: '方案研究员',
      headline: '方案与约束分析',
      description: '依据真实已知条件形成可执行的备选方案，清楚区分未知与事实。',
      projectWork: false,
    }).members[0].id;
    const b = store.createAgent({
      name: '预算分析员',
      headline: '成本与收支核算',
      description: '依据已核验条件核算收入、成本和盈亏，公开对接方案的依赖。',
      projectWork: false,
    }).members[0].id;
    const provider = new OpenAICompatibleClient({
      baseUrl,
      getApiKey: () => secrets.get(),
      fetchImpl: async (url, options) => {
        calls++;
        if (calls > 28) throw Error('Live test request limit reached.');
        requestCharacters += options.body?.length ?? 0;
        const request = JSON.parse(options.body);
        const last = request.messages.at(-1);
        steps.push({
          call: calls,
          lastRole: last.role,
          lastTool: last.name,
          lastContent: last.content?.slice(0, 700),
        });
        return fetch(url, options);
      },
    });
    service = new SocialChatService({
      store,
      projectStore: projects,
      provider,
      secretStore: secrets,
      getSelectedModel: () => 'deepseek-flash',
      getRootState: async () => ({
        providerConfigured: true,
        selectedModel: 'deepseek-flash',
      }),
      getProjectSessionContext: (roomId, agentId) =>
        projects.getProjectSessionContext(roomId, agentId),
    });
    const project = projects.createProject({
      title: '摄影试办 · 真实协作验收',
      brief:
        '隔离合成需求，真实模型执行：半天摄影入门活动，最多10人，每人收费200元，场地600元，材料每人30元，固定预算上限3000元。仅使用这些事实，不访问外网、不操作文件。研究员先提两种课程方案；预算员依据已验收方案核算盈亏。Noema 按明确完成条件审查，未知写清。',
      agentIds: ['noema', a, b],
    });
    service.collaboration.publish({
      projectId: project.id,
      senderAgentId: 'noema',
      text: `项目共同背景\n${project.brief}\n方案研究员负责课程取舍与未知项；预算分析员负责依赖方案的收支核算。成果和问题在群内公开；不需要轮流确认。`,
      eventKey: 'live-kickoff',
    });
    projects.plans.replace({
      projectId: project.id,
      expectedRevision: 0,
      reason: '验收共享计划的真实依赖执行，不测试自然输入是否应当组队。',
      plan: {
        stage: '试办可行性预研究',
        objective: '先形成课程方案，再核算收入成本，明确未知。',
        items: [
          {
            id: 'proposal',
            title: '两种课程安排与取舍',
            ownerAgentId: a,
            acceptance:
              '给出两种半天入门课程安排、适用人群和取舍，仅依赖已知条件，列明未知项。',
            dependsOn: [],
            status: 'pending',
          },
          {
            id: 'budget',
            title: '基于方案的盈亏核算',
            ownerAgentId: b,
            acceptance:
              '引用已验收方案，计算10人收入、总成本、利润和盈亏平衡人数，明确未计成本与假设。',
            dependsOn: ['proposal'],
            status: 'pending',
          },
        ],
      },
    });
    service.schedulePendingProjectGroupInboxes();
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (
        !service.active.size &&
        !service.projectGroupInboxDrains.size &&
        !service.projectReportDrain
      )
        break;
    }
    if (service.active.size) await service.shutdown();
    const plan = projects.plans.get(project.id);
    const messages = store.getRoomSnapshot(project.groupRoomId).messages;
    const failed = root.db
      .prepare(
        "SELECT id,status,error_message AS error FROM social_messages WHERE status IN ('failed','interrupted')",
      )
      .all();
    const unfinishedReports = root.db
      .prepare(
        "SELECT COUNT(*) AS n FROM social_project_reports WHERE status<>'completed'",
      )
      .get().n;
    const after = await balance();
    result = {
      outcome:
        plan.progress.percentage === 100 && !failed.length && !unfinishedReports
          ? 'passed'
          : 'incomplete',
      model: 'deepseek-flash',
      calls,
      requestCharacters,
      steps,
      balanceBefore: before,
      balanceAfter: after,
      projectId: project.id,
      plan,
      failed,
      publicMessages: messages.map(
        ({ id, role, agentId, content, status }) => ({
          id,
          role,
          agentId,
          content,
          status,
        }),
      ),
    };
  } catch (error) {
    result = { outcome: 'failed', error: error.message, calls };
  } finally {
    if (service) await service.shutdown();
    root?.db.close();
    fs.writeFileSync(
      path.join(scratch, 'result.json'),
      JSON.stringify(result, null, 2),
    );
    app.exit(result?.outcome === 'passed' ? 0 : 1);
  }
}
