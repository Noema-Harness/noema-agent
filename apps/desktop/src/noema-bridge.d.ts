export interface NoemaModel {
  name: string;
  size: number | null;
  modifiedAt: string | null;
}

export interface NoemaRootMessage {
  id: string;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'streaming' | 'interrupted' | 'failed';
  attempt: number;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  turnStatus: 'streaming' | 'completed' | 'interrupted' | 'failed';
  currentAttempt: number;
  contextTurns: number;
  contextOmittedTurns: number;
  contextCharacters: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface NoemaRootState {
  messages: NoemaRootMessage[];
  activeTurnId: string | null;
  selectedModel: string | null;
  connected: boolean;
  checking: boolean;
  models: NoemaModel[];
  error: string | null;
}

export type NoemaRootEvent =
  | { type: 'models-updated' }
  | { type: 'model-selected'; model: string }
  | {
      type: 'turn-started';
      turnId: string;
      attempt: number;
      model: string | null;
    }
  | {
      type: 'turn-context';
      turnId: string;
      includedTurns: number;
      omittedTurns: number;
      historyCharacters: number;
    }
  | { type: 'turn-delta'; turnId: string; attempt: number; delta: string }
  | {
      type: 'turn-completed' | 'turn-interrupted';
      turnId: string;
      attempt: number;
    }
  | {
      type: 'turn-failed';
      turnId: string;
      attempt: number;
      code: string;
      message: string;
    }
  | { type: 'turn-idle'; turnId: string; attempt: number };

export interface NoemaBridge {
  appVersion: string;
  getRootState(): Promise<NoemaRootState>;
  refreshModels(): Promise<
    Pick<NoemaRootState, 'connected' | 'models' | 'selectedModel' | 'error'>
  >;
  selectModel(model: string): Promise<string>;
  sendMessage(text: string): Promise<{ turnId: string }>;
  retryTurn(
    turnId: string,
    model?: string | null,
  ): Promise<{ turnId: string; attempt: number }>;
  stopTurn(turnId: string): Promise<boolean>;
  onRootEvent(listener: (event: NoemaRootEvent) => void): () => void;
}

declare global {
  interface Window {
    noema: NoemaBridge;
  }
}
