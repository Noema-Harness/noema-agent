export class ChatUiState {
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
        const revision = this.projectStore.plans.get(project.id).revision;
        if (
          project.status === 'active' &&
          project.growthBatch?.status !== 'running' &&
          revision &&
          this.reconciledPlans.get(project.id) !== revision
        ) {
          this.collaboration.planChanged(project.id);
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
