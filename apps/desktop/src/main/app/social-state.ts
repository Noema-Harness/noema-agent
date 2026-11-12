import fs from 'node:fs';
import path from 'node:path';

export interface SocialStateRuntimeOptions {
  app: { getPath(name: string): string };
  getRootAgentState: () => Promise<Record<string, unknown>>;
  socialAgentE2eValid: boolean;
  socialWorkEntryE2eValid: boolean;
  testSocialAgentLiveE2e: boolean;
  e2eModel: string;
}

export function createSocialStateRuntime(options: SocialStateRuntimeOptions) {
  const {
    app,
    getRootAgentState,
    socialAgentE2eValid,
    socialWorkEntryE2eValid,
    testSocialAgentLiveE2e,
    e2eModel,
  } = options;

  const getSocialRootState = async () => {
    const state = await getRootAgentState();
    if (
      (!socialAgentE2eValid && !socialWorkEntryE2eValid) ||
      testSocialAgentLiveE2e
    ) {
      return state;
    }
    return {
      ...state,
      connected: true,
      checking: false,
      models: [
        {
          name: e2eModel,
          label: 'E2E 本机测试模型',
          routeKind: 'direct' as const,
          executionStatus: 'ready' as const,
        },
      ],
      selectedModel: e2eModel,
      error: null,
      providerConfigured: true,
    };
  };

  function ensureAgentDirectory({
    agentId,
    name,
  }: {
    agentId: string;
    name: string;
  }): string {
    const base =
      socialAgentE2eValid || socialWorkEntryE2eValid
        ? path.join(app.getPath('userData'), 'agent-workspaces')
        : path.join(app.getPath('documents'), 'Noema', 'Agents');
    const safeName =
      String(name)
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .trim()
        .slice(0, 60) || 'agent';
    const directory = path.join(base, `${safeName}-${agentId.slice(-6)}`);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  return { getSocialRootState, ensureAgentDirectory };
}
