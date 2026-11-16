import type { BrowserWindow } from 'electron';
import { createAgentRuntimePair } from '../agents/agent-runtime-core.ts';
import { RootAgent } from '../agents/root-agent.mjs';
import {
  DshHeadlessAdapter,
  resolveDshHeadlessRuntime,
} from '../integrations/dsh-headless-adapter.mjs';
import { CHANNELS } from '../ipc/root-ipc.mjs';
import type { RootStore } from '../storage/root-store.mjs';
import type { ProviderRuntime } from './provider-runtime';

const MODEL_EVENTS = new Set([
  'models-updated',
  'model-selected',
  'provider-configured',
  'web-search-configured',
]);

export interface AgentRuntimeOptions {
  rootStore: RootStore;
  providerRuntime: ProviderRuntime;
  userDataPath: string;
  getMainWindow: () => BrowserWindow | null;
  recordDiagnosticEvent: (event: Record<string, unknown>) => void;
}

export interface AgentRuntime {
  dshProjectExecutor: DshHeadlessAdapter | null;
  rootAgent: RootAgent;
  agentRuntimes: Awaited<ReturnType<typeof createAgentRuntimePair>>;
}

export async function createAgentRuntime(
  options: AgentRuntimeOptions,
): Promise<AgentRuntime> {
  const {
    rootStore,
    providerRuntime,
    userDataPath,
    getMainWindow,
    recordDiagnosticEvent,
  } = options;
  const {
    provider,
    providerSecretStore,
    modelUsageStore,
    webSearchSecretStore,
  } = providerRuntime;

  let dshProjectExecutor: DshHeadlessAdapter | null = null;
  try {
    const rawBaseUrl = providerSecretStore.getBaseUrl() ?? null;
    if (
      providerSecretStore.isConfigured() &&
      typeof rawBaseUrl === 'string' &&
      rawBaseUrl
    ) {
      const baseUrl = rawBaseUrl.endsWith('/v1')
        ? rawBaseUrl
        : `${rawBaseUrl.replace(/\/+$/u, '')}/v1`;
      const dshRuntime = await resolveDshHeadlessRuntime();
      const executionPermission =
        rootStore.getExecutionPermissions().externalFiles ?? 'ask';
      const dshPermissionMode =
        executionPermission === 'allow'
          ? 'danger-full-access'
          : executionPermission === 'read-only'
            ? 'read-only'
            : 'workspace-write';
      dshProjectExecutor = new DshHeadlessAdapter({
        runtime: dshRuntime,
        userDataPath,
        providerBaseUrl: baseUrl,
        getApiKey: () => providerSecretStore.get(),
        getPermissionMode: () => {
          const value =
            rootStore.getExecutionPermissions().externalFiles ?? 'ask';
          return value === 'allow'
            ? 'danger-full-access'
            : value === 'read-only'
              ? 'read-only'
              : 'workspace-write';
        },
        onUsage: (usage) => modelUsageStore.record(usage),
      });
      recordDiagnosticEvent({
        module: 'dsh',
        operation: 'runtime.startup',
        status: 'ready',
        details: { phase: 'startup' },
      });
      recordDiagnosticEvent({
        module: 'dsh',
        operation: 'runtime.permission',
        status: 'ready',
        details: { capability: dshPermissionMode },
      });
    }
  } catch (error) {
    const code =
      typeof (error as { code?: unknown })?.code === 'string'
        ? (error as { code: string }).code
        : 'dsh_runtime_unavailable';
    recordDiagnosticEvent({
      module: 'dsh',
      operation: 'runtime.startup',
      status: 'unavailable',
      errorCode: code,
      details: { phase: 'startup' },
    });
  }

  const chatBackend = {
    kind: 'native' as const,
    streamChat: (options: Parameters<typeof provider.streamChat>[0]) =>
      provider.streamChat(options),
  };
  const agentRuntimes = await createAgentRuntimePair({
    userDataPath,
    noemaRuntime: chatBackend,
    executorRuntime: chatBackend,
  });
  const recordRootTurnEvent = (payload: Record<string, unknown>) => {
    const coreType =
      payload.type === 'turn-started'
        ? 'turn.started'
        : payload.type === 'turn-completed'
          ? 'turn.completed'
          : payload.type === 'turn-failed'
            ? 'turn.failed'
            : null;
    if (!coreType) return;
    void agentRuntimes.noema
      .appendEvent({
        type: coreType,
        payload: {
          turnId: payload.turnId,
          attempt: payload.attempt,
          ...(typeof payload.model === 'string'
            ? { model: payload.model }
            : {}),
          ...(typeof payload.code === 'string' ? { code: payload.code } : {}),
        },
      })
      .catch(() => {
        recordDiagnosticEvent({
          module: 'agent.runtime',
          operation: 'event.append',
          status: 'failed',
          details: { agentId: 'noema', eventType: coreType },
        });
      });
  };

  const rootAgent = new RootAgent({
    store: rootStore,
    provider,
    recordDiagnosticEvent,
    secretStore: providerSecretStore,
    webSearchSecretStore,
    recordExternalUsage: (record) => modelUsageStore.recordExternal(record),
    allowRootActions: false,
    allowHistorySearch: false,
    recoverInterruptedTurns: false,
    emit: (payload) => {
      const eventPayload = payload as {
        type?: unknown;
        model?: unknown;
      };
      if (typeof eventPayload?.type !== 'string') return;
      recordRootTurnEvent(eventPayload as Record<string, unknown>);
      if (!MODEL_EVENTS.has(eventPayload.type)) return;
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send(CHANNELS.modelStateEvent, {
          type: eventPayload.type,
          ...(eventPayload.type === 'model-selected' &&
          typeof eventPayload.model === 'string'
            ? { model: eventPayload.model }
            : {}),
        });
    },
  });

  return { dshProjectExecutor, rootAgent, agentRuntimes };
}
