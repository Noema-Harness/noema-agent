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
  historySources: NoemaSocialHistorySource[];
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
  capabilities: string[];
  archivedAt: string | null;
}

export interface NoemaSocialRoom {
  id: string;
  kind: 'direct' | 'group';
  title: string;
  parentRoomId: string | null;
  originMessageId: string | null;
  closedAt: string | null;
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
  forwardedSources: NoemaSocialForwardedSource[];
  replyTo: NoemaSocialReplySource | null;
  interactionAdjustmentIds: string[];
  interactionAdjustmentSnapshots: NoemaInteractionAdjustmentSnapshot[];
  interactionAdjustmentAttempts: Array<{
    attempt: number;
    interactionAdjustmentIds: string[];
    interactionAdjustmentSnapshots: NoemaInteractionAdjustmentSnapshot[];
  }>;
  historySources: NoemaSocialHistorySource[];
  historySearchStatus: 'not_searched' | 'found' | 'no_match';
  historySourcesIncluded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NoemaSocialSearchResult {
  id: string;
  roomId: string;
  roomTitle: string;
  role: 'user' | 'assistant';
  sender: string;
  content: string;
  forwarded: boolean;
  createdAt: string;
}

export interface NoemaSocialHistorySource {
  id: string;
  roomId: string;
  roomTitle: string;
  role: 'user' | 'assistant';
  createdAt: string;
  snippet: string;
  redacted: boolean;
}

export interface NoemaSocialForwardedSource {
  id: string;
  roomId: string;
  roomTitle: string;
  role: 'user' | 'assistant';
  sender: string;
  createdAt: string;
  content: string;
}

export interface NoemaSocialReplySource {
  id: string;
  roomId: string;
  role: 'user' | 'assistant';
  sender: string;
  createdAt: string;
  content: string;
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
  interactionAdjustments: NoemaInteractionAdjustment[];
  agents: NoemaSocialAgent[];
  rooms: NoemaSocialRoom[];
  projects: NoemaSocialProject[];
  projectWork: { available: boolean; reason: string | null };
};

export interface NoemaSocialProject {
  id: string;
  title: string;
  brief: string;
  status: 'active' | 'awaiting_user' | 'archived';
  originRoomId: string;
  sourceMessageId: string | null;
  groupRoomId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  lastActivityAt: string;
  members: Array<{
    agentId: string;
    sessionRoomId: string;
    status: 'active' | 'removed';
    joinedAt: string;
    removedAt: string | null;
    name: string;
    headline: string;
    kind: 'noema' | 'specialist';
    agentArchivedAt: string | null;
  }>;
}

export interface NoemaSocialProjectSession {
  project: Pick<NoemaSocialProject, 'id' | 'title' | 'brief' | 'status'>;
  agentId: string;
  room: NoemaSocialRoomState;
}

export interface NoemaSocialWorkTask {
  id: string;
  roomId: string;
  agentId: string;
  sourceMessageId: string | null;
  workspacePath: string;
  executionEngine: string;
  taskPrompt: string;
  status:
    | 'starting'
    | 'running'
    | 'verifying'
    | 'completed'
    | 'failed'
    | 'interrupted';
  phase: string | null;
  toolCallCount: number;
  toolActionCategories: string[];
  executionSteps: Array<{
    id: string;
    ordinal: number;
    externalCallId: string | null;
    toolName: string;
    category: 'read' | 'search' | 'write' | 'edit' | 'command' | 'other';
    hasSideEffect: boolean;
    status:
      | 'running'
      | 'succeeded'
      | 'failed'
      | 'outcome_unknown'
      | 'interrupted';
    effectStatus: 'none' | 'pending' | 'applied' | 'not_applied' | 'unknown';
    startedAt: string;
    completedAt: string | null;
  }>;
  resultText: string;
  errorCode: string | null;
  errorMessage: string | null;
  verificationStatus:
    | 'not_planned'
    | 'pending'
    | 'verified'
    | 'failed'
    | 'unavailable';
  verificationResults: Array<Record<string, unknown>>;
  verificationAttempts: number;
  caseEligible: boolean;
  caseSnapshot: {
    taskId: string;
    roomId: string;
    roomTitle: string;
    completedAt: string;
    taskPrompt: string;
    resultText: string;
    toolActionCategories: string[];
    verificationChecks: Array<{
      kind: string;
      path: string;
      status: 'verified' | 'unknown';
    }>;
  } | null;
  caseReuseRequested: boolean;
  practiceCandidateStatus:
    | 'not_requested'
    | 'none'
    | 'pending'
    | 'available'
    | 'trialing'
    | 'trialed'
    | 'revoked'
    | 'failed';
  practiceCandidate: {
    trigger: string;
    action: string;
    limits: string;
    basisTaskId: string;
    basisRoomId: string;
    basisRoomTitle: string;
    basisTaskPrompt: string;
    proposedAt: string;
  } | null;
  practiceBasisTaskId: string | null;
  practiceTrialTaskId: string | null;
  practiceTrialTaskStatus: NoemaSocialWorkTask['status'] | null;
  practiceTrialVerificationStatus:
    | NoemaSocialWorkTask['verificationStatus']
    | null;
  practiceSnapshot: {
    sourceTaskId: string;
    basisTaskId: string;
    basisRoomId: string;
    basisRoomTitle: string;
    basisTaskPrompt: string;
    roomId: string;
    roomTitle: string;
    completedAt: string;
    trigger: string;
    action: string;
    limits: string;
    proposedAt: string;
  } | null;
  interactionAdjustmentIds: string[];
  interactionAdjustmentSnapshots: NoemaInteractionAdjustmentSnapshot[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface NoemaSocialRoomState {
  room: Pick<
    NoemaSocialRoom,
    | 'id'
    | 'kind'
    | 'title'
    | 'parentRoomId'
    | 'originMessageId'
    | 'closedAt'
    | 'createdAt'
    | 'updatedAt'
  >;
  members: NoemaSocialAgent[];
  messages: NoemaSocialMessage[];
  workTasks: NoemaSocialWorkTask[];
}

export type NoemaSocialEvent =
  | { type: 'chat-room-created'; roomId: string }
  | { type: 'project-updated'; projectId: string; groupRoomId: string }
  | { type: 'agent-state-updated'; agentId: string }
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
  | { type: 'chat-state-updated'; roomId: string }
  | {
      type: 'project-work-updated';
      roomId: string;
      task: NoemaSocialWorkTask;
    };

export interface NoemaCapture {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  discussionTurnId: string | null;
}

export interface NoemaInteractionAdjustment {
  id: string;
  sourceSurface: 'root' | 'social';
  sourceRoomId: string | null;
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
  sourceSurface: 'root' | 'social';
  sourceRoomId: string | null;
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
  searchSocialMessages(query: string): Promise<NoemaSocialSearchResult[]>;
  createSocialGroup(input: {
    title: string;
    agentIds: string[];
  }): Promise<NoemaSocialRoomState>;
  createSocialProject(input: {
    title: string;
    brief: string;
    agentIds: string[];
    originRoomId?: string;
    sourceMessageId?: string | null;
  }): Promise<NoemaSocialProject>;
  getSocialProjectSession(
    projectId: string,
    agentId: string,
  ): Promise<NoemaSocialProjectSession>;
  archiveSocialProject(projectId: string): Promise<NoemaSocialProject>;
  restoreSocialProject(projectId: string): Promise<NoemaSocialProject>;
  createSocialContinuationThread(input: {
    sourceRoomId: string;
    sourceIds: string[];
    title: string;
  }): Promise<NoemaSocialRoomState>;
  setSocialContinuationThreadClosed(
    roomId: string,
    closed: boolean,
  ): Promise<NoemaSocialRoomState>;
  deleteSocialContinuationThread(roomId: string): Promise<{
    parentRoomId: string;
  }>;
  createSocialAgent(input: {
    name: string;
    headline: string;
    description: string;
    projectWork: boolean;
  }): Promise<NoemaSocialRoomState>;
  updateSocialAgentProfile(input: {
    agentId: string;
    name: string;
    headline: string;
    description: string;
  }): Promise<NoemaSocialAgent>;
  setSocialAgentProjectWork(
    agentId: string,
    enabled: boolean,
  ): Promise<NoemaSocialAgent>;
  setSocialAgentArchived(
    agentId: string,
    archived: boolean,
  ): Promise<NoemaSocialAgent>;
  sendSocialMessage(input: {
    roomId: string;
    agentId: string;
    text: string;
    replyToMessageId?: string | null;
  }): Promise<{ turnId: string; messageId: string }>;
  forwardSocialMessages(input: {
    targetRoomId: string;
    sourceRoomId: string;
    sourceIds: string[];
  }): Promise<{ messageId: string; roomId: string }>;
  stopSocialReply(messageId: string): Promise<boolean>;
  retrySocialReply(messageId: string): Promise<{
    turnId: string;
    messageId: string;
  }>;
  startSocialWorkTask(input: {
    roomId: string;
    agentId: string;
    prompt: string;
    reuseCase: boolean;
  }): Promise<{
    accepted: boolean;
    taskId?: string;
    roomId?: string;
    reason?: string;
  }>;
  stopSocialWorkTask(taskId: string): Promise<boolean>;
  setSocialWorkCaseEligible(
    taskId: string,
    eligible: boolean,
  ): Promise<NoemaSocialWorkTask>;
  withdrawSocialPracticeCandidate(taskId: string): Promise<NoemaSocialWorkTask>;
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
  addSocialInteractionAdjustment(input: {
    sourceTurnId: string;
    sourceRoomId: string;
    scope: 'conversation' | 'coding' | 'both';
    situation: string;
    behavior: string;
    sourceQuote: string;
  }): Promise<NoemaInteractionAdjustment>;
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
