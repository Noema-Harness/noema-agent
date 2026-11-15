import type { NoemaProviderState } from '../../shared/contracts/noema-bridge.d.ts';

type ProjectWorkReadiness = {
  available: boolean;
  reasonCode: string | null;
  reason: string | null;
};

export class ChatUiState {
  declare getRootState: () => Promise<NoemaProviderState>;
  declare getProjectWorkReadiness: () => ProjectWorkReadiness;
  declare finalizeGrowth: () => unknown;
  declare projectStore:
    | import('../projects/social-project-store.mjs').SocialProjectStore
    | null;
  declare collaboration:
    | import('../projects/project-collaboration-store.mjs').ProjectCollaborationStore
    | null;
  /** Plan revision last reconciled per project id. */
  declare reconciledPlans: Map<string, number>;
  declare scheduleInboxes: () => void;
  declare scheduleReports: () => void;
  declare scheduleGrowth: () => void;
  declare getSnapshot: () => ReturnType<
    import('./social-chat-store.mjs').SocialChatStore['getSnapshot']
  >;

  constructor({
    getRootState,
    getProjectWorkReadiness,
    finalizeGrowth,
    projectStore,
    collaboration,
    reconciledPlans,
    scheduleInboxes,
    scheduleReports,
    scheduleGrowth,
    getSnapshot,
  }: {
    getRootState: ChatUiState['getRootState'];
    getProjectWorkReadiness: ChatUiState['getProjectWorkReadiness'];
    finalizeGrowth: ChatUiState['finalizeGrowth'];
    projectStore: ChatUiState['projectStore'];
    collaboration: ChatUiState['collaboration'];
    reconciledPlans: ChatUiState['reconciledPlans'];
    scheduleInboxes: ChatUiState['scheduleInboxes'];
    scheduleReports: ChatUiState['scheduleReports'];
    scheduleGrowth: ChatUiState['scheduleGrowth'];
    getSnapshot: ChatUiState['getSnapshot'];
  }) {
    this.getRootState = getRootState;
    this.getProjectWorkReadiness = getProjectWorkReadiness;
    this.finalizeGrowth = finalizeGrowth;
    this.projectStore = projectStore;
    this.collaboration = collaboration;
    this.reconciledPlans = reconciledPlans;
    this.scheduleInboxes = scheduleInboxes;
    this.scheduleReports = scheduleReports;
    this.scheduleGrowth = scheduleGrowth;
    this.getSnapshot = getSnapshot;
  }

  async getUiState() {
    const root = await this.getRootState();
    let projectWork = this.getProjectWorkReadiness();
    if (projectWork.available && root.checking === true) {
      projectWork = {
        available: false,
        reasonCode: 'provider_checking',
        reason: '正在检查模型服务连接，请稍后刷新。',
      };
    } else if (projectWork.available && root.connected === false) {
      projectWork = {
        available: false,
        reasonCode: 'provider_unavailable',
        reason: '模型服务当前未连接，请检查地址、网络和凭据。',
      };
    } else if (
      projectWork.available &&
      Array.isArray(root.models) &&
      !root.models.some((model) => model.name === root.selectedModel)
    ) {
      projectWork = {
        available: false,
        reasonCode: 'model_unavailable',
        reason: '当前选定模型不在可用列表中，请刷新模型列表并重新选择。',
      };
    }
    this.finalizeGrowth();
    if (root.providerConfigured && root.selectedModel) {
      for (const project of this.projectStore?.listProjects({
        includeArchived: false,
      }) ?? []) {
        // Inside this loop projectStore is non-null, and collaboration is built
        // whenever projectStore exists (SocialChatService constructor).
        const revision = this.projectStore!.plans.get(project.id).revision;
        if (
          project.status === 'active' &&
          project.growthBatch?.status !== 'running' &&
          revision &&
          this.reconciledPlans.get(project.id) !== revision
        ) {
          this.collaboration!.planChanged(project.id);
          this.reconciledPlans.set(project.id, revision);
        }
      }
      this.scheduleInboxes();
      this.scheduleReports();
      this.scheduleGrowth();
    }
    return {
      connected: root.connected,
      checking: root.checking,
      models: root.models,
      selectedModel: root.selectedModel,
      error: root.error,
      providerConfigured: root.providerConfigured,
      providerBaseUrl: root.providerBaseUrl,
      providerName: root.providerName,
      webSearchConfigured: root.webSearchConfigured,
      projectWork,
      ...this.getSnapshot(),
    };
  }
}
