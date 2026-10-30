import { createDevelopmentDirectory } from '../test-support/development-workspace.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { configureElectronRuntime } from './electron-runtime.mjs';

// Real low-cost model in an isolated DB. Optional --workspace-copy uses a committed
// source snapshot and the product executor; never points it at the source checkout.
if (!process.versions.electron) {
  if (!process.argv.includes('--live'))
    throw Error('Use --live to permit real model calls.');
  const projectIdIndex = process.argv.indexOf('--project-id');
  const existingProjectId =
    projectIdIndex >= 0 ? process.argv[projectIdIndex + 1] : null;
  const projectGroupRequest = process.argv.includes('--project-group');
  if (projectGroupRequest && !existingProjectId)
    throw Error('--project-group requires --project-id.');
  configureElectronRuntime();
  const require = createRequire(import.meta.url);
  const resumeIndex = process.argv.indexOf('--resume-directory');
  const resumeDirectory =
    resumeIndex >= 0 ? process.argv[resumeIndex + 1] : null;
  if (resumeIndex >= 0 && (!resumeDirectory || existingProjectId))
    throw Error(
      'Resume requires a directory and cannot clone a production project.',
    );
  const scratch = resumeDirectory
    ? path.resolve(resumeDirectory)
    : createDevelopmentDirectory('Noema-collaboration-live-');
  if (
    resumeDirectory &&
    (!path.basename(scratch).startsWith('Noema-collaboration-live-') ||
      !fs.existsSync(path.join(scratch, 'result.json')))
  )
    throw Error('Resume requires an existing isolated observation directory.');
  const env = { ...process.env, NOEMA_COLLABORATION_LIVE_DIRECTORY: scratch };
  if (process.argv.includes('--natural') || resumeDirectory)
    env.NOEMA_COLLABORATION_LIVE_NATURAL = '1';
  if (projectGroupRequest) env.NOEMA_COLLABORATION_LIVE_PROJECT_GROUP = '1';
  const messageIndex = process.argv.indexOf('--message-file');
  if (messageIndex >= 0) {
    if (!env.NOEMA_COLLABORATION_LIVE_NATURAL)
      throw Error('Custom messages require --natural or --resume-directory.');
    if (!process.argv[messageIndex + 1]) throw Error('Message file required.');
    env.NOEMA_COLLABORATION_LIVE_MESSAGE = fs
      .readFileSync(process.argv[messageIndex + 1], 'utf8')
      .trim();
    if (!env.NOEMA_COLLABORATION_LIVE_MESSAGE)
      throw Error('Message cannot be empty.');
  }
  if (resumeDirectory && !env.NOEMA_COLLABORATION_LIVE_MESSAGE)
    throw Error('Resume requires a new natural-language message.');
  const requestLimitArgument = process.argv.find((arg) =>
    arg.startsWith('--max-requests='),
  );
  if (requestLimitArgument) {
    const requestLimit = Number(
      requestLimitArgument.slice('--max-requests='.length),
    );
    if (
      !Number.isInteger(requestLimit) ||
      requestLimit < 1 ||
      requestLimit > 64
    )
      throw Error('--max-requests must be an integer between 1 and 64.');
    env.NOEMA_COLLABORATION_LIVE_MAX_REQUESTS = String(requestLimit);
  }
  const characterLimitArgument = process.argv.find((arg) =>
    arg.startsWith('--max-characters='),
  );
  if (characterLimitArgument) {
    const characterLimit = Number(
      characterLimitArgument.slice('--max-characters='.length),
    );
    if (
      !Number.isInteger(characterLimit) ||
      characterLimit < 300_000 ||
      characterLimit > 600_000
    )
      throw Error('--max-characters must be an integer from 300000 to 600000.');
    env.NOEMA_COLLABORATION_LIVE_MAX_CHARACTERS = String(characterLimit);
  }
  const workspaceIndex = process.argv.indexOf('--workspace-copy');
  const workspace = path.join(scratch, 'workspace');
  if (workspaceIndex >= 0) {
    if (
      !env.NOEMA_COLLABORATION_LIVE_NATURAL ||
      !process.argv[workspaceIndex + 1]
    )
      throw Error(
        'Workspace copies require natural mode and a Git checkout path.',
      );
    const source = path.resolve(process.argv[workspaceIndex + 1]);
    const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const archive = execFileSync(
      'git',
      ['-C', source, 'archive', '--format=tar', 'HEAD'],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
    );
    fs.mkdirSync(workspace);
    execFileSync('tar', ['-xf', '-', '-C', workspace], {
      input: archive,
      windowsHide: true,
    });
    fs.writeFileSync(
      path.join(scratch, 'workspace-source.json'),
      JSON.stringify({ commit }),
    );
  }
  if (
    fs.existsSync(path.join(scratch, 'workspace-source.json')) &&
    fs.existsSync(workspace)
  )
    env.NOEMA_COLLABORATION_LIVE_WORKSPACE = workspace;
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
  fs.mkdirSync(home, { recursive: true });
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
        latestReply: result.latestReply
          ? {
              status: result.latestReply.status,
              errorCode: result.latestReply.errorCode,
              errorMessage: result.latestReply.errorMessage,
            }
          : null,
        calls: result.calls,
        requestLimit: result.requestLimit,
        characterLimit: result.characterLimit,
        stopReason: result.stopReason,
        projectCount: result.projects?.length,
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
  if (
    code !== 0 ||
    !['passed', 'awaiting_review', 'observed'].includes(result.outcome) ||
    (result.outcome === 'observed' && result.latestReply?.status !== 'complete')
  )
    process.exitCode = 1;
} else {
  const { app, net, safeStorage, session } = await import('electron');
  const scratch = process.env.NOEMA_COLLABORATION_LIVE_DIRECTORY;
  if (!scratch || !path.isAbsolute(scratch) || !fs.existsSync(scratch))
    throw Error('Isolated test directory required.');
  app.setPath('userData', path.join(scratch, 'home'));
  await app.whenReady();
  // Electron's Chromium network stack does not reliably inherit shell proxy
  // variables on Windows. Pin the isolated harness to the explicitly selected
  // route so stale Windows proxy values cannot silently redirect live checks.
  const proxyAddress = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxyAddress) {
    const proxy = new URL(proxyAddress);
    const endpoint = `${proxy.protocol}//${proxy.host}`;
    await session.defaultSession.setProxy({
      proxyRules: `http=${endpoint};https=${endpoint}`,
    });
  } else await session.defaultSession.setProxy({ mode: 'direct' });
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
    work,
    service,
    calls = 0,
    requestCharacters = 0;
  let requestBudgetExceeded = false;
  let requestBudgetStopReason = null;
  let characterBudgetRejected = 0;
  const requestLimit = Number(
    process.env.NOEMA_COLLABORATION_LIVE_MAX_REQUESTS ||
      (process.env.NOEMA_COLLABORATION_LIVE_NATURAL === '1' ? 16 : 48),
  );
  const characterLimit = Number(
    process.env.NOEMA_COLLABORATION_LIVE_MAX_CHARACTERS || 300_000,
  );
  if (
    !Number.isInteger(characterLimit) ||
    characterLimit < 300_000 ||
    characterLimit > 600_000
  )
    throw Error('Natural observation character limit must be 300000–600000.');
  const steps = [];
  const projectWorkDispatchErrors = [];
  const pendingResponseDiagnostics = [];
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
      let body;
      try {
        const response = await net.fetch(
          'https://api.deepseek.com/user/balance',
          {
            headers: { authorization: `Bearer ${secrets.get()}` },
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!response.ok)
          throw Error('Balance read failed: ' + response.status);
        body = await response.json();
      } catch (error) {
        if (!String(error?.message).includes('ERR_CONNECTION_CLOSED'))
          throw error;
        const authorization = `Authorization: Bearer ${secrets.get()}`;
        const quote = (value) => JSON.stringify(value);
        const config = [
          `url = ${quote('https://api.deepseek.com/user/balance')}`,
          `header = ${quote(authorization)}`,
          `header = ${quote('Accept: application/json')}`,
          proxyAddress ? `proxy = ${quote(proxyAddress)}` : 'noproxy = "*"',
        ].join('\n');
        let output;
        try {
          output = execFileSync(
            'curl.exe',
            [
              '--silent',
              '--show-error',
              '--max-time',
              '15',
              '--config',
              '-',
              '--write-out',
              '\nNOEMA_HTTP_STATUS:%{http_code}',
            ],
            { input: config, encoding: 'utf8', windowsHide: true },
          );
        } catch (error) {
          const reason =
            typeof error?.code === 'string'
              ? error.code
              : Number.isInteger(error?.status)
                ? `curl_exit_${error.status}`
                : 'unknown_transport_error';
          throw Error(
            `DeepSeek balance preflight failed on both transports (${reason}).`,
          );
        }
        const statusMatch = output.match(/\nNOEMA_HTTP_STATUS:(\d{3})$/u);
        if (
          !statusMatch ||
          Number(statusMatch[1]) < 200 ||
          Number(statusMatch[1]) >= 300
        )
          throw Error(
            'DeepSeek balance preflight returned an invalid response.',
          );
        body = JSON.parse(output.slice(0, statusMatch.index));
      }
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
    const natural = process.env.NOEMA_COLLABORATION_LIVE_NATURAL === '1';
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
      if (!natural && (!a || !b))
        throw Error('真实项目缺少预期的两个活跃成员。');
    } else if (!natural) {
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
        if (requestBudgetExceeded)
          throw Object.assign(
            new Error('Live observation request budget reached.'),
            { name: 'AbortError' },
          );
        if (calls >= requestLimit) {
          requestBudgetExceeded = true;
          requestBudgetStopReason = 'request_limit';
          const stop = Object.assign(
            new Error('Live observation request budget reached.'),
            { name: 'AbortError' },
          );
          for (const run of new Set(service?.active.values() ?? []))
            run.controller.abort(stop);
          for (const taskId of work?.runs.keys() ?? []) work.stopTask(taskId);
          throw stop;
        }
        const requestSize = options.body?.length ?? 0;
        if (natural && requestCharacters + requestSize > characterLimit) {
          characterBudgetRejected++;
          requestBudgetExceeded = true;
          requestBudgetStopReason = 'request_character_limit';
          const stop = Object.assign(
            new Error('Natural observation input budget reached.'),
            { name: 'AbortError' },
          );
          for (const run of new Set(service?.active.values() ?? []))
            run.controller.abort(stop);
          for (const taskId of work?.runs.keys() ?? []) work.stopTask(taskId);
          throw stop;
        }
        requestCharacters += requestSize;
        calls++;
        const request = JSON.parse(options.body);
        const last = request.messages.at(-1);
        const step = {
          call: calls,
          lastRole: last.role,
          lastTool: last.name,
          lastContent: last.content?.slice(0, 700),
          lastToolCalls: request.messages
            .findLast((message) => message.tool_calls)
            ?.tool_calls.map((call) => {
              let argumentKeys = [];
              try {
                argumentKeys = Object.keys(JSON.parse(call.function.arguments));
              } catch {}
              return { name: call.function.name, argumentKeys };
            }),
        };
        steps.push(step);
        try {
          const response = await net.fetch(url, options);
          step.responseStatus = response.status;
          step.responseType = response.headers.get('content-type');
          if (response.body) {
            const diagnostic = (async () => {
              const reader = response.clone().body.getReader();
              let bytes = 0;
              let preview = '';
              let tail = '';
              let ended = false;
              let truncated = false;
              try {
                while (bytes < 1_000_000) {
                  const { value, done } = await reader.read();
                  if (done) {
                    ended = true;
                    break;
                  }
                  const chunk = value.subarray(
                    0,
                    Math.min(value.byteLength, 1_000_000 - bytes),
                  );
                  bytes += chunk.byteLength;
                  const text = new TextDecoder().decode(chunk, {
                    stream: true,
                  });
                  if (preview.length < 2000)
                    preview += text.slice(0, 2000 - preview.length);
                  tail = `${tail}${text}`.slice(-512);
                }
                truncated = !ended && bytes >= 1_000_000;
                step.responseBytes = bytes;
                step.responseStreamEnded = ended;
                step.responseStreamTruncated = truncated;
                step.responseDoneMarker = tail.includes('[DONE]');
                if (!response.ok) step.responseError = preview;
                else step.responsePreview = preview;
              } finally {
                if (!ended) {
                  try {
                    await reader.cancel();
                  } catch {}
                }
              }
            })().catch((error) => {
              step.responseReadError = `${error?.name ?? 'Error'}: ${error?.message ?? 'response read failed'}`;
            });
            pendingResponseDiagnostics.push(diagnostic);
          }
          return response;
        } catch (error) {
          step.transportError = `${error?.name ?? 'Error'}: ${error?.message ?? 'request failed'}`;
          if (error?.cause?.code) step.transportCode = error.cause.code;
          throw error;
        }
      },
    });
    const workspace = process.env.NOEMA_COLLABORATION_LIVE_WORKSPACE;
    if (workspace) {
      const { SocialWorkService } =
        await import('../src/social-work-service.mjs');
      const { NoemaProjectExecutor } =
        await import('../src/noema-project-executor.mjs');
      work = new SocialWorkService({
        store,
        secretStore: secrets,
        adapter: new NoemaProjectExecutor({ provider }),
        getSelectedModel: () => 'deepseek-flash',
        chooseWorkspace: async () => workspace,
        assertWorkAllowed: (roomId) => projects.assertWorkAllowed(roomId),
        emit: (event) => {
          if (event.type === 'project-work-updated')
            service?.onProjectWorkUpdated(event.task);
        },
      });
    }
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
      ...(work
        ? {
            getProjectWorkReadiness: () => work.getReadiness(),
            startProjectWork: async (
              { dispatchFromNoema, ...input },
              signal,
            ) => {
              try {
                return dispatchFromNoema
                  ? await work.startTaskFromNoema({ ...input, signal })
                  : await work.startTask({ ...input, signal });
              } catch (error) {
                projectWorkDispatchErrors.push({
                  name: error?.name ?? 'Error',
                  message: error?.message ?? 'unknown project work error',
                  code: error?.code ?? null,
                  roomId: input.roomId,
                  projectId: input.projectId ?? null,
                  agentId: input.agentId,
                  sourceMessageId: input.sourceMessageId,
                });
                throw error;
              }
            },
          }
        : {}),
    });
    if (natural) {
      const task =
        process.env.NOEMA_COLLABORATION_LIVE_MESSAGE ||
        '我想给 Noema 的共享计划补上可靠的成果核对。现在完成依据主要是一段文字，成员说做完了，我还得自己去找文件、消息和执行结果，换个人接手又要重查。希望以后能从工作项直接找到依据，知道谁提交、谁检查过，也能看出依据变更后哪些结论要重新核对。旧项目不能因此丢记录，也要考虑失败、文件变动和不同成员交接。先帮我把这件事梳理成能持续跟进的项目计划，拿不准的地方可以问我；先不要改代码或操作生产数据。';
      const targetRoomId =
        existingProjectId &&
        process.env.NOEMA_COLLABORATION_LIVE_PROJECT_GROUP === '1'
          ? project.groupRoomId
          : 'room-noema';
      service.sendMessage({
        roomId: targetRoomId,
        agentId: 'noema',
        text: task,
      });
      await service.active.get(targetRoomId)?.done;
      const deadline = Date.now() + 4 * 60_000;
      while (
        Date.now() < deadline &&
        (service.active.size ||
          work?.runs.size ||
          service.projectGroupInboxDrains.size ||
          service.projectReportDrain)
      )
        await new Promise((resolve) => setTimeout(resolve, 200));
      if (work) await work.shutdown();
      await service.shutdown();
      await Promise.allSettled(pendingResponseDiagnostics);
      result = {
        outcome: requestBudgetExceeded ? 'incomplete' : 'observed',
        model: 'deepseek-flash',
        calls,
        requestLimit,
        characterLimit,
        characterBudgetRejected,
        ...(requestBudgetExceeded
          ? { stopReason: requestBudgetStopReason }
          : {}),
        requestCharacters,
        projectWorkDispatchErrors,
        workspaceSource: workspace
          ? JSON.parse(
              fs.readFileSync(
                path.join(scratch, 'workspace-source.json'),
                'utf8',
              ),
            )
          : null,
        executions: root.db
          .prepare(
            'SELECT id,agent_id AS agentId,status,result_text AS result,error_message AS error,verification_status AS verificationStatus FROM social_work_tasks',
          )
          .all(),
        task,
        steps,
        balanceBefore: before,
        balanceAfter: await balance(),
        latestReply: store
          .getRoomSnapshot(targetRoomId)
          .messages.findLast((message) => message.role === 'assistant'),
        projects: root.db
          .prepare('SELECT id FROM social_projects')
          .all()
          .map(({ id }) => ({
            ...projects.getProject(id),
            plan: projects.plans.get(id),
            history: projects.plans.history(id),
            publicMessages: store.getRoomSnapshot(
              projects.getProject(id).groupRoomId,
            ).messages,
          })),
        mainMessages: store.getRoomSnapshot('room-noema').messages,
        failed: root.db
          .prepare(
            "SELECT status,error_message AS error FROM social_messages WHERE status IN ('failed','interrupted')",
          )
          .all(),
        review:
          'Observed real model behavior only; no prescribed team, plan shape, workflow sequence or automatic product pass.',
      };
      fs.writeFileSync(
        path.join(scratch, `observation-${Date.now()}.json`),
        JSON.stringify(result, null, 2),
      );
    } else {
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
          requestLimit,
          characterLimit,
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
          requestLimit,
          characterLimit,
          characterBudgetRejected,
          ...(requestBudgetStopReason
            ? { stopReason: requestBudgetStopReason }
            : {}),
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
    }
  } catch (error) {
    result = requestBudgetExceeded
      ? {
          outcome: 'incomplete',
          stopReason: requestBudgetStopReason ?? 'request_budget_exceeded',
          calls,
          requestLimit,
          characterLimit,
          characterBudgetRejected,
          requestCharacters,
        }
      : {
          outcome: 'failed',
          error: error.message,
          calls,
          characterBudgetRejected,
          requestCharacters,
        };
  } finally {
    if (work) await work.shutdown();
    if (service) await service.shutdown();
    root?.db.close();
    fs.writeFileSync(
      path.join(scratch, 'result.json'),
      JSON.stringify(result, null, 2),
    );
    app.exit(
      ['passed', 'awaiting_review', 'observed'].includes(result?.outcome)
        ? 0
        : 1,
    );
  }
}
