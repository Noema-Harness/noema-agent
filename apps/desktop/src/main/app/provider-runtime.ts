import fs from 'node:fs';
import path from 'node:path';
import { net } from 'electron';
import type { App, SafeStorage } from 'electron';
import { EncryptedSecretStore } from '../platform/encrypted-secret-store.mjs';
import {
  OpenAICompatibleClient,
  resolveConfiguredModelBaseUrl,
} from '../providers/openai-compatible-client.mjs';
import { ModelUsageStore } from '../storage/model-usage-store.mjs';
import type { RootStore } from '../storage/root-store.mjs';

export interface ProviderRuntimeOptions {
  app: App;
  safeStorage: SafeStorage;
  rootStore: RootStore;
  writeSmokeLog: (step: string, details?: Record<string, unknown>) => void;
  recordDiagnosticEvent: (event: Record<string, unknown>) => void;
  testSocialProviderLiveAcceptance: boolean;
  testDataArgument: string | null;
  testDatabasePath: string | null;
  testReadOnlyCredentialDirectory: string | null;
  testSocialAgentR0FirstUse: boolean;
}

export interface ProviderRuntime {
  provider: OpenAICompatibleClient;
  providerSecretStore: EncryptedSecretStore;
  modelUsageStore: ModelUsageStore;
  webSearchSecretStore: EncryptedSecretStore;
}

function discoverFreeLLMAPIBaseUrl(appDataPath: string) {
  try {
    const configPath = path.join(appDataPath, 'FreeLLMAPI', 'config.json');
    const configuration = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (
      Number.isInteger(configuration.port) &&
      configuration.port > 0 &&
      configuration.port <= 65_535
    ) {
      return `http://127.0.0.1:${configuration.port}/v1`;
    }
  } catch {
    // Use FreeLLMAPI's documented default when the desktop configuration is absent.
  }
  return 'http://127.0.0.1:3001/v1';
}

export function createProviderRuntime(
  options: ProviderRuntimeOptions,
): ProviderRuntime {
  const {
    app,
    safeStorage,
    rootStore,
    writeSmokeLog,
    recordDiagnosticEvent,
    testSocialProviderLiveAcceptance,
    testDataArgument,
    testDatabasePath,
    testReadOnlyCredentialDirectory,
    testSocialAgentR0FirstUse,
  } = options;
  const modelUsageStore = new ModelUsageStore(rootStore.db);
  const defaultCredentialDirectory = path.join(
    app.getPath('userData'),
    'credentials',
  );
  let providerCredentialDirectory = defaultCredentialDirectory;
  if (testSocialProviderLiveAcceptance) {
    const expectedCredentialDirectory = path.join(
      app.getPath('appData'),
      'Noema',
      'credentials',
    );
    if (
      app.isPackaged ||
      !testDataArgument ||
      !testDatabasePath ||
      !testReadOnlyCredentialDirectory ||
      !path.isAbsolute(testReadOnlyCredentialDirectory) ||
      path.resolve(testReadOnlyCredentialDirectory).toLowerCase() !==
        path.resolve(expectedCredentialDirectory).toLowerCase()
    ) {
      throw new Error(
        'Live provider acceptance requires an isolated development profile and database, and may only read the current Noema credential directory.',
      );
    }
    providerCredentialDirectory = expectedCredentialDirectory;
  }
  const legacyFreeLlmApiSecretStore = new EncryptedSecretStore({
    safeStorage,
    filePath: path.join(providerCredentialDirectory, 'freellmapi.key'),
  });
  const modelProviderCredentialPath = path.join(
    providerCredentialDirectory,
    'model-provider.key',
  );
  const providerSecretStore = new EncryptedSecretStore({
    safeStorage,
    filePath: modelProviderCredentialPath,
    fallbackStores: [legacyFreeLlmApiSecretStore],
  });
  const webSearchSecretStore = new EncryptedSecretStore({
    safeStorage,
    filePath: path.join(
      app.getPath('userData'),
      'credentials',
      'web-search.key',
    ),
  });
  const envModelBaseUrl = process.env.NOEMA_MODEL_BASE_URL;
  const injectedModelApiKey = process.env.NOEMA_MODEL_API_KEY;
  const allowIsolatedModelCredential = Boolean(
    testSocialAgentR0FirstUse && testDatabasePath,
  );
  writeSmokeLog('model-provider-credential-source', {
    isolatedCredentialProvided: Boolean(injectedModelApiKey),
    isolatedModelTestEnabled: allowIsolatedModelCredential,
  });
  if (injectedModelApiKey && allowIsolatedModelCredential) {
    providerSecretStore.setConfiguration({
      apiKey: injectedModelApiKey,
      baseUrl: envModelBaseUrl ?? 'https://api.deepseek.com',
    });
  }
  delete process.env.NOEMA_MODEL_API_KEY;
  delete process.env.NOEMA_MODEL_BASE_URL;
  if (process.env.NOEMA_FREELLMAPI_API_KEY) {
    legacyFreeLlmApiSecretStore.set(process.env.NOEMA_FREELLMAPI_API_KEY);
    delete process.env.NOEMA_FREELLMAPI_API_KEY;
  }
  const explicitLegacyBaseUrl = process.env.NOEMA_FREELLMAPI_BASE_URL;
  const hasLegacyFreeLlmApiCredential =
    legacyFreeLlmApiSecretStore.isConfigured();
  const legacyFreeLlmApiBaseUrl = hasLegacyFreeLlmApiCredential
    ? (explicitLegacyBaseUrl ??
      discoverFreeLLMAPIBaseUrl(app.getPath('appData')))
    : null;
  const hasCurrentProviderCredential = fs.existsSync(
    modelProviderCredentialPath,
  );
  const configuredBaseUrl = resolveConfiguredModelBaseUrl({
    hasCurrentProviderCredential,
    currentProviderBaseUrl: providerSecretStore.getBaseUrl(),
    legacyFreeLlmApiBaseUrl,
  });
  const useLegacyFreeLlmApi =
    !hasCurrentProviderCredential && Boolean(legacyFreeLlmApiBaseUrl);
  const provider = new OpenAICompatibleClient({
    baseUrl: configuredBaseUrl,
    legacyFreeRouteMode: useLegacyFreeLlmApi,
    getApiKey: () => providerSecretStore.get() ?? null,
    fetchImpl: (input, init) =>
      net.fetch(input instanceof URL ? input.toString() : input, init),
    onRequestEvent: (event) => {
      recordDiagnosticEvent({
        executionId: event.executionId ?? event.interactionId,
        parentExecutionId: event.parentExecutionId ?? null,
        taskId:
          typeof event.operation === 'string' &&
          ['project_execution', 'member_practice'].includes(event.operation)
            ? (event.interactionId ?? event.executionId)
            : null,
        turnId: event.turnId ?? event.interactionId,
        requestId: event.requestId,
        module: 'provider',
        operation: `request.${event.phase}`,
        status: event.status,
        errorCode: event.errorCode ?? undefined,
        details: {
          requestStatus: event.requestStatus,
          elapsedMs: event.elapsedMs,
        },
      });
    },
    onUsage: (usage) => {
      modelUsageStore.record(usage);
    },
  });
  return {
    provider,
    providerSecretStore,
    modelUsageStore,
    webSearchSecretStore,
  };
}
