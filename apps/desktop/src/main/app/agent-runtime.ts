import type { BrowserWindow } from 'electron';
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
      if (
        typeof eventPayload?.type !== 'string' ||
        !MODEL_EVENTS.has(eventPayload.type)
      )
        return;
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

  return { dshProjectExecutor, rootAgent };
}
