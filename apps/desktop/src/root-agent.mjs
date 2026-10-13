import { randomUUID } from 'node:crypto';
import { OllamaError } from './ollama-client.mjs';

const ROOT_SYSTEM_PROMPT = `你是 Noema，一个运行在用户本机的个人对话 agent。根据用户当前的交流意图回应，不要默认把每句话都变成待解决的问题。用户使用简体中文时使用简体中文。区分已知事实与推测，不声称自己拥有意识、真实情绪或个人经历。`;

export class RootAgent {
  /** @param {{store: import('./root-store.mjs').RootStore, ollama: import('./ollama-client.mjs').OllamaClient, emit?: (event: object) => void}} options */
  constructor({ store, ollama, emit = () => {} }) {
    this.store = store;
    this.ollama = ollama;
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
    };
  }

  async refreshModels() {
    this.modelState = { ...this.modelState, checking: true };
    try {
      const models = await this.ollama.listModels();
      this.modelState = {
        connected: true,
        models,
        error: null,
        checking: false,
      };
      if (!this.store.getSelectedModel() && models.length > 0) {
        this.store.setSelectedModel(models[0].name);
      }
    } catch (error) {
      this.modelState = {
        connected: false,
        models: [],
        error: error?.message || '无法连接本机 Ollama。请启动 Ollama 后重试。',
        checking: false,
      };
    }
    this.emit({ type: 'models-updated' });
    return { ...this.modelState, selectedModel: this.store.getSelectedModel() };
  }

  async setModel(name) {
    if (typeof name !== 'string' || !name.trim())
      throw new TypeError('请选择本机模型');
    const { models } = await this.refreshModels();
    if (!models.some((model) => model.name === name)) {
      throw new OllamaError(
        'model_missing',
        '这个模型当前不在本机。请刷新列表并选择已安装的模型。',
      );
    }
    this.store.setSelectedModel(name);
    this.emit({ type: 'model-selected', model: name });
    return name;
  }

  /** @param {{text: string, model?: string | null}} input */
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

  /** @param {{turnId: string, model?: string | null}} input */
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
        throw new OllamaError(
          'model_not_selected',
          '还没有可用的本机模型。启动 Ollama 并刷新模型列表后，可以重试这条消息。',
        );
      }
      const models = await this.ollama.listModels();
      if (!models.some((model) => model.name === turn.model)) {
        throw new OllamaError(
          'model_missing',
          '所选模型不在本机。刷新模型列表并选择已安装的模型后，可以重试这条消息。',
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
      for await (const delta of this.ollama.streamChat({
        model: turn.model,
        messages,
        signal: controller.signal,
        numCtx: 16_384,
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
          error instanceof OllamaError
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
