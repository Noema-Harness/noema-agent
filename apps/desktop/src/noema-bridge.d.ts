export interface NoemaModel {
  name: string;
  label: string;
  routeKind: 'router' | 'direct';
  executionStatus: 'ready' | 'needsKey' | 'exhausted' | null;
}

export interface NoemaHistorySource {
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  snippet: string;
  redacted: boolean;
}

export interface NoemaRootMessage {
  id: string;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'streaming' | 'interrupted' | 'failed';
  attempt: number;
  model: string | null;
  routedVia: string[];
  routeMetadataStatus: 'unknown' | 'pending' | 'reported' | 'not_reported';
  createdAt: string;
  updatedAt: string;
  turnStatus: 'streaming' | 'completed' | 'interrupted' | 'failed';
  currentAttempt: number;
  contextTurns: number;
  contextOmittedTurns: number;
  contextCharacters: number;
  interactionAdjustmentIds: string[];
  interactionAdjustmentSnapshots: NoemaInteractionAdjustmentSnapshot[];
  historySources: NoemaHistorySource[];
  historySearchStatus: 'not_searched' | 'found' | 'no_match';
  historySourcesIncluded: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

export type NoemaVerificationCheck =
  | { kind: 'file_exists'; path: string }
  | { kind: 'file_contains' | 'file_equals'; path: string; text: string };

export interface NoemaVerificationResult {
  kind: NoemaVerificationCheck['kind'];
  path: string;
  status: 'verified' | 'failed' | 'unavailable';
  reason: string;
  text?: string;
}

export interface NoemaBackgroundTask {
  id: string;
  sourceTurnId: string;
  harness: 'dsh-headless';
  workspacePath: string;
  model: string;
  prompt: string;
  verificationChecks: NoemaVerificationCheck[];
  verificationStatus:
    | 'not_planned'
    | 'pending'
    | 'verified'
    | 'failed'
    | 'unavailable';
  verificationResults: NoemaVerificationResult[];
  verificationAttempts: number;
  interactionAdjustmentIds: string[];
  interactionAdjustmentSnapshots: NoemaInteractionAdjustmentSnapshot[];
  toolActionCategories: Array<
    'read' | 'write' | 'edit' | 'search' | 'list' | 'other'
  >;
  toolActionsTruncated: boolean;
  sessionId: string | null;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'interrupted';
  phase: string;
  toolCallCount: number;
  resultText: string;
  errorCode: string | null;
  errorMessage: string | null;
  eventStatus: 'none' | 'pending' | 'responding' | 'delivered';
  eventCreatedAt: string | null;
  eventDeliveredAt: string | null;
  noemaResponse: string;
  noemaResponseStatus:
    | 'none'
    | 'streaming'
    | 'complete'
    | 'interrupted'
    | 'failed';
  noemaResponseError: string | null;
  noemaResponseModel: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface NoemaRootState {
  messages: NoemaRootMessage[];
  captures: NoemaCapture[];
  workerTasks: NoemaBackgroundTask[];
  contextImports: NoemaContextImport[];
  interactionAdjustments: NoemaInteractionAdjustment[];
  activeTurnId: string | null;
  selectedModel: string | null;
  connected: boolean;
  checking: boolean;
  models: NoemaModel[];
  error: string | null;
  providerConfigured: boolean;
  providerBaseUrl: string;
  providerName: 'FreeLLMAPI';
  workspaceDirectory: string | null;
  dshAvailable: boolean;
  dshWorkerAvailable: boolean;
  dshWorkerError: string | null;
  codexImportAvailable: boolean;
}

export interface NoemaSocialAgent {
  id: string;
  name: string;
  kind: 'core' | 'specialist';
  headline: string;
  description: string;
}

export interface NoemaSocialRoom {
  id: string;
  kind: 'direct' | 'group';
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  messageCount: number;
  memberIds: string[];
  preview: {
    text: string;
    sender: string;
    createdAt: string;
  } | null;
}

export interface NoemaSocialMessage {
  id: string;
  roomId: string;
  turnId: string;
  role: 'user' | 'assistant' | 'system';
  agentId: string | null;
  content: string;
  status: 'complete' | 'streaming' | 'interrupted' | 'failed';
  attempt: number;
  model: string | null;
  runtime: 'freellmapi' | 'local' | 'system';
  errorCode: string | null;
  errorMessage: string | null;
  legacySourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NoemaSocialState = Pick<
  NoemaRootState,
  | 'connected'
  | 'checking'
  | 'models'
  | 'selectedModel'
  | 'error'
  | 'providerConfigured'
  | 'providerBaseUrl'
  | 'providerName'
> & {
  agents: NoemaSocialAgent[];
  rooms: NoemaSocialRoom[];
};

export interface NoemaSocialRoomState {
  room: Pick<
    NoemaSocialRoom,
    'id' | 'kind' | 'title' | 'createdAt' | 'updatedAt'
  >;
  members: NoemaSocialAgent[];
  messages: NoemaSocialMessage[];
}

export type NoemaSocialEvent =
  | { type: 'chat-room-created'; roomId: string }
  | {
      type: 'chat-turn-started';
      turnId: string;
      assistantMessageId: string;
      roomId: string;
      agentId: string;
      model: string | null;
    }
  | {
      type: 'chat-message-delta';
      roomId: string;
      messageId: string;
      delta: string;
    }
  | {
      type:
        | 'chat-turn-completed'
        | 'chat-turn-interrupted'
        | 'chat-turn-failed';
      roomId: string;
      messageId: string;
      message?: string;
      code?: string;
      empty?: boolean;
    }
  | { type: 'chat-state-updated'; roomId: string };

export interface NoemaCapture {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  discussionTurnId: string | null;
}

export interface NoemaInteractionAdjustment {
  id: string;
  sourceTurnId: string;
  scope: 'conversation' | 'coding' | 'both';
  situation: string;
  behavior: string;
  sourceQuote: string;
  originalScope: 'conversation' | 'coding' | 'both' | null;
  originalSituation: string | null;
  originalBehavior: string | null;
  userEdited: boolean;
  editedAt: string | null;
  status: 'active' | 'withdrawn';
  createdAt: string;
  withdrawnAt: string | null;
}

export interface NoemaInteractionAdjustmentSnapshot {
  id: string;
  scope: 'conversation' | 'coding' | 'both';
  situation: string;
  behavior: string;
  sourceQuote: string;
  userEdited: boolean;
  editedAt: string | null;
}

export interface NoemaContextImport {
  id: 'active';
  source: 'codex';
  sourceThreadId: string;
  title: string;
  workingDirectory: string | null;
  sourceUpdatedAt: string | number | null;
  capturedAt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  messageCount: number;
  characterCount: number;
  omittedItems: number;
  omittedTurns: number;
  omittedMessages: number;
  hasMoreTurns: boolean;
  consentedAt: string | null;
}

export interface NoemaCodexThread {
  id: string;
  title: string;
  preview: string;
  cwd: string | null;
  updatedAt: string | number | null;
  modelProvider: string | null;
  status: string;
}

export interface NoemaCodexThreadPage {
  threads: NoemaCodexThread[];
  nextCursor: string | null;
}

export interface NoemaCodexPreview {
  source: 'codex';
  threadId: string;
  title: string;
  cwd: string | null;
  sourceUpdatedAt: string | number | null;
  capturedAt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  omittedItems: number;
  omittedTurns: number;
  omittedMessages: number;
  totalVisibleMessages: number;
  characterCount: number;
  hasMoreTurns: boolean;
  sourceStatus: string;
}

export type NoemaTurnEvent =
  | { type: 'models-updated' | 'provider-configured' }
  | { type: 'context-import-updated' }
  | { type: 'captures-updated' }
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

export type NoemaWorkerEvent =
  | { type: 'workspace-selected'; directory: string }
  | { type: 'workspace-cleared' }
  | { type: 'worker-task-updated'; taskId: string }
  | { type: 'worker-event-started' | 'worker-event-idle'; taskId: string }
  | {
      type: 'worker-event-response-delta';
      taskId: string;
      delta: string;
    }
  | {
      type: 'worker-event-response-failed';
      taskId: string;
      message: string;
    }
  | { type: 'interaction-adjustments-updated' };

export type NoemaRootEvent = NoemaTurnEvent | NoemaWorkerEvent;

export interface NoemaQuickCaptureRequest {
  returnToPrevious: boolean;
}

export interface NoemaQuickCaptureShortcutStatus {
  accelerator: string;
  registered: boolean;
}

export interface NoemaBridge {
  appVersion: string;
  getRootState(): Promise<NoemaRootState>;
  getSocialState(): Promise<NoemaSocialState>;
  getSocialRoom(roomId: string): Promise<NoemaSocialRoomState>;
  createSocialGroup(input: {
    title: string;
    agentIds: string[];
  }): Promise<NoemaSocialRoomState>;
  sendSocialMessage(input: {
    roomId: string;
    agentId: string;
    text: string;
  }): Promise<{ turnId: string; messageId: string }>;
  stopSocialReply(messageId: string): Promise<boolean>;
  retrySocialReply(messageId: string): Promise<{
    turnId: string;
    messageId: string;
  }>;
  refreshModels(): Promise<
    Pick<
      NoemaRootState,
      | 'connected'
      | 'models'
      | 'selectedModel'
      | 'error'
      | 'providerConfigured'
      | 'providerBaseUrl'
    >
  >;
  configureProvider(configuration: {
    baseUrl: string;
    apiKey: string;
  }): Promise<Partial<NoemaRootState>>;
  selectModel(model: string): Promise<string>;
  sendMessage(text: string): Promise<{ turnId?: string; canceled?: boolean }>;
  saveCapture(text: string): Promise<NoemaCapture>;
  updateCapture(id: string, text: string): Promise<NoemaCapture>;
  deleteCapture(id: string): Promise<boolean>;
  discussCapture(id: string): Promise<{ turnId: string }>;
  retryTurn(
    turnId: string,
    model?: string | null,
  ): Promise<{ turnId: string; attempt: number }>;
  stopTurn(turnId: string): Promise<boolean>;
  chooseWorkspace(): Promise<string | null>;
  clearWorkspace(): Promise<null>;
  stopBackgroundTask(taskId: string): Promise<boolean>;
  resumeBackgroundTask(taskId: string): Promise<{
    accepted: boolean;
    taskId?: string;
    sessionId?: string;
    workspacePath?: string;
    errorMessage?: string;
  }>;
  retryBackgroundEvent(taskId: string): Promise<{
    accepted: boolean;
    completed?: boolean;
    errorMessage?: string | null;
  }>;
  listCodexThreads(cursor?: string | null): Promise<NoemaCodexThreadPage>;
  previewCodexThread(threadId: string): Promise<NoemaCodexPreview>;
  importCodexThread(input: {
    threadId: string;
    expectedSourceUpdatedAt: string | number | null;
  }): Promise<NoemaContextImport>;
  removeContextImport(): Promise<boolean>;
  updateInteractionAdjustment(input: {
    id: string;
    scope: 'conversation' | 'coding' | 'both';
    situation: string;
    behavior: string;
  }): Promise<NoemaInteractionAdjustment | null>;
  withdrawInteractionAdjustment(id: string): Promise<boolean>;
  onRootEvent(listener: (event: NoemaRootEvent) => void): () => void;
  onSocialEvent(listener: (event: NoemaSocialEvent) => void): () => void;
  onQuickCaptureRequested(
    listener: (request: NoemaQuickCaptureRequest) => void,
  ): () => void;
  getQuickCaptureShortcutStatus(): Promise<NoemaQuickCaptureShortcutStatus | null>;
  markQuickCaptureReady(): Promise<boolean>;
  finishQuickCapture(): Promise<boolean>;
}

declare global {
  interface Window {
    noema: NoemaBridge;
  }
}
