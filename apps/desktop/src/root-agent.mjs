import { randomUUID } from 'node:crypto';
import {
  DEFAULT_BASE_URL,
  FreeLLMAPIError,
  normalizeBaseUrl,
} from './freellmapi-client.mjs';

const ROOT_SYSTEM_PROMPT = `你是 Noema，一个面向用户的个人对话 agent。根据用户当前的交流意图回应，不要默认把每句话都变成待解决的问题。用户使用简体中文时使用简体中文。区分已知事实与推测，不声称自己拥有意识、真实情绪或个人经历。`;

export class RootAgent {
  /** @param {{store:import('./root-store.mjs').RootStore,provider:import('./freellmapi-client.mjs').FreeLLMAPIClient,secretStore:{get:()=>string|null,getBaseUrl:()=>string|null,isConfigured:()=>boolean,set:(value:string)=>void,setConfiguration:(input:{apiKey:string,baseUrl:string})=>void,clear:()=>void},emit?:(event:object)=>void}} options */
  constructor({ store, provider, secretStore, emit = () => {} }) {
    this.store = store;
    this.provider = provider;
    this.secretStore = secretStore;
    this.emit = emit;
    this.active = null;
    this.modelState = {
      connected: false,
      models: [],
      error: null,
      checking: true,
    };
    this.store.recoverActiveTurns();
  }

  async getUiState() {
    return {
      ...this.store.getSnapshot(),
      ...this.modelState,
      selectedModel: this.store.getSelectedModel(),
      providerBaseUrl: this.provider.baseUrl ?? DEFAULT_BASE_URL,
      providerConfigured: this.secretStore.isConfigured(),
      providerName: 'FreeLLMAPI',
    };
  }

  async refreshModels() {
    this.modelState = { ...this.modelState, checking: true };
    try {
      const models = await this.provider.listModels();
      this.modelState = {
        connected: true,
        models,
        error:
          models.length === 0
            ? 'FreeLLMAPI 已连接，但当前没有可用的免费模型。'
            : null,
        checking: false,
      };
      if (
        !models.some((model) => model.name === this.store.getSelectedModel())
      ) {
        this.store.setSelectedModel(models[0]?.name ?? null);
      }
    } catch (error) {
      this.modelState = {
        connected: false,
        models: [],
        error:
          error?.message ||
          '无法连接本机 FreeLLMAPI。请启动 FreeLLMAPI 后重试。',
        checking: false,
      };
    }
    this.emit({ type: 'models-updated' });
    return {
      ...this.modelState,
      selectedModel: this.store.getSelectedModel(),
      providerConfigured: this.secretStore.isConfigured(),
      providerBaseUrl: this.provider.baseUrl ?? DEFAULT_BASE_URL,
    };
  }

  async configureProvider({ baseUrl, apiKey }) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new FreeLLMAPIError(
        'credentials_missing',
        '请粘贴 FreeLLMAPI 的统一 API Key。',
      );
    }
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    this.secretStore.setConfiguration({ apiKey, baseUrl: normalizedBaseUrl });
    this.provider.setBaseUrl(normalizedBaseUrl);
    this.emit({ type: 'provider-configured' });
    return this.refreshModels();
  }

  async setModel(name) {
    if (typeof name !== 'string' || !name.trim())
      throw new TypeError('请选择一个 FreeLLMAPI 免费模型');
    const { models } = await this.refreshModels();
    if (!models.some((model) => model.name === name)) {
      throw new FreeLLMAPIError(
        'model_unavailable',
        '这个免费模型当前不可用。刷新列表并选择其他免费模型。',
        404,
      );
    }
    this.store.setSelectedModel(name);
    this.emit({ type: 'model-selected', model: name });
    return name;
  }

  /** @param {{text:string,model?:string|null}} input */
  sendMessage({ text, model = null }) {
    if (typeof text !== 'string' || !text.trim())
      throw new TypeError('消息不能为空');
    const selectedModel = model ?? this.store.getSelectedModel();
    const turn = this.store.beginTurn({
      id: randomUUID(),
      text,
      model: selectedModel,
    });
    this.launch(turn);
    return { turnId: turn.id };
  }

  /** @param {{turnId:string,model?:string|null}} input */
  retryTurn({ turnId, model = null }) {
    const existing = this.store.getTurn(turnId);
    if (!existing) throw new Error('找不到这条对话');
    const selectedModel =
      model ?? this.store.getSelectedModel() ?? existing.model;
    const turn = this.store.retryTurn(turnId, selectedModel);
    this.launch(turn);
    return { turnId: turn.id, attempt: turn.attempt };
  }

  async stopTurn(turnId) {
    const active = this.active;
    if (!active || active.turn.id !== turnId) return false;
    active.controller.abort();
    await active.done;
    return true;
  }

  launch(turn) {
    if (this.active) throw new Error('Noema 正在回复，请先停止当前回复');
    const controller = new AbortController();
    const active = { turn, controller, done: Promise.resolve() };
    this.active = active;
    this.emit({
      type: 'turn-started',
      turnId: turn.id,
      attempt: turn.attempt,
      model: turn.model,
    });
    active.done = this.runTurn(active)
      .catch((error) => {
        this.emit({
          type: 'turn-failed',
          turnId: turn.id,
          attempt: turn.attempt,
          code: 'persistence_error',
          message: '这轮回复未能安全保存。重新打开 Noema 后可检查对话状态。',
        });
        if (error?.message)
          console.error(
            'Noema root turn failed while recording its final state:',
            error.message,
          );
      })
      .finally(() => {
        if (this.active === active) this.active = null;
        this.emit({
          type: 'turn-idle',
          turnId: turn.id,
          attempt: turn.attempt,
        });
      });
  }

  async runTurn(active) {
    const { turn, controller } = active;
    try {
      if (!turn.model) {
        throw new FreeLLMAPIError(
          'model_not_selected',
          '还没有可用的 FreeLLMAPI 免费模型。连接 FreeLLMAPI 并刷新模型列表后，可以重试这条消息。',
        );
      }
      const models = await this.provider.listModels();
      if (!models.some((model) => model.name === turn.model)) {
        throw new FreeLLMAPIError(
          'model_unavailable',
          '所选免费模型当前不可用。刷新模型列表并选择其他免费模型后，可以重试。',
          404,
        );
      }
      const context = this.store.getPromptContext(turn.id);
      this.store.setTurnContext(turn.id, turn.attempt, context);
      this.emit({
        type: 'turn-context',
        turnId: turn.id,
        includedTurns: context.includedTurns,
        omittedTurns: context.omittedTurns,
        historyCharacters: context.historyCharacters,
      });
      const messages = [
        { role: 'system', content: ROOT_SYSTEM_PROMPT },
        ...context.messages,
      ];
      for await (const delta of this.provider.streamChat({
        model: turn.model,
        messages,
        signal: controller.signal,
      })) {
        this.store.appendAssistant({
          id: turn.id,
          attempt: turn.attempt,
          content: delta,
        });
        this.emit({
          type: 'turn-delta',
          turnId: turn.id,
          attempt: turn.attempt,
          delta,
        });
      }
      this.store.completeTurn(turn.id, turn.attempt);
      this.emit({
        type: 'turn-completed',
        turnId: turn.id,
        attempt: turn.attempt,
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        this.store.interruptTurn(turn.id, turn.attempt);
        this.emit({
          type: 'turn-interrupted',
          turnId: turn.id,
          attempt: turn.attempt,
        });
      } else {
        const code =
          typeof error?.code === 'string' ? error.code : 'agent_error';
        const message =
          error instanceof FreeLLMAPIError
            ? error.message
            : '本轮回复没有完成。部分内容已保留，你可以重试。';
        this.store.failTurn(turn.id, turn.attempt, code, message);
        this.emit({
          type: 'turn-failed',
          turnId: turn.id,
          attempt: turn.attempt,
          code,
          message,
        });
      }
    }
  }
}

export { ROOT_SYSTEM_PROMPT };
