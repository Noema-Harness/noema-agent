import { ModelProviderError } from '../providers/openai-compatible-client.mjs';

export class RunMessageWriter {
  constructor({ store, emit, secretStore, getSelectedModel }) {
    this.store = store;
    this.emit = emit;
    this.secretStore = secretStore;
    this.getSelectedModel = getSelectedModel;
  }

  requireReadyModel() {
    if (!this.secretStore.isConfigured()) {
      throw new ModelProviderError(
        'credentials_missing',
        '请先在设置中连接模型服务。',
      );
    }
    const model = this.getSelectedModel();
    if (typeof model !== 'string' || !model.trim()) {
      throw new ModelProviderError(
        'model_unavailable',
        '当前没有可用模型。请刷新模型列表后再试。',
      );
    }
    return model;
  }

  assistantMessageIds(run) {
    return [
      run.assistantMessageId,
      ...(run.mirrorAssistantMessageId ? [run.mirrorAssistantMessageId] : []),
    ];
  }

  appendRunAssistantDelta(run, delta) {
    const ids =
      run.suppressPublicReply && run.mirrorAssistantMessageId
        ? [run.mirrorAssistantMessageId]
        : this.assistantMessageIds(run);
    const written =
      ids.length > 1
        ? this.store.appendAssistantDeltas(ids, delta)
        : this.store.appendAssistantDelta(ids[0], delta);
    if (written && run.mirrorRoomId) {
      this.emit({
        type: 'chat-message-delta',
        roomId: run.mirrorRoomId,
        messageId: run.mirrorAssistantMessageId,
        delta,
      });
    }
    return written;
  }

  appendProjectFormationPartialResult(run) {
    const formation = run.projectFormation;
    if (!formation || formation.partialResultWritten) return false;
    const current = this.store.getSocialMessage(
      run.assistantMessageId,
    )?.content;
    const action = formation.isContinuation
      ? `项目「${formation.title}」已增补成员`
      : formation.isExistingProject
        ? `项目「${formation.title}」已保留`
        : `项目团队「${formation.title}」已建立`;
    const delta = `${current?.trim() ? '\n\n' : ''}${action}；共享计划尚未完成。可在项目群中 @Noema 继续。`;
    if (!this.appendRunAssistantDelta(run, delta)) return false;
    formation.partialResultWritten = true;
    this.emitRunEvent(run, 'chat-message-delta', { delta });
    return true;
  }

  appendProjectResearchSources(run) {
    const sources = run.projectResearchSources ?? [];
    if (!sources.length || run.projectResearchSourcesWritten) return '';
    const lines = sources.map((source) => {
      const title = String(source.title ?? source.url)
        .replace(/[\\[\]]/gu, '\\$&')
        .slice(0, 500);
      return `- [${title}](${source.url}) — 页面正文已读取（${source.fetchedAt}）`;
    });
    const delta =
      '\n\n**已读取来源**（记录页面读取情况，不代表结论已独立核实）\n' +
      lines.join('\n');
    if (!this.appendRunAssistantDelta(run, delta))
      throw new ModelProviderError(
        'reply_not_streaming',
        '研究来源已读取，但公开成果记录未能保存。',
      );
    run.projectResearchSourcesWritten = true;
    this.emitRunEvent(run, 'chat-message-delta', { delta });
    return delta;
  }

  emitRunEvent(run, type, payload = {}) {
    if (!(run.suppressPublicReply && type === 'chat-message-delta'))
      this.emit({
        type,
        roomId: run.roomId,
        messageId: run.assistantMessageId,
        ...payload,
        notifyUser: run.isProjectReportTurn
          ? run.notifyUser === true
          : run.notifyUser === true || run.roomId === 'room-noema',
      });
    if (run.mirrorRoomId) {
      this.emit({
        type,
        roomId: run.mirrorRoomId,
        messageId: run.mirrorAssistantMessageId,
        ...payload,
        notifyUser: false,
      });
    }
  }
}
