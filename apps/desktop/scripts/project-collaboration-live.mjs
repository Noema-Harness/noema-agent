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
  const projectIdIndex = process.argv.indexOf('--project-id');
  const existingProjectId =
    projectIdIndex >= 0 ? process.argv[projectIdIndex + 1] : null;
  configureElectronRuntime();
  const require = createRequire(import.meta.url);
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), 'Noema-collaboration-live-'),
  );
  const env = { ...process.env, NOEMA_COLLABORATION_LIVE_DIRECTORY: scratch };
  if (existingProjectId) {
    const Database = require('better-sqlite3');
    const source = new Database(
      path.join(process.env.APPDATA, 'Noema', 'noema.sqlite3'),
      { readonly: true },
    );
    await source.backup(path.join(scratch, 'noema.sqlite3'));
    source.close();
    env.NOEMA_COLLABORATION_LIVE_PROJECT_ID = existingProjectId;
  }
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
        projectId: result.projectId,
        plan: result.plan,
        failed: result.failed,
        steps: result.steps,
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
    const existingProjectId = process.env.NOEMA_COLLABORATION_LIVE_PROJECT_ID;
    let a, b, project;
    if (existingProjectId) {
      project = projects.getProject(existingProjectId);
      const members = project.members.filter(
        (member) => member.status === 'active' && !member.agentArchivedAt,
      );
      a = members.find(
        (member) => member.agentId === 'engineering-partner',
      )?.agentId;
      b = members.find(
        (member) =>
          member.agentId === 'agent-7dd140f1-48f7-4878-bfd9-1dab37a869ec',
      )?.agentId;
      if (!a || !b) throw Error('真实项目缺少预期的两个活跃成员。');
    } else {
      a = store.createAgent({
        name: '方案研究员',
        headline: '方案与约束分析',
        description:
          '依据真实已知条件形成可执行的备选方案，清楚区分未知与事实。',
        projectWork: false,
      }).members[0].id;
      b = store.createAgent({
        name: '预算分析员',
        headline: '成本与收支核算',
        description: '依据已核验条件核算收入、成本和盈亏，公开对接方案的依赖。',
        projectWork: false,
      }).members[0].id;
    }
    const provider = new OpenAICompatibleClient({
      baseUrl,
      getApiKey: () => secrets.get(),
      fetchImpl: async (url, options) => {
        calls++;
        if (calls > 48) throw Error('Live test request limit reached.');
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
    if (!existingProjectId) {
      project = projects.createProject({
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
    }
    const userTask = existingProjectId
      ? `只处理已存在项目 ${project.id}，不新建项目或成员，不改代码。先读取计划和活跃成员，再写入并回读。objective：让 Noema 计划支持复杂委托的分层工作、真实依赖、负责人和可核验证据。阶段一“源码与成熟模型审计”：两个并行工作项，工程搭档 ${a} 核实现有结构；计划语义设计 ${b} 对照 OpenProject/Linear 的层级和关系。阶段二“计划系统实现与闭环”，依赖阶段一：两项分别由上述成员负责计划数据/Agent读写契约、真实客户端界面/闭环验收。每项写清验收条件和证据；代码现状未知，不要声称已检查。不要追问，直接执行。`
      : `请在刚创建的摄影试办项目中实际建立共享计划，不要新建项目或成员，也不要操作文件。先读取计划，再按结果写入一阶段、两个工作项：课程方案由 ${a} 负责，预算核算由 ${b} 负责，预算项依赖课程方案项验收。计划只使用已知条件（半天、最多10人、每人200元、场地600元、材料每人30元），验收条件要能核对计算并明确未知。写入后读取确认。`;
    const planRequest = service.sendMessage({
      roomId: 'room-noema',
      agentId: 'noema',
      text: userTask,
    });
    await service.active.get('room-noema')?.done;
    const initialPlan = projects.plans.get(project.id);
    const [firstPhase, secondPhase] = initialPlan.phases;
    const firstPhaseItemIds = new Set(
      firstPhase?.workItems.map((item) => item.id) ?? [],
    );
    const existingPlanStructureValid =
      !existingProjectId ||
      (initialPlan.phases.length === 2 &&
        firstPhase.workItems.length === 2 &&
        firstPhase.workItems.every((item) => item.dependsOn.length === 0) &&
        secondPhase.workItems.length === 2 &&
        secondPhase.dependsOn.includes(firstPhase.id) &&
        secondPhase.workItems.every(
          (item) =>
            item.dependsOn.length > 0 &&
            item.dependsOn.every((id) => firstPhaseItemIds.has(id)),
        ));
    if (
      !planRequest.messageId ||
      initialPlan.revision < 1 ||
      (existingProjectId
        ? initialPlan.phases.length < 2 || initialPlan.items.length < 4
        : initialPlan.items.length !== 2) ||
      initialPlan.items.some((item) => ![a, b].includes(item.ownerAgentId)) ||
      !existingPlanStructureValid ||
      (!existingProjectId &&
        initialPlan.items.find((item) => item.ownerAgentId === b)?.dependsOn
          .length !== 1)
    ) {
      throw Error('真实模型未能为项目创建带合法负责人与依赖的共享计划。');
    }
    if (existingProjectId) {
      result = {
        outcome: 'passed',
        model: 'deepseek-flash',
        calls,
        balanceBefore: before,
        balanceAfter: await balance(),
        projectId: project.id,
        plan: initialPlan,
      };
    } else {
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
      const finalProject = projects.getProject(project.id);
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
          plan.progress.percentage === 100 &&
          !failed.length &&
          (plan.phases.every((phase) => phase.status === 'done') &&
          !unfinishedReports
            ? 'passed'
            : finalProject.status === 'awaiting_user' &&
                finalProject.pendingReview &&
                plan.phases.every(
                  (phase) =>
                    phase.status === 'done' ||
                    phase.state === 'awaiting_review',
                )
              ? 'awaiting_review'
              : 'incomplete'),
        model: 'deepseek-flash',
        calls,
        requestCharacters,
        steps,
        balanceBefore: before,
        balanceAfter: after,
        projectId: project.id,
        projectStatus: finalProject.status,
        pendingReview: finalProject.pendingReview,
        unfinishedReports,
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
    }
  } catch (error) {
    result = { outcome: 'failed', error: error.message, calls };
  } finally {
    if (service) await service.shutdown();
    root?.db.close();
    fs.writeFileSync(
      path.join(scratch, 'result.json'),
      JSON.stringify(result, null, 2),
    );
    app.exit(['passed', 'awaiting_review'].includes(result?.outcome) ? 0 : 1);
  }
}
