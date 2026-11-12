import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { App } from 'electron';
import type { DshHeadlessAdapter } from '../integrations/dsh-headless-adapter.mjs';
import type { OpenAICompatibleClient } from '../providers/openai-compatible-client.mjs';

export interface SocialE2eOptions {
  app: Pick<App, 'isPackaged' | 'getPath' | 'quit'>;
  provider: OpenAICompatibleClient;
  isPathWithin: (directory: string, candidate: string) => boolean;
  isIsolatedE2eDirectory: (
    directory: string,
    userDataDirectory: string,
  ) => boolean;
  testDatabasePath: string | null;
  testWorkerPrompt: string | null;
  testSocialWorkPrompt: string | null;
  testSocialWorkSourcePrompt: string | null;
  testSocialWorkWorkspace: string | null;
  testSocialWorkResultPath: string | null;
  testDshUserDataPath: string | null;
  testSocialWorkProposalSourceId: string | null;
  testSocialWorkLiveEpisodes: boolean;
  testSocialWorkEpisodeAPrompt: string | null;
  testSocialWorkEpisodeAChecks: string | null;
  testSocialWorkEpisodeBChecks: string | null;
  testSocialWorkPracticeDecision: string | null;
  testSocialWorkEntry: boolean;
  testSocialWorkSynthetic: boolean;
  testSocialWorkChecksJson: string | null;
  testSocialAgentWorkflow: boolean;
  testSocialAgentR0FirstUse: boolean;
  testSocialAgentLiveE2e: boolean;
  socialAgentE2eResultPath: string | null;
}

export interface SocialE2eRuntime {
  socialWorkE2eDirectory: string | null;
  socialWorkE2eValid: boolean;
  socialWorkEntryE2eValid: boolean;
  socialAgentE2eDirectory: string | null;
  socialAgentE2eValid: boolean;
  useSyntheticSocialWork: boolean;
  practiceRouteMetadata: string[];
  practiceProvider: OpenAICompatibleClient;
  syntheticSocialWorkAdapter: DshHeadlessAdapter | null;
  practiceConfirmationEvidence: Array<Record<string, unknown>>;
}

export function createSocialE2eRuntime(
  options: SocialE2eOptions,
): SocialE2eRuntime | null {
  const {
    app,
    provider,
    isPathWithin,
    isIsolatedE2eDirectory,
    testDatabasePath,
    testWorkerPrompt,
    testSocialWorkPrompt,
    testSocialWorkSourcePrompt,
    testSocialWorkWorkspace,
    testSocialWorkResultPath,
    testDshUserDataPath,
    testSocialWorkProposalSourceId,
    testSocialWorkLiveEpisodes,
    testSocialWorkEpisodeAPrompt,
    testSocialWorkEpisodeAChecks,
    testSocialWorkEpisodeBChecks,
    testSocialWorkPracticeDecision,
    testSocialWorkEntry,
    testSocialWorkSynthetic,
    testSocialWorkChecksJson,
    testSocialAgentWorkflow,
    testSocialAgentR0FirstUse,
    testSocialAgentLiveE2e,
    socialAgentE2eResultPath,
  } = options;

  const socialWorkE2eDirectory =
    testDatabasePath && path.isAbsolute(testDatabasePath)
      ? path.dirname(path.resolve(testDatabasePath))
      : null;
  const socialWorkE2eValid = Boolean(
    !app.isPackaged &&
    !testWorkerPrompt &&
    typeof testSocialWorkPrompt === 'string' &&
    testSocialWorkPrompt.startsWith('[NOEMA E2E]') &&
    testSocialWorkPrompt.length <= 4_000 &&
    (!testSocialWorkSourcePrompt ||
      (testSocialWorkSourcePrompt.length <= 2_000 &&
        !testSocialWorkSourcePrompt.includes('\n'))) &&
    typeof testDatabasePath === 'string' &&
    typeof testSocialWorkWorkspace === 'string' &&
    path.isAbsolute(testSocialWorkWorkspace) &&
    typeof testSocialWorkResultPath === 'string' &&
    path.isAbsolute(testSocialWorkResultPath) &&
    typeof testDshUserDataPath === 'string' &&
    path.isAbsolute(testDshUserDataPath) &&
    (!testSocialWorkProposalSourceId ||
      (testSocialWorkProposalSourceId.startsWith('e2e-') &&
        typeof testSocialWorkSourcePrompt === 'string')) &&
    (!testSocialWorkLiveEpisodes ||
      (typeof testSocialWorkEpisodeAPrompt === 'string' &&
        testSocialWorkEpisodeAPrompt.startsWith('[NOEMA E2E]') &&
        typeof testSocialWorkEpisodeAChecks === 'string' &&
        typeof testSocialWorkEpisodeBChecks === 'string')) &&
    (!testSocialWorkPracticeDecision ||
      ['trial', 'case', 'cancel'].includes(testSocialWorkPracticeDecision)) &&
    socialWorkE2eDirectory &&
    isIsolatedE2eDirectory(socialWorkE2eDirectory, app.getPath('userData')) &&
    path.resolve(testDatabasePath) !==
      path.join(app.getPath('userData'), 'noema.sqlite3') &&
    isPathWithin(socialWorkE2eDirectory, testSocialWorkWorkspace) &&
    path.resolve(testSocialWorkWorkspace) !== socialWorkE2eDirectory &&
    isPathWithin(socialWorkE2eDirectory, testSocialWorkResultPath) &&
    isPathWithin(socialWorkE2eDirectory, testDshUserDataPath) &&
    path.resolve(testDshUserDataPath) !== socialWorkE2eDirectory &&
    fs.existsSync(testSocialWorkWorkspace) &&
    fs.statSync(testSocialWorkWorkspace).isDirectory(),
  );
  const socialWorkEntryE2eValid = Boolean(
    socialWorkE2eValid && testSocialWorkEntry && testSocialWorkSynthetic,
  );
  const socialAgentE2eDirectory =
    testDatabasePath && path.isAbsolute(testDatabasePath)
      ? path.dirname(path.resolve(testDatabasePath))
      : null;
  const socialAgentE2eValid = Boolean(
    !app.isPackaged &&
    testSocialAgentWorkflow &&
    (!testSocialAgentR0FirstUse || testSocialAgentLiveE2e) &&
    !testWorkerPrompt &&
    !testSocialWorkPrompt &&
    typeof testDatabasePath === 'string' &&
    path.isAbsolute(testDatabasePath) &&
    typeof testDshUserDataPath === 'string' &&
    path.isAbsolute(testDshUserDataPath) &&
    typeof socialAgentE2eResultPath === 'string' &&
    path.isAbsolute(socialAgentE2eResultPath) &&
    socialAgentE2eDirectory &&
    isIsolatedE2eDirectory(socialAgentE2eDirectory, app.getPath('userData')) &&
    path.resolve(testDatabasePath) !==
      path.join(app.getPath('userData'), 'noema.sqlite3') &&
    path.resolve(testDshUserDataPath) !== socialAgentE2eDirectory &&
    isPathWithin(socialAgentE2eDirectory, testDshUserDataPath) &&
    isPathWithin(socialAgentE2eDirectory, socialAgentE2eResultPath),
  );
  if (
    testSocialAgentWorkflow &&
    !socialAgentE2eValid &&
    socialAgentE2eDirectory &&
    typeof socialAgentE2eResultPath === 'string' &&
    path.isAbsolute(socialAgentE2eResultPath) &&
    isIsolatedE2eDirectory(socialAgentE2eDirectory, app.getPath('userData')) &&
    isPathWithin(socialAgentE2eDirectory, socialAgentE2eResultPath)
  ) {
    fs.writeFileSync(
      path.resolve(socialAgentE2eResultPath),
      JSON.stringify(
        {
          outcome: 'preflight_failed',
          packaged: app.isPackaged,
          testFlag: testSocialAgentWorkflow,
          workerPromptConfigured: Boolean(testWorkerPrompt),
          socialWorkPromptConfigured: Boolean(testSocialWorkPrompt),
          databasePath: testDatabasePath,
          dshUserDataPath: testDshUserDataPath,
          resultPath: socialAgentE2eResultPath,
          isolatedDirectory: socialAgentE2eDirectory,
        },
        null,
        2,
      ),
      { encoding: 'utf8', flag: 'wx' },
    );
    app.quit();
    return null;
  }

  const useSyntheticSocialWork = socialWorkE2eValid && testSocialWorkSynthetic;
  const practiceRouteMetadata: string[] = [];
  const practiceProvider =
    !useSyntheticSocialWork &&
    (testSocialWorkProposalSourceId || testSocialWorkLiveEpisodes)
      ? ({
          async *streamChat(input: {
            model: string;
            messages: Array<{ role: string; content: string }>;
            signal: AbortSignal;
            maxTokens?: number;
            tools?: Array<object>;
            onToolCalls?: (calls: Array<object>) => void;
          }) {
            yield* provider.streamChat({
              ...input,
              onRouteMetadata: (route) => {
                if (route) practiceRouteMetadata.push(route);
              },
            });
          },
        } as unknown as OpenAICompatibleClient)
      : provider;
  const syntheticSocialWorkAdapter = (useSyntheticSocialWork
    ? {
        async startTask({
          workspacePath,
          taskId,
          onEvent,
        }: {
          workspacePath: string;
          taskId: string;
          onEvent: (event: Record<string, unknown>) => void;
        }) {
          const sessionId = `noema-social-work-fixture-${taskId}`;
          let stopped = false;
          const started = Promise.resolve({ sessionId });
          const done = (async () => {
            onEvent({ type: 'session', sessionId });
            onEvent({ type: 'status', phase: 'working' });
            await new Promise((resolve) => setTimeout(resolve, 10_000));
            if (stopped) {
              return {
                status: 'interrupted' as const,
                errorCode: 'worker_interrupted',
                sessionId,
                toolCallCount: 0,
              };
            }
            const checks = JSON.parse(testSocialWorkChecksJson ?? '[]');
            if (
              !Array.isArray(checks) ||
              checks.length === 0 ||
              checks.some(
                (check) =>
                  check?.kind !== 'file_contains' ||
                  typeof check.path !== 'string' ||
                  typeof check.text !== 'string' ||
                  path.isAbsolute(check.path) ||
                  !isPathWithin(
                    workspacePath,
                    path.resolve(workspacePath, check.path),
                  ),
              )
            ) {
              return {
                status: 'failed' as const,
                errorCode: 'invalid_synthetic_fixture',
                errorMessage: '合成工作任务只接受工作区内的文件标记检查。',
                sessionId,
                toolCallCount: 0,
              };
            }
            const groupedChecks = new Map<string, string[]>();
            for (const check of checks) {
              groupedChecks.set(check.path, [
                ...(groupedChecks.get(check.path) ?? []),
                check.text,
              ]);
            }
            const stepId = randomUUID();
            onEvent({
              type: 'tool-call',
              tool: 'synthetic_fixture_write',
              count: 1,
              stepId,
              externalCallId: 'synthetic-write',
              category: 'write',
              hasSideEffect: true,
            });
            for (const [relativePath, texts] of groupedChecks) {
              const filePath = path.resolve(workspacePath, relativePath);
              fs.mkdirSync(path.dirname(filePath), { recursive: true });
              fs.writeFileSync(filePath, texts.join('\n'), 'utf8');
            }
            onEvent({
              type: 'tool-result',
              stepId,
              status: 'completed',
              effectStatus: 'applied',
            });
            return {
              status: 'completed' as const,
              result: '合成 E2E 执行器写入了验收标记。',
              sessionId,
              toolCallCount: 1,
            };
          })();
          return {
            started,
            done,
            stop() {
              stopped = true;
              return true;
            },
          };
        },
      }
    : null) as unknown as DshHeadlessAdapter | null;
  const practiceConfirmationEvidence: Array<Record<string, unknown>> = [];

  return {
    socialWorkE2eDirectory,
    socialWorkE2eValid,
    socialWorkEntryE2eValid,
    socialAgentE2eDirectory,
    socialAgentE2eValid,
    useSyntheticSocialWork,
    practiceRouteMetadata,
    practiceProvider,
    syntheticSocialWorkAdapter,
    practiceConfirmationEvidence,
  };
}

export interface SyntheticSocialChatStreamInput {
  model: string;
  messages: object[];
  tools?: object[];
  onToolCalls?: (calls: object[], requestId: string) => void;
  onRouteMetadata?: (route: string | null) => void;
  signal: AbortSignal;
}

export interface SyntheticSocialChatProvider {
  streamChat(input: SyntheticSocialChatStreamInput): AsyncIterable<string>;
}

interface SyntheticSocialChatOptions {
  provider: SyntheticSocialChatProvider;
  store: {
    listAgents(): Array<{
      id: string;
      archivedAt: string | null;
      capabilities: string[];
    }>;
  };
  requests: unknown[];
  e2eValid: boolean;
  liveE2e: boolean;
  e2eModel: string;
  historyRecallMarker: string;
  composerQueueMarker: string;
  delegationMarker: string;
  delegationTask: string;
  delegationResult: string;
}

export function createSyntheticSocialChatProvider(
  options: SyntheticSocialChatOptions,
): SyntheticSocialChatProvider {
  const {
    provider,
    store,
    requests,
    e2eValid,
    liveE2e,
    e2eModel,
    historyRecallMarker,
    composerQueueMarker,
    delegationMarker,
    delegationTask,
    delegationResult,
  } = options;

  if (!e2eValid || liveE2e) {
    if (!liveE2e) return provider;
    return {
      async *streamChat(input) {
        requests.push(input);
        yield* provider.streamChat(input);
      },
    };
  }

  return {
    async *streamChat(input) {
      requests.push(input);
      const messages = input.messages as Array<{
        role: string;
        content: string;
      }>;
      const tools = input.tools as
        | Array<{ function?: { name?: string } }>
        | undefined;
      const latestUserMessage = [...messages]
        .reverse()
        .find((message) => message.role === 'user')?.content;
      if (latestUserMessage?.includes('NOEMA_WORK_ENTRY_')) {
        const latestUserIndex = messages.findLastIndex(
          (message) => message.role === 'user',
        );
        const hasCurrentToolResult = messages
          .slice(latestUserIndex + 1)
          .some((message) => message.role === 'tool');
        if (hasCurrentToolResult) {
          yield 'NOEMA_WORK_ENTRY_TOOL_HANDLED';
          return;
        }
        const workToolAvailable = tools?.some(
          (tool) => tool.function?.name === 'start_project_work',
        );
        if (!workToolAvailable) {
          yield 'NOEMA_WORK_ENTRY_CHAT_ONLY';
          return;
        }
        const executor = store
          .listAgents()
          .find(
            (member) =>
              !member.archivedAt &&
              member.capabilities.includes('project-work'),
          );
        if (!executor) {
          throw new Error(
            'Synthetic workspace-entry E2E could not find an eligible executor.',
          );
        }
        input.onToolCalls?.(
          [
            {
              id: 'e2e-social-work-entry',
              function: {
                name: 'start_project_work',
                arguments: JSON.stringify({
                  agent_id: executor.id,
                  task: latestUserMessage,
                }),
              },
            },
          ],
          '',
        );
        return;
      }
      const history = latestUserMessage?.includes(historyRecallMarker)
        ? messages.find((message) =>
            message.content?.includes('"type":"noema_history_recall"'),
          )
        : undefined;
      if (history) {
        input.onRouteMetadata?.(e2eModel);
        yield '我找到了你提到的旧对话，可以从来源查看原文。';
        return;
      }
      if (latestUserMessage?.includes(composerQueueMarker)) {
        await new Promise((resolve) => setTimeout(resolve, 6_000));
        yield '输入区队列布局夹具回复已完成。';
        return;
      }
      const specialistReport = messages.find(
        (message) => message.role === 'tool',
      );
      if (specialistReport) {
        input.onRouteMetadata?.(e2eModel);
        yield `结合工程搭档的协助，我核对了这项信息。${delegationTask} 核对结果：${delegationResult}`;
        return;
      }
      if (latestUserMessage?.includes(delegationMarker)) {
        input.onToolCalls?.(
          [
            {
              id: 'e2e-specialist-delegation',
              function: {
                name: 'delegate_to_specialist',
                arguments: JSON.stringify({
                  agent_id: 'engineering-partner',
                  task: delegationTask,
                }),
              },
            },
          ],
          '',
        );
        return;
      }
      if (latestUserMessage === delegationTask) {
        yield delegationResult;
        return;
      }
      if (latestUserMessage?.includes('今天发生了一件让我有点难受')) {
        yield '听起来这件事还留在你心里。你愿意先讲讲，最难受的是哪一部分吗？';
        return;
      }
      if (latestUserMessage?.includes('想起这件事还是有些不舒服')) {
        yield '它似乎还在影响你。你现在最想先说的是哪一部分？';
        return;
      }
      if (latestUserMessage?.includes('我们再聊一件普通小事')) {
        yield '好啊，说来听听，你想聊什么？';
        return;
      }
      if (latestUserMessage?.includes('请说说这两条消息的重点')) {
        yield '第一条是 OpenAI 的官方发布说明，第二条补充了项目进展；前者说明能力变化，后者说明这些变化怎样影响实际使用。';
        return;
      }
      yield '收到。你想先从哪一部分聊起？';
    },
  };
}
