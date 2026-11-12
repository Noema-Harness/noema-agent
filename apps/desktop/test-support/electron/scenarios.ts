import type { DesktopProbeRunner } from './probes';
import type { DesktopDevelopmentOptions } from '../../src/main/platform/development-options';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { runIsolatedWorkerE2E } from './isolated-worker-e2e.mjs';

import type { BrowserWindow } from 'electron';
import type { RootAgent } from '../../src/main/agents/root-agent.mjs';
import type { RootStore } from '../../src/main/storage/root-store.mjs';
import type { SocialChatStore } from '../../src/main/chat/social-chat-store.mjs';
import type { SocialWorkService } from '../../src/main/execution/social-work-service.mjs';
type DevelopmentScenarioContext = {
  socialAgentE2eValid: boolean;
  socialAgentE2eDirectory: string | null;
  socialAgentE2eResultPath: DesktopDevelopmentOptions['socialAgentE2eResultPath'];
  testPersonalMemoryLifecycle: DesktopDevelopmentOptions['testPersonalMemoryLifecycle'];
  testUserFollowupLifecycle: DesktopDevelopmentOptions['testUserFollowupLifecycle'];
  testSocialAgentLiveE2e: DesktopDevelopmentOptions['testSocialAgentLiveE2e'];
  writeSmokeLog: (step: string, details?: Record<string, unknown>) => void;
  agent: RootAgent;
  testSocialAgentLiveModel: DesktopDevelopmentOptions['testSocialAgentLiveModel'];
  createWindow: () => void;
  mainWindow: BrowserWindow | null;
  restoreMainWindowForTest: () => boolean;
  testSocialAgentR0FirstUse: DesktopDevelopmentOptions['testSocialAgentR0FirstUse'];
  testSocialAttachmentsOnly: DesktopDevelopmentOptions['testSocialAttachmentsOnly'];
  runDesktopProbe: DesktopProbeRunner;
  testSocialAgentKeepOpen: DesktopDevelopmentOptions['testSocialAgentKeepOpen'];
  socialWorkE2eValid: boolean;
  testSocialWorkEntry: boolean;
  applicationExecutionId: string;
  socialAgentE2eModelRequests: Array<{
    model: string;
    messages: Array<{ role: string; content: string }>;
    tools?: Array<{ function?: { name?: string } }>;
  }>;
  socialWorkE2eDirectory: string | null;
  testSocialWorkResultPath: DesktopDevelopmentOptions['testSocialWorkResultPath'];
  testSocialWorkWorkspace: DesktopDevelopmentOptions['testSocialWorkWorkspace'];
  testSocialWorkSynthetic: DesktopDevelopmentOptions['testSocialWorkSynthetic'];
  rootStore: RootStore;
  testSocialWorkLiveEpisodes: DesktopDevelopmentOptions['testSocialWorkLiveEpisodes'];
  socialWorkService: SocialWorkService;
  testSocialWorkEpisodeAPrompt: DesktopDevelopmentOptions['testSocialWorkEpisodeAPrompt'];
  testSocialWorkEpisodeAChecks: DesktopDevelopmentOptions['testSocialWorkEpisodeAChecks'];
  testSocialWorkSourcePrompt: DesktopDevelopmentOptions['testSocialWorkSourcePrompt'];
  testSocialWorkEpisodeBChecks: DesktopDevelopmentOptions['testSocialWorkEpisodeBChecks'];
  socialChatStore: SocialChatStore;
  practiceRouteMetadata: string[];
  testSocialWorkProposalSourceId: DesktopDevelopmentOptions['testSocialWorkProposalSourceId'];
  practiceConfirmationEvidence: Record<string, unknown>[];
  testSocialWorkPrompt: DesktopDevelopmentOptions['testSocialWorkPrompt'];
  testSocialWorkChecksJson: DesktopDevelopmentOptions['testSocialWorkChecksJson'];
  testDatabasePath: DesktopDevelopmentOptions['testDatabasePath'];
  testDshUserDataPath: DesktopDevelopmentOptions['testDshUserDataPath'];
  testWorkerPreface: DesktopDevelopmentOptions['testWorkerPreface'];
  testWorkerPrompt: DesktopDevelopmentOptions['testWorkerPrompt'];
  isIsolatedE2eDirectory: (
    directory: string,
    userDataDirectory: string,
  ) => boolean;
  isPathWithin: (directory: string, candidate: string) => boolean;
  testRootOnly: DesktopDevelopmentOptions['testRootOnly'];
  testHistoryRecall: DesktopDevelopmentOptions['testHistoryRecall'];
  testDirectWorker: DesktopDevelopmentOptions['testDirectWorker'];
  testVerificationChecksJson: DesktopDevelopmentOptions['testVerificationChecksJson'];
};
export async function runDevelopmentScenarios(
  context: DevelopmentScenarioContext,
) {
  function requireWindow() {
    const window = context.mainWindow;
    if (!window) throw new Error('Development scenario window is unavailable');
    return window;
  }
  async function ensureRendererReady() {
    if (!context.mainWindow || context.mainWindow.isDestroyed()) {
      context.createWindow();
    }
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const window = context.mainWindow;
      if (!window || window.isDestroyed()) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      try {
        const ready = await window.webContents.executeJavaScript(
          "document.readyState !== 'loading' && Boolean(window.noema?.getSocialRoom && window.noema?.getDiagnosticsTimeline)",
        );
        if (ready) return;
      } catch {
        // The preload bridge is not available until the renderer finishes loading.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('SocialWork E2E renderer bridge did not become ready.');
  }
  const {
    socialAgentE2eValid,
    socialAgentE2eDirectory,
    socialAgentE2eResultPath,
    testPersonalMemoryLifecycle,
    testUserFollowupLifecycle,
    testSocialAgentLiveE2e,
    writeSmokeLog,
    agent,
    testSocialAgentLiveModel,
    createWindow,
    testSocialAgentR0FirstUse,
    testSocialAttachmentsOnly,
    runDesktopProbe,
    testSocialAgentKeepOpen,
    socialWorkE2eValid,
    testSocialWorkEntry,
    applicationExecutionId,
    socialAgentE2eModelRequests,
    socialWorkE2eDirectory,
    testSocialWorkResultPath,
    testSocialWorkWorkspace,
    testSocialWorkSynthetic,
    rootStore,
    testSocialWorkLiveEpisodes,
    socialWorkService,
    testSocialWorkEpisodeAPrompt,
    testSocialWorkEpisodeAChecks,
    testSocialWorkSourcePrompt,
    testSocialWorkEpisodeBChecks,
    socialChatStore,
    practiceRouteMetadata,
    testSocialWorkProposalSourceId,
    practiceConfirmationEvidence,
    testSocialWorkPrompt,
    testSocialWorkChecksJson,
    testDatabasePath,
    testDshUserDataPath,
    testWorkerPreface,
    testWorkerPrompt,
    isIsolatedE2eDirectory,
    isPathWithin,
    testRootOnly,
    testHistoryRecall,
    testDirectWorker,
    testVerificationChecksJson,
  } = context;
  if (socialAgentE2eValid && socialAgentE2eDirectory) {
    const resultPath = path.resolve(socialAgentE2eResultPath!);
    if (testSocialAgentLiveE2e) {
      writeSmokeLog('social-agent-live-preflight-started');
      let catalogTimer: NodeJS.Timeout | null = null;
      const catalogResult = await Promise.race([
        agent.refreshModels().then(() => 'ready' as const),
        new Promise<'timeout'>((resolve) => {
          catalogTimer = setTimeout(() => resolve('timeout'), 25_000);
        }),
      ]).finally(() => {
        if (catalogTimer) clearTimeout(catalogTimer);
      });
      if (catalogResult === 'timeout') {
        writeSmokeLog('social-agent-live-preflight-timeout');
        fs.writeFileSync(
          resultPath,
          JSON.stringify(
            {
              outcome: 'preflight_timeout',
              stage: 'refresh-model-catalog',
            },
            null,
            2,
          ),
          { encoding: 'utf8', flag: 'wx' },
        );
        app.quit();
        return true;
      }
      writeSmokeLog('social-agent-live-preflight-completed');
      const providerState = await agent.getUiState();
      const availableModels = providerState.models as Array<{
        name: string;
        routeKind: 'router' | 'direct';
        executionStatus: 'ready' | 'needsKey' | 'exhausted' | null;
      }>;
      const selectedRoute = availableModels.find(
        (model) => model.name === providerState.selectedModel,
      );
      const selectedRouteAvailable = Boolean(
        selectedRoute?.routeKind === 'router' ||
        selectedRoute?.executionStatus === 'ready',
      );
      if (
        !providerState.providerConfigured ||
        !providerState.connected ||
        !providerState.selectedModel ||
        providerState.selectedModel !== testSocialAgentLiveModel ||
        !selectedRouteAvailable
      ) {
        fs.writeFileSync(
          resultPath,
          JSON.stringify(
            {
              outcome: 'preflight_failed',
              providerConfigured: Boolean(providerState.providerConfigured),
              connected: Boolean(providerState.connected),
              modelSelected: Boolean(providerState.selectedModel),
              selectedRouteReady: selectedRouteAvailable,
              availableModels: availableModels.map(
                ({ name, routeKind, executionStatus }) => ({
                  name,
                  routeKind,
                  executionStatus,
                }),
              ),
            },
            null,
            2,
          ),
          { encoding: 'utf8', flag: 'wx' },
        );
        app.quit();
        return true;
      }
    }
    void (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          createWindow();
          if (!context.mainWindow || requireWindow().isDestroyed()) {
            resolve();
            return;
          }
          const contents = requireWindow().webContents;
          if (testSocialAgentR0FirstUse) {
            void (async () => {
              try {
                const deadline = Date.now() + 20_000;
                while (Date.now() < deadline) {
                  const ready = await contents.executeJavaScript(
                    "document.readyState !== 'loading' && Boolean(window.noema?.sendSocialMessage && window.noema?.getSocialState)",
                  );
                  if (ready) {
                    writeSmokeLog('r0-renderer-ready');
                    resolve();
                    return;
                  }
                  await new Promise((wait) => setTimeout(wait, 100));
                }
                throw new Error('R0 renderer bridge did not become ready');
              } catch (error) {
                writeSmokeLog('r0-renderer-wait-failed', {
                  error:
                    error instanceof Error ? error.message.slice(0, 500) : null,
                });
                reject(error);
              }
            })();
            return;
          }
          if (
            !contents.isLoadingMainFrame() &&
            contents.getURL() &&
            contents.getURL() !== 'about:blank'
          ) {
            resolve();
            return;
          }
          const loaded = () => {
            if (!contents.getURL() || contents.getURL() === 'about:blank')
              return;
            contents.off('did-finish-load', loaded);
            resolve();
          };
          contents.on('did-finish-load', loaded);
        });
        const baseWorkflow = testSocialAttachmentsOnly
          ? {
              textAttachments: await runDesktopProbe(
                'captureSocialTextAttachmentsE2e',
              ),
            }
          : testSocialAgentR0FirstUse
            ? await runDesktopProbe('captureSocialR0FirstUseE2e')
            : await runDesktopProbe('captureSocialAgentCreationE2e');
        const workflow =
          testPersonalMemoryLifecycle || testUserFollowupLifecycle
            ? {
                ...(baseWorkflow as Record<string, unknown>),
                ...(testPersonalMemoryLifecycle
                  ? {
                      personalMemoryLifecycle: await runDesktopProbe(
                        'verifyPersonalMemoryLifecycle',
                      ),
                    }
                  : {}),
                ...(testUserFollowupLifecycle
                  ? {
                      userFollowupLifecycle: await runDesktopProbe(
                        'verifyUserFollowupLifecycle',
                      ),
                    }
                  : {}),
              }
            : baseWorkflow;
        fs.writeFileSync(
          resultPath,
          JSON.stringify({ outcome: 'passed', workflow }, null, 2),
          {
            encoding: 'utf8',
            flag: 'wx',
          },
        );
      } catch (error) {
        fs.writeFileSync(
          resultPath,
          JSON.stringify(
            {
              outcome: 'failed',
              errorMessage:
                error instanceof Error ? error.message.slice(0, 8_000) : null,
              errorStack:
                error instanceof Error ? error.stack?.slice(0, 16_000) : null,
            },
            null,
            2,
          ),
          { encoding: 'utf8', flag: 'wx' },
        );
      } finally {
        if (!testSocialAgentKeepOpen) app.quit();
      }
    })();
    return true;
  }
  if (socialWorkE2eValid && socialWorkE2eDirectory) {
    const resultPath = path.resolve(testSocialWorkResultPath!);
    const workspacePath = path.resolve(testSocialWorkWorkspace!);
    void (async () => {
      let livePracticeProposal: unknown = null;
      const liveEpisodeTasks: Array<Record<string, unknown>> = [];
      let modelCatalog: Awaited<ReturnType<typeof agent.refreshModels>> | null =
        null;
      let startupRecoveryProjection: unknown = null;
      try {
        let workspaceEntryEvidence: Record<string, unknown> | null = null;
        if (testSocialWorkEntry) {
          if (!testSocialWorkSynthetic) {
            throw new Error(
              'Workspace-entry UI acceptance requires the offline synthetic executor.',
            );
          }
          await ensureRendererReady();
          const taskCount = () =>
            Number(
              socialChatStore!.db
                .prepare('SELECT COUNT(*) AS count FROM social_work_tasks')
                .get().count,
            );
          const beforeEntryCount = taskCount();
          const commonPrompt = 'NOEMA_WORK_ENTRY_SAME_PROMPT';
          const normalChat = await runDesktopProbe(
            'submitSocialWorkEntryFromRenderer',
            {
              workspaceTaskMode: false,
              prompt: commonPrompt,
              expectedReply: 'NOEMA_WORK_ENTRY_CHAT_ONLY',
              expectNewTask: false,
              knownTaskIds: [],
            },
          );
          const afterNormalChatCount = taskCount();
          if (afterNormalChatCount !== beforeEntryCount) {
            throw new Error(
              'The same prompt in ordinary chat created a workspace task.',
            );
          }
          const workspaceTask = await runDesktopProbe(
            'submitSocialWorkEntryFromRenderer',
            {
              workspaceTaskMode: true,
              prompt: commonPrompt,
              expectedReply: '已从这条对话启动项目工作。',
              expectNewTask: true,
              knownTaskIds: [],
            },
          );
          if (!workspaceTask.newTaskId) {
            throw new Error('Workspace mode did not create a SocialWork task.');
          }
          const completedEntryTask = await socialWorkService!.waitForTask(
            workspaceTask.newTaskId,
          );
          if (completedEntryTask.status !== 'completed') {
            throw new Error(
              'Renderer-created workspace task did not complete synthetically.',
            );
          }
          const afterCreatedCount = taskCount();
          if (afterCreatedCount !== beforeEntryCount + 1) {
            throw new Error(
              'Workspace mode created an unexpected number of tasks.',
            );
          }
          const canceledPrompt = 'NOEMA_WORK_ENTRY_CANCEL';
          const pickerCanceled = await runDesktopProbe(
            'submitSocialWorkEntryFromRenderer',
            {
              workspaceTaskMode: true,
              prompt: canceledPrompt,
              expectedReply: '已取消选择项目文件夹。',
              expectNewTask: false,
              knownTaskIds: [workspaceTask.newTaskId],
            },
          );
          if (taskCount() !== afterCreatedCount) {
            throw new Error(
              'Canceling workspace selection left an orphan task.',
            );
          }
          const latestUserText = (
            request: (typeof socialAgentE2eModelRequests)[number],
          ) =>
            request.messages.findLast((message) => message.role === 'user')
              ?.content ?? '';
          const ordinaryRequest = socialAgentE2eModelRequests.findLast(
            (request) => latestUserText(request) === commonPrompt,
          );
          const enabledRequest = socialAgentE2eModelRequests.findLast(
            (request) =>
              latestUserText(request).startsWith(
                '请在本机工作区执行以下任务：',
              ) && latestUserText(request).endsWith(commonPrompt),
          );
          const canceledRequest = socialAgentE2eModelRequests.findLast(
            (request) =>
              latestUserText(request).startsWith(
                '请在本机工作区执行以下任务：',
              ) && latestUserText(request).endsWith(canceledPrompt),
          );
          const exposesWorkTool = (request: typeof ordinaryRequest) =>
            Boolean(
              request?.tools?.some(
                (tool) => tool.function?.name === 'start_project_work',
              ),
            );
          if (
            !ordinaryRequest ||
            !enabledRequest ||
            !canceledRequest ||
            exposesWorkTool(ordinaryRequest) ||
            !exposesWorkTool(enabledRequest) ||
            !exposesWorkTool(canceledRequest)
          ) {
            throw new Error(
              'The renderer workspace mode did not control model tool admission.',
            );
          }
          const entryDiagnostics = await runDesktopProbe(
            'verifySocialWorkEntryDiagnostics',
            {
              applicationExecutionId,
              taskId: workspaceTask.newTaskId,
              workspacePath,
              handoffParentExecutionId: 'e2e-handoff-parent-turn',
              handoffMemberExecutionId: 'e2e-handoff-member-turn',
              handoffParentInteractionId: 'e2e-handoff-parent-message',
              handoffId: 'e2e-handoff-user-message',
              handoffRequestId: 'e2e-handoff-request',
            },
          );
          const commandReviewTask = socialChatStore!.getSocialWorkTask(
            'e2e-room-e-command-review',
          );
          const commandReviewProjection = await runDesktopProbe(
            'verifySocialWorkDurableProjection',
            {
              roomId: commandReviewTask.roomId,
              taskId: commandReviewTask.id,
              expectedStatus: 'completed',
              expectedCommandBatchStatus: 'partial',
              expectedCommandOrigin: true,
              requireDiagnostics: false,
            },
          );
          const specialistProfile = await runDesktopProbe(
            'verifySpecialistProfileFromRenderer',
            {
              name: 'S6-01 职责验证员',
              updatedName: 'S6-01 职责验证员·更新',
            },
          );
          workspaceEntryEvidence = {
            applicationExecutionId,
            ordinaryChat: normalChat,
            commandReviewProjection,
            specialistProfile,
            modelToolAdmission: {
              sameUnderlyingText:
                latestUserText(enabledRequest).replace(
                  '请在本机工作区执行以下任务：\n\n',
                  '',
                ) === commonPrompt,
              ordinaryChatExcludesWorkTool: !exposesWorkTool(ordinaryRequest),
              enabledModeIncludesWorkTool: exposesWorkTool(enabledRequest),
              pickerCancelIncludesWorkTool: exposesWorkTool(canceledRequest),
            },
            task: {
              id: completedEntryTask.id,
              status: completedEntryTask.status,
            },
            pickerCanceled,
            taskCount: {
              before: beforeEntryCount,
              afterOrdinaryChat: afterNormalChatCount,
              afterWorkspaceTask: afterCreatedCount,
              afterPickerCancel: taskCount(),
            },
            diagnostics: entryDiagnostics,
          };
        }
        if (testSocialWorkSynthetic) {
          const recoveryTaskId = 'e2e-room-d-startup-recovery';
          const recoveredTask =
            socialChatStore!.getSocialWorkTask(recoveryTaskId);
          if (
            recoveredTask.status !== 'interrupted' ||
            recoveredTask.errorCode !== 'process_crash' ||
            recoveredTask.canResume ||
            recoveredTask.executionSteps.some(
              ({
                status,
                effectStatus,
              }: {
                status: string;
                effectStatus: string;
              }) => status !== 'outcome_unknown' || effectStatus !== 'unknown',
            )
          ) {
            throw new Error(
              'Startup recovery did not preserve an unknown command outcome.',
            );
          }
          await ensureRendererReady();
          startupRecoveryProjection = await runDesktopProbe(
            'verifySocialWorkDurableProjection',
            {
              roomId: recoveredTask.roomId,
              taskId: recoveredTask.id,
              expectedStatus: recoveredTask.status,
            },
          );
        }
        if (!testSocialWorkSynthetic) {
          modelCatalog = await agent.refreshModels();
          const selectedModel = rootStore!.getSelectedModel();
          const availableModels = modelCatalog.models as Array<{
            name: string;
          }>;
          if (
            !modelCatalog.connected ||
            !availableModels.some((model) => model.name === selectedModel)
          ) {
            throw new Error(
              '当前 Noema 模型目录没有返回已选择的模型，不能开始真实项目执行。',
            );
          }
        }
        if (testSocialWorkLiveEpisodes) {
          const episodeA = await socialWorkService!.startTask({
            roomId: 'room-engineering-collaboration',
            agentId: 'engineering-partner',
            prompt: testSocialWorkEpisodeAPrompt!,
            verificationChecks: JSON.parse(testSocialWorkEpisodeAChecks!),
          });
          if (!episodeA.accepted || !episodeA.taskId) {
            throw new Error('真实经历 A 未能启动。');
          }
          const completedA = await socialWorkService!.waitForTask(
            episodeA.taskId,
          );
          liveEpisodeTasks.push({
            id: completedA.id,
            roomId: completedA.roomId,
            taskPrompt: completedA.taskPrompt,
            status: completedA.status,
            verificationStatus: completedA.verificationStatus,
            toolCallCount: completedA.toolCallCount,
            toolActionCategories: completedA.toolActionCategories,
            caseSnapshot: completedA.caseSnapshot,
            verificationResults: completedA.verificationResults,
            errorCode: completedA.errorCode,
            errorMessage: completedA.errorMessage,
          });
          if (
            completedA.status !== 'completed' ||
            completedA.verificationStatus !== 'verified' ||
            completedA.toolActionCategories.length === 0
          ) {
            throw new Error('真实经历 A 未通过独立核验或没有记录工具类别。');
          }
          socialWorkService!.setCaseEligible(completedA.id, true);

          const startEpisodeB = () =>
            socialWorkService!.startTask({
              roomId: 'room-engineering-partner',
              agentId: 'engineering-partner',
              prompt: testSocialWorkSourcePrompt!,
              verificationChecks: JSON.parse(testSocialWorkEpisodeBChecks!),
              reuseCase: true,
            });
          const recordEpisode = (task: {
            id: string;
            roomId: string;
            taskPrompt: string;
            status: string;
            verificationStatus: string;
            toolActionCategories: string[];
            caseSnapshot: { taskId: string } | null;
            toolCallCount: number;
            verificationResults: Array<{ status: string }>;
            errorCode: string | null;
            errorMessage: string | null;
          }) =>
            liveEpisodeTasks.push({
              id: task.id,
              roomId: task.roomId,
              taskPrompt: task.taskPrompt,
              status: task.status,
              verificationStatus: task.verificationStatus,
              toolCallCount: task.toolCallCount,
              toolActionCategories: task.toolActionCategories,
              caseSnapshot: task.caseSnapshot,
              verificationResults: task.verificationResults,
              errorCode: task.errorCode,
              errorMessage: task.errorMessage,
            });
          const firstB = await startEpisodeB();
          if (!firstB.accepted || !firstB.taskId) {
            throw new Error('真实经历 B 未能启动。');
          }
          let completedB = await socialWorkService!.waitForTask(firstB.taskId);
          recordEpisode(completedB);
          const cooldown = Number(
            /约\s*(\d+)\s*秒后/u.exec(completedB.errorMessage ?? '')?.[1],
          );
          const safeRateLimitRetry =
            completedB.status === 'failed' &&
            completedB.errorCode === 'dsh_rate_limited' &&
            completedB.toolCallCount === 0 &&
            completedB.verificationResults.length > 0 &&
            (
              completedB.verificationResults as Array<{
                status: string;
                reason?: string;
              }>
            ).every(
              (check) =>
                check.status === 'failed' && check.reason === 'file_missing',
            ) &&
            Number.isInteger(cooldown) &&
            cooldown >= 1 &&
            cooldown <= 120;
          if (safeRateLimitRetry) {
            await new Promise((resolve) =>
              setTimeout(resolve, (cooldown + 1) * 1_000),
            );
            const retryB = await startEpisodeB();
            if (!retryB.accepted || !retryB.taskId) {
              throw new Error('限流等待后真实经历 B 未能重新启动。');
            }
            completedB = await socialWorkService!.waitForTask(retryB.taskId);
            recordEpisode(completedB);
          }
          if (
            completedB.status !== 'completed' ||
            completedB.verificationStatus !== 'verified' ||
            completedB.caseSnapshot?.taskId !== completedA.id ||
            completedB.toolActionCategories.length === 0
          ) {
            throw new Error(
              '真实经历 B 未复用 A、通过独立核验或记录工具类别。',
            );
          }
          const proposalDeadline = Date.now() + 55_000;
          let source = socialChatStore!.getSocialWorkTask(completedB.id);
          while (
            Date.now() < proposalDeadline &&
            source.practiceCandidateStatus === 'pending'
          ) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            source = socialChatStore!.getSocialWorkTask(completedB.id);
          }
          livePracticeProposal = {
            sourceTaskId: completedB.id,
            status: source.practiceCandidateStatus,
            candidate: source.practiceCandidate,
            basisTaskId: source.practiceBasisTaskId,
            routedVia: practiceRouteMetadata,
          };
          if (source.practiceCandidateStatus === 'failed') {
            throw new Error(
              '基于真实 DSH 经历的模型调用失败；请检查当前模型服务连接。',
            );
          }
          if (source.practiceCandidateStatus === 'pending') {
            throw new Error('真实 DSH 经历的候选提炼超过 55 秒仍未结束。');
          }
          if (source.practiceCandidateStatus === 'available') {
            const candidate = source.practiceCandidate;
            if (
              !candidate ||
              candidate.basisTaskId !== completedA.id ||
              candidate.trigger.length < 5 ||
              candidate.action.length < 5 ||
              candidate.limits.length < 5
            ) {
              throw new Error('真实经历候选缺少有效字段或来源。');
            }
          }
        }
        if (testSocialWorkProposalSourceId) {
          const started = socialWorkService!.startPracticeProposal(
            testSocialWorkProposalSourceId,
          );
          if (!started) {
            throw new Error('隔离的候选来源不符合实践提炼条件。');
          }
          const proposalDeadline = Date.now() + 55_000;
          let source = socialChatStore!.getSocialWorkTask(
            testSocialWorkProposalSourceId,
          );
          while (
            Date.now() < proposalDeadline &&
            source.practiceCandidateStatus === 'pending'
          ) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            source = socialChatStore!.getSocialWorkTask(
              testSocialWorkProposalSourceId,
            );
          }
          livePracticeProposal = {
            status: source.practiceCandidateStatus,
            candidate: source.practiceCandidate,
            basisTaskId: source.practiceBasisTaskId,
            routedVia: practiceRouteMetadata,
          };
          if (source.practiceCandidateStatus === 'failed') {
            throw new Error('候选提炼的模型调用失败；请检查当前模型服务连接。');
          }
          if (source.practiceCandidateStatus === 'pending') {
            throw new Error('候选提炼的模型调用超过 55 秒仍未结束。');
          }
          if (source.practiceCandidateStatus === 'available') {
            const candidate = source.practiceCandidate;
            if (
              !candidate ||
              candidate.basisTaskId !== source.caseSnapshot?.taskId ||
              candidate.trigger.length < 5 ||
              candidate.action.length < 5 ||
              candidate.limits.length < 5
            ) {
              throw new Error('真实模型生成的候选字段或来源校验未通过。');
            }
          }
        }
        if (
          (testSocialWorkProposalSourceId || testSocialWorkLiveEpisodes) &&
          (livePracticeProposal as { status?: string } | null)?.status ===
            'none'
        ) {
          fs.writeFileSync(
            resultPath,
            JSON.stringify(
              {
                outcome: 'practice_proposal_none',
                startupRecoveryProjection,
                workspaceEntryEvidence,
                livePracticeProposal,
                practiceConfirmationEvidence,
                liveEpisodeTasks,
                practiceRouteMetadata,
                workspacePath,
              },
              null,
              2,
            ),
            { encoding: 'utf8', flag: 'wx' },
          );
          return;
        }
        const started = await socialWorkService!.startTask({
          roomId: 'room-engineering-collaboration',
          agentId: 'engineering-partner',
          prompt: testSocialWorkPrompt!,
          reuseCase: true,
          verificationChecks: testSocialWorkChecksJson
            ? JSON.parse(testSocialWorkChecksJson)
            : [],
        });
        const taskId = started.accepted ? (started.taskId ?? null) : null;
        const backgroundProjection =
          taskId && testSocialWorkSynthetic
            ? await runDesktopProbe('hideWindowDuringSocialWork', {
                roomId: 'room-engineering-collaboration',
                taskId,
              })
            : null;
        const taskWhileHidden =
          taskId && testSocialWorkSynthetic
            ? socialChatStore!.getSocialWorkTask(taskId)
            : null;
        if (
          backgroundProjection &&
          !['starting', 'running', 'verifying'].includes(
            taskWhileHidden?.status ?? '',
          )
        ) {
          throw new Error(
            'SocialWork task stopped when its window was hidden.',
          );
        }
        if (backgroundProjection && !context.restoreMainWindowForTest()) {
          throw new Error(
            'Noema could not restore the hidden SocialWork window.',
          );
        }
        const activeRendererProjection =
          taskId && testSocialWorkSynthetic
            ? await runDesktopProbe('verifySocialWorkActiveProjection', {
                roomId: 'room-engineering-collaboration',
                taskId,
              })
            : null;
        const task = taskId
          ? await socialWorkService!.waitForTask(taskId)
          : null;
        const rendererProjection = task
          ? await runDesktopProbe('verifySocialWorkDurableProjection', {
              roomId: task.roomId,
              taskId: task.id,
              expectedStatus: task.status,
              workspacePath,
              privateSentinel: task.taskPrompt,
            })
          : null;
        fs.writeFileSync(
          resultPath,
          JSON.stringify(
            {
              outcome: task ? 'finished' : 'preflight_failed',
              task,
              backgroundProjection,
              taskStatusWhileHidden: taskWhileHidden?.status ?? null,
              activeRendererProjection,
              rendererProjection,
              startupRecoveryProjection,
              workspaceEntryEvidence,
              modelCatalog,
              workspacePath,
              livePracticeProposal,
              practiceConfirmationEvidence,
              liveEpisodeTasks,
              practiceRouteMetadata,
            },
            null,
            2,
          ),
          { encoding: 'utf8', flag: 'wx' },
        );
      } catch (error) {
        if (error instanceof Error) {
          console.error(
            'Isolated SocialWork E2E failed:',
            error.stack ?? error.message,
          );
        }
        fs.writeFileSync(
          resultPath,
          JSON.stringify(
            {
              outcome: 'setup_failed',
              modelCatalog,
              errorCode:
                error &&
                typeof error === 'object' &&
                'code' in error &&
                typeof error.code === 'string'
                  ? error.code
                  : 'social_work_e2e_failed',
              errorMessage:
                error instanceof Error ? error.message.slice(0, 1_000) : null,
              entryModelRequests: socialAgentE2eModelRequests.map(
                (request) => ({
                  model: request.model,
                  userMessageIsCommonPrompt:
                    request.messages.findLast(
                      (message) => message.role === 'user',
                    )?.content === 'NOEMA_WORK_ENTRY_SAME_PROMPT',
                  userMessageHasTaskModePrefix:
                    request.messages
                      .findLast((message) => message.role === 'user')
                      ?.content.startsWith('请在本机工作区执行以下任务：') ??
                    false,
                  userMessageIsCancelPrompt:
                    request.messages.findLast(
                      (message) => message.role === 'user',
                    )?.content === 'NOEMA_WORK_ENTRY_CANCEL',
                  toolNames:
                    request.tools?.map(
                      (tool) => tool.function?.name ?? 'unknown',
                    ) ?? [],
                }),
              ),
              entryMessages: testSocialWorkEntry
                ? socialChatStore!.db
                    .prepare(
                      "SELECT role, status, content FROM social_messages WHERE room_id = 'room-noema' ORDER BY seq DESC LIMIT 8",
                    )
                    .all()
                    .map(
                      (message: {
                        role: string;
                        status: string;
                        content: string;
                      }) => ({
                        role: message.role,
                        status: message.status,
                        contentLength: message.content.length,
                        containsEntryMarker:
                          message.content.includes('NOEMA_WORK_ENTRY_'),
                        containsExpectedReply:
                          message.content.includes(
                            'NOEMA_WORK_ENTRY_CHAT_ONLY',
                          ) ||
                          message.content.includes(
                            'NOEMA_WORK_ENTRY_TOOL_HANDLED',
                          ),
                      }),
                    )
                : [],
              livePracticeProposal,
              practiceConfirmationEvidence,
              liveEpisodeTasks,
              practiceRouteMetadata,
            },
            null,
            2,
          ),
          { encoding: 'utf8', flag: 'wx' },
        );
      } finally {
        app.quit();
      }
    })();
    return true;
  }
  if (
    !app.isPackaged &&
    testDatabasePath &&
    path.isAbsolute(testDatabasePath) &&
    testDshUserDataPath &&
    path.isAbsolute(testDshUserDataPath) &&
    (!testWorkerPreface ||
      testWorkerPreface.startsWith('[NOEMA E2E PREFACE]')) &&
    testWorkerPrompt?.startsWith('[NOEMA E2E]') &&
    path.resolve(testDatabasePath) !==
      path.join(app.getPath('userData'), 'noema.sqlite3') &&
    isIsolatedE2eDirectory(
      path.dirname(path.resolve(testDatabasePath)),
      app.getPath('userData'),
    ) &&
    path.resolve(testDshUserDataPath) !==
      path.resolve(app.getPath('userData')) &&
    path.resolve(testDshUserDataPath) !==
      path.dirname(path.resolve(testDatabasePath)) &&
    isPathWithin(
      path.dirname(path.resolve(testDatabasePath)),
      testDshUserDataPath,
    )
  ) {
    const e2eDirectory = path.dirname(path.resolve(testDatabasePath));
    const resultPath = path.join(
      e2eDirectory,
      `worker-e2e-result-${Date.now()}.json`,
    );
    void runIsolatedWorkerE2E({
      agent,
      store: rootStore,
      databasePath: testDatabasePath,
      prefacePrompt: testWorkerPreface,
      prompt: testWorkerPrompt,
      resultPath,
      rootOnly: testRootOnly,
      historyRecall: testHistoryRecall,
      directWorker: testDirectWorker,
      verificationChecks:
        testDirectWorker && testVerificationChecksJson
          ? JSON.parse(testVerificationChecksJson)
          : [],
    })
      .catch((error) => {
        const result = {
          outcome: 'setup_failed',
          errorCode:
            typeof error?.code === 'string'
              ? error.code
              : 'e2e_scenario_failed',
        };
        fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), {
          encoding: 'utf8',
          flag: 'wx',
        });
        console.error('Isolated Noema E2E scenario failed:', result.errorCode);
      })
      .finally(() => app.quit());
    return true;
  }
  return false;
}
