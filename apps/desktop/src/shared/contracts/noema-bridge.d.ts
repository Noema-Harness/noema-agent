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

export interface NoemaExternalSource {
  id: string;
  citationId?: string;
  title: string;
  url: string;
  fetchedAt: string;
  excerpt: string;
  truncated: boolean;
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
  externalSources: NoemaExternalSource[];
  externalSourcesIncluded: boolean;
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

export interface NoemaProviderState {
  selectedModel: string | null;
  connected: boolean;
  checking: boolean;
  models: NoemaModel[];
  error: string | null;
  providerConfigured: boolean;
  providerBaseUrl: string;
  providerName: string;
  webSearchConfigured: boolean;
}

export interface NoemaRootState extends NoemaProviderState {
  messages: NoemaRootMessage[];
  workerTasks: NoemaBackgroundTask[];
  contextImports: NoemaContextImport[];
  interactionAdjustments: NoemaInteractionAdjustment[];
  activeTurnId: string | null;
  workspaceDirectory: string | null;
  dshAvailable: boolean;
  dshWorkerAvailable: boolean;
  dshWorkerError: string | null;
  codexImportAvailable: boolean;
}

export interface NoemaDiagnosticExecution {
  executionId: string;
  taskId: string | null;
  turnId: string | null;
  module: string;
  operation: string;
  status: string;
  occurredAt: string;
  eventCount: number;
  usageRequestCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  usageReported: boolean;
}

export interface NoemaDiagnosticEvent {
  eventId: string;
  schemaVersion: number;
  occurredAt: string;
  applicationExecutionId: string;
  executionId: string | null;
  parentExecutionId: string | null;
  taskId: string | null;
  turnId: string | null;
  requestId: string | null;
  toolCallId: string | null;
  module: string;
  operation: string;
  status: string;
  errorCode: string | null;
  details: Record<string, string | number | boolean>;
  detailsStatus: 'complete' | 'filtered' | 'unavailable';
}

export interface NoemaDiagnosticUsage {
  createdAt: string;
  providerHost: string;
  model: string;
  operation: string;
  interactionId: string | null;
  requestId: string | null;
  executionId: string | null;
  turnId: string | null;
  requestStatus: string;
  usageReceived: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheMissTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  requestCharacters: number | null;
  messageRoleCharacters: {
    system: number;
    developer: number;
    user: number;
    assistant: number;
    tool: number;
    other: number;
  } | null;
  toolDefinitionCharacters: number | null;
  messageCount: number | null;
  toolCount: number | null;
}

export interface NoemaDiagnosticTimeline {
  available: boolean;
  runtime: NoemaDiagnosticRuntimeInfo | null;
  executionId: string | null;
  taskId: string | null;
  events: NoemaDiagnosticEvent[];
  usage: NoemaDiagnosticUsage[];
  task: {
    id: string;
    status: string;
    verificationStatus: string | null;
    errorCode: string | null;
    executionEngine: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    completedAt: string | null;
    executionSteps: Array<{
      index: number | null;
      category: string | null;
      status: string | null;
      effectStatus: string | null;
      errorCode: string | null;
    }>;
  } | null;
  coverageGaps: string[];
  truncated: boolean;
  diagnostics: Record<string, unknown>;
}

export interface NoemaDiagnosticRuntimeInfo {
  applicationVersion: string | null;
  electronVersion: string | null;
  nodeVersion: string | null;
  osVersion: string | null;
  platform: string | null;
  architecture: string | null;
  isPackaged: boolean;
  socialSchemaVersion: number | null;
  diagnosticsSchemaVersion: number | null;
}

export interface NoemaDiagnosticExportPreview {
  previewId: string;
  schemaVersion: number;
  executionId: string | null;
  taskId: string | null;
  eventCount: number;
  usageCount: number;
  included: string[];
  excluded: string[];
  coverageGaps: string[];
  truncated: boolean;
  includesTestContext: boolean;
  testContextTruncated: boolean;
  testContextRedacted: boolean;
  reportJson: string;
}

export interface NoemaWindowsRunnerCapability {
  platform: 'win32' | 'not_applicable';
  supported: boolean;
  backendReady: boolean;
  status: 'ready' | 'unavailable' | 'not_applicable';
  reasonCode: string | null;
  reasonCodes: string[];
  setupActionAvailable: boolean;
  backendId: string | null;
  backendVersion: string | null;
  policyVersion: number | null;
  protocolVersion: number | null;
  setupStatus: 'ready' | 'unavailable' | 'not_applicable';
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
  senderAgentId: string | null;
  content: string;
  status: 'complete' | 'streaming' | 'interrupted' | 'failed';
  attempt: number;
  model: string | null;
  runtime: 'provider' | 'freellmapi' | 'local' | 'system';
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
  deliveryStatus?: 'queued';
  deliveryAgentId?: string;
  deliveryAgentIds?: string[];
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

export interface NoemaPersonalMemory {
  id: string;
  content: string;
  sourceKind: 'manual' | 'message';
  sourceRoomId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  sourceRoomTitle: string | null;
  sourceMessageCreatedAt: string | null;
  sourceMessageStatus?: string | null;
}

export interface NoemaPersonalMemoryList {
  enabled: boolean;
  items: NoemaPersonalMemory[];
}

export interface NoemaUserFollowup {
  id: string;
  title: string;
  body: string;
  dueAt: string;
  status: 'pending' | 'delivering' | 'delivered' | 'canceled';
  sourceRoomId: string | null;
  sourceMessageId: string | null;
  deliveryLeaseUntil: string | null;
  deliveredAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sourceRoomTitle: string | null;
  sourceMessageCreatedAt: string | null;
}

export interface NoemaUserFollowupList {
  enabled: boolean;
  items: NoemaUserFollowup[];
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

export interface NoemaFirstMeetingState {
  version: number;
  stage: 'letter' | 'encounter' | 'complete';
  introducedAt: string | null;
  enteredAt: string | null;
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
  | 'webSearchConfigured'
> & {
  firstMeeting: NoemaFirstMeetingState;
  interactionAdjustments: NoemaInteractionAdjustment[];
  agents: NoemaSocialAgent[];
  rooms: NoemaSocialRoom[];
  projects: NoemaSocialProject[];
  projectWork: {
    available: boolean;
    reasonCode:
      | 'app_shutting_down'
      | 'executor_unavailable'
      | 'provider_unconfigured'
      | 'model_unselected'
      | 'provider_checking'
      | 'provider_unavailable'
      | 'model_unavailable'
      | null;
    reason: string | null;
  };
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
  pendingReview: {
    id: string;
    requestMessageId: string;
    roomId: string;
  } | null;
  growthBatch: {
    id: string;
    planRevision: number;
    status: 'running' | 'completed';
    completedAt: string | null;
    finalizedAt: string | null;
    members: Array<{
      agentId: string;
      agentName: string;
      status:
        | 'pending'
        | 'running'
        | 'completed'
        | 'no_change'
        | 'interrupted'
        | 'failed';
      errorMessage: string | null;
    }>;
  } | null;
  unfinished: {
    queuedDeliveries: number;
    pendingReports: number;
    streamingReplies: number;
    runningTasks: number;
    unfinishedPlanItems: number;
    evidenceItems: number;
  };
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

export type NoemaProjectPlanStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'submitted'
  | 'done'
  | 'canceled';
export interface NoemaProjectPlanItem {
  id: string;
  kind: 'group' | 'work_package';
  parentId: string | null;
  depth?: number;
  childCount?: number;
  childProgress?: { done: number; total: number; percentage: number | null };
  title: string;
  ownerAgentId: string;
  acceptance: string;
  dependsOn: string[];
  relatedTo: string[];
  relatedItems?: Array<{
    id: string;
    title: string;
    status: NoemaProjectPlanStatus;
  }>;
  status: NoemaProjectPlanStatus;
  evidence: string;
  evidenceRefs?: Array<{
    source:
      | { kind: 'message'; messageId: string }
      | { kind: 'execution'; taskId: string; stepId?: string }
      | { kind: 'file'; taskId: string; path: string };
    fingerprint: string;
    observedAt: string;
    label: string;
    sourceAuthorId: string | null;
    sourceStatus: string;
  }>;
  reviewerIds: string[];
  evidenceReviews: Array<{
    actorId: string;
    decision: 'approved' | 'changes_requested';
    reviewedAt: string;
    submissionRevision: number;
    reason: string;
  }>;
  evidenceReview?: {
    actorId: string;
    reviewedAt: string;
    submissionRevision: number;
  } | null;
  submittedByAgentId?: string | null;
  submittedAt?: string | null;
  submissionRevision?: number | null;
  acceptanceRecorded?: boolean;
  blocker: string;
  phaseId: string;
  phaseTitle: string;
  ready: boolean;
  canResume?: boolean;
  blockedBy: string[];
  waitingForPhases: string[];
}
export type NoemaProjectPlanPhaseStatus = 'pending' | 'done' | 'canceled';
export type NoemaProjectPlanPhaseState =
  | 'needs_breakdown'
  | 'waiting'
  | 'ready'
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'awaiting_review'
  | 'done'
  | 'canceled';
export interface NoemaProjectPlanPhase {
  id: string;
  title: string;
  outcome: string;
  exitCriteria: string;
  dependsOn: string[];
  status: NoemaProjectPlanPhaseStatus;
  evidence: string;
  workItems: NoemaProjectPlanItem[];
  waitingForPhases: string[];
  state: NoemaProjectPlanPhaseState;
  progress: {
    done: number;
    total: number;
    percentage: number | null;
    submitted: number;
    canceled: number;
  };
}
export interface NoemaProjectPlan {
  projectId: string;
  revision: number;
  stage: string;
  objective: string;
  phases: NoemaProjectPlanPhase[];
  items: NoemaProjectPlanItem[];
  phaseProgress: {
    done: number;
    total: number;
    percentage: number | null;
    canceled: number;
  };
  progress: {
    done: number;
    total: number;
    percentage: number | null;
    submitted: number;
    canceled: number;
  };
  updatedAt: string | null;
  reason: string | null;
}
export interface NoemaProjectPlanWrite {
  projectId: string;
  expectedRevision: number;
  reason: string;
  plan: {
    objective: string;
    phases: Array<{
      id: string;
      title: string;
      outcome: string;
      exitCriteria: string;
      dependsOn: string[];
      status: NoemaProjectPlanPhaseStatus;
      evidence: string;
      workItems: Array<
        Omit<
          NoemaProjectPlanItem,
          'phaseId' | 'phaseTitle' | 'ready' | 'blockedBy' | 'waitingForPhases'
        >
      >;
    }>;
  };
}
export interface NoemaProjectPlanItemUpdate {
  projectId: string;
  expectedRevision: number;
  itemId: string;
  status: NoemaProjectPlanStatus;
  evidence?: string;
  evidenceSources?: Array<
    NonNullable<NoemaProjectPlanItem['evidenceRefs']>[number]['source']
  >;
  blocker?: string;
  reviewDecision?: 'approve' | 'request_changes';
  reviewReason?: string;
  patch?: {
    title?: string;
    ownerAgentId?: string;
    acceptance?: string;
    parentId?: string | null;
    dependsOn?: string[];
    relatedTo?: string[];
    reviewerIds?: string[];
  };
  reason: string;
}
export interface NoemaProjectPlanPhaseUpdate {
  projectId: string;
  expectedRevision: number;
  phaseId: string;
  status: NoemaProjectPlanPhaseStatus;
  evidence?: string;
  reason: string;
}

export interface NoemaSocialProjectReview {
  id: string;
  projectId: string;
  projectTitle: string;
  roomId: string;
  requestMessageId: string;
  question: string;
  status: 'pending' | 'answered';
  feedback: string | null;
  feedbackMessageId: string | null;
  createdAt: string;
  respondedAt: string | null;
}

export interface NoemaSocialProjectSession {
  project: Pick<NoemaSocialProject, 'id' | 'title' | 'brief' | 'status'>;
  agentId: string;
  room: NoemaSocialRoomState;
}

export interface NoemaSocialWorkCommandBatch {
  id: string;
  stepId: string;
  status:
    | 'preparing'
    | 'running'
    | 'collecting'
    | 'syncing'
    | 'completed'
    | 'partial'
    | 'conflict'
    | 'not_applied'
    | 'unknown';
  reasonCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoemaWorkspaceFileEntry {
  name: string;
  kind: 'file' | 'directory';
  relativePath: string;
}

export interface NoemaWorkspaceFileListing {
  root: string;
  relativePath: string;
  entries: NoemaWorkspaceFileEntry[];
  truncated: boolean;
}

export interface NoemaWorkspaceFilePreview {
  relativePath: string;
  size: number;
  content: string;
}

export interface NoemaWorkspaceImagePreview {
  relativePath: string;
  size: number;
  mime: string;
  dataBase64: string;
}

export interface NoemaWorkspaceSearchMatch {
  relativePath: string;
  kind: 'name' | 'content';
  line: number;
  excerpt: string;
}

export interface NoemaWorkspaceSearchResult {
  root: string;
  query: string;
  matches: NoemaWorkspaceSearchMatch[];
  truncated: boolean;
  scannedFiles: number;
}

export interface NoemaSocialWorkTask {
  id: string;
  roomId: string;
  agentId: string;
  sourceMessageId: string | null;
  workspacePath: string;
  executionEngine: string;
  runtimeSessionId: string | null;
  canResume: boolean;
  resumeBlockReason: string | null;
  taskPrompt: string;
  status:
    | 'starting'
    | 'running'
    | 'verifying'
    | 'completed'
    | 'failed'
    | 'interrupted';
  phase:
    | 'starting'
    | 'running'
    | 'model_request'
    | 'model_response'
    | 'tool_requested'
    | 'tool_call'
    | 'awaiting_authorization'
    | 'retry_waiting_rate_limit'
    | 'verifying'
    | 'completed'
    | 'failed'
    | 'interrupted'
    | 'unknown'
    | null;
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
    detail?: string | null;
    output?: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
  fileChanges: NoemaSocialWorkFileChange[];
  commandBatches: NoemaSocialWorkCommandBatch[];
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

export interface NoemaSocialWorkUsage {
  requests: number;
  usageReportedRequests: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  models: string[];
}

export interface NoemaSocialWorkStepDetail {
  id: string;
  taskId: string;
  ordinal: number;
  toolName: string;
  argumentsText: string;
  resultText: string;
}

export interface NoemaSocialWorkTouchedFile {
  path: string;
  toolName: string;
  ordinal: number;
}

export interface NoemaConversationExportResult {
  saved: boolean;
  path?: string;
  canceled?: boolean;
  errorCode?: string;
}

export interface NoemaSocialWorkFileChange {
  id: string;
  relativePath: string;
  originalExists: boolean;
  originalHash: string | null;
  latestHash: string | null;
  diffText: string;
  diffTruncated: boolean;
  state:
    | 'pending'
    | 'applied'
    | 'unknown'
    | 'not_applied'
    | 'kept'
    | 'reverted'
    | 'conflict';
  origin: 'file_tool' | 'command';
  commandBatchId: string | null;
  lastStepId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoemaSocialWorkGitReview {
  available: boolean;
  reason?: string;
  source?: 'current_workspace';
  files: Array<{
    relativePath: string;
    status: string;
    diffText: string;
    diffTruncated: boolean;
  }>;
}

export interface SocialConversationThread {
  id: string;
  startedAt: string;
  endedAt: string | null;
  title: string;
  messageCount: number;
  updatedAt: string;
}

export interface SocialConversationBranch {
  id: string;
  roomId: string;
  agentId: string | null;
  title: string;
  origin: 'main' | 'fork' | 'legacy';
  readOnly: boolean;
  parentBranchId: string | null;
  forkedFromTurnId: string | null;
  headTurnId: string | null;
  headVersion: number;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SocialContinuityState {
  mode: 'off' | 'shadow' | 'on';
  roomId: string;
  activeBranchId: string | null;
  activeVersion: number;
  activeBranch: SocialConversationBranch | null;
  branches: SocialConversationBranch[];
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
  messageWindow?: {
    oldestSequence: string | null;
    newestSequence: string | null;
    hasEarlier: boolean;
    hasLater: boolean;
    targetFound: boolean | null;
  };
  projectReviews?: NoemaSocialProjectReview[];
  workTasks: NoemaSocialWorkTask[];
}

export type NoemaSocialEvent =
  | { type: 'chat-room-created'; roomId: string; navigate?: boolean }
  | {
      type: 'open-followup-source';
      roomId: string;
      messageId: string | null;
    }
  | { type: 'project-updated'; projectId: string; groupRoomId: string }
  | {
      type: 'project-growth-archived';
      projectId: string;
      groupRoomId: string;
      title: string;
    }
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
      type: 'chat-trace';
      roomId: string;
      messageId: string;
      taskId?: string;
      event: {
        type: 'tool_call' | 'tool_result';
        name: string | null;
        status: string | null;
        stepId?: string | null;
        detail?: string | null;
        output?: string | null;
      };
    }
  | {
      type:
        | 'chat-turn-completed'
        | 'chat-turn-interrupted'
        | 'chat-turn-failed';
      roomId: string;
      messageId: string;
      notifyUser?: boolean;
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

export type NoemaModelStateEvent =
  | { type: 'models-updated' | 'provider-configured' | 'web-search-configured' }
  | { type: 'model-selected'; model: string };

export type NoemaLegacyHistoryCategory =
  | 'root-turns'
  | 'root-messages'
  | 'dsh-tasks'
  | 'captures'
  | 'context-imports'
  | 'interaction-adjustments';

export interface NoemaLegacyHistoryCategoryInfo {
  id: NoemaLegacyHistoryCategory;
  count: number;
}

export interface NoemaLegacyHistoryRecord {
  id: string;
  category: NoemaLegacyHistoryCategory;
  legacyOwner: 'legacy-root' | 'legacy-dsh' | 'legacy-codex';
  recordStatus: 'complete' | 'partial';
  truncatedFields: string[];
  [key: string]: unknown;
}

export interface NoemaLegacyHistoryPage {
  category: NoemaLegacyHistoryCategory;
  records: NoemaLegacyHistoryRecord[];
  nextCursor: number | null;
  hasMore: boolean;
  status: 'available' | 'unavailable';
}

export interface NoemaLegacyHistoryExportPreview {
  previewId: string;
  format: 'noema-legacy-history-v1';
  createdAt: string;
  categories: Array<{
    id: NoemaLegacyHistoryCategory;
    count: number;
    sample: NoemaLegacyHistoryRecord | null;
  }>;
  totalRecords: number;
}

export interface NoemaExecutionPermissions {
  externalFiles: 'read-only' | 'ask' | 'allow';
}

export interface NoemaBridge {
  controlWindow(
    action: 'minimize' | 'maximize' | 'close' | 'state',
  ): Promise<boolean>;
  onWindowStateChanged(listener: (maximized: boolean) => void): () => void;
  appVersion: string;
  getLegacyHistoryCategories(): Promise<NoemaLegacyHistoryCategoryInfo[]>;
  getLegacyHistoryPage(input: {
    category: NoemaLegacyHistoryCategory;
    cursor?: number | null;
    limit?: number;
  }): Promise<NoemaLegacyHistoryPage>;
  previewLegacyHistoryExport(input: {
    categories: NoemaLegacyHistoryCategory[];
  }): Promise<NoemaLegacyHistoryExportPreview>;
  saveLegacyHistoryExport(previewId: string): Promise<{
    saved: boolean;
    canceled: boolean;
    errorCode: string | null;
  }>;
  getSocialState(): Promise<NoemaSocialState>;
  getExecutionPermissions(): Promise<NoemaExecutionPermissions>;
  setExecutionPermissions(
    permissions: Partial<NoemaExecutionPermissions>,
  ): Promise<NoemaExecutionPermissions>;
  getWindowsRunnerCapability(): Promise<NoemaWindowsRunnerCapability>;
  setupWindowsRunner(): Promise<{
    supported: boolean;
    canceled: boolean;
    reasonCode: string | null;
  }>;
  onWindowsRunnerCapabilityChanged(
    listener: (state: NoemaWindowsRunnerCapability) => void,
  ): () => void;
  getDiagnosticsRecent(limit?: number): Promise<{
    available: boolean;
    executions: NoemaDiagnosticExecution[];
    diagnostics: Record<string, unknown>;
    runtime: NoemaDiagnosticRuntimeInfo | null;
  }>;
  getDiagnosticsDatabaseHealth(): Promise<
    'healthy' | 'problem' | 'unavailable'
  >;
  openUserDataDirectory(): Promise<{
    opened: boolean;
    errorCode: string | null;
  }>;
  getDiagnosticsTimeline(input: {
    executionId?: string | null;
    taskId?: string | null;
    limit?: number;
  }): Promise<NoemaDiagnosticTimeline>;
  previewDiagnosticsExport(input: {
    executionId?: string | null;
    taskId?: string | null;
    includeTestContext?: boolean;
  }): Promise<NoemaDiagnosticExportPreview>;
  saveDiagnosticsExport(previewId: string): Promise<{
    saved: boolean;
    canceled?: boolean;
    fileName?: string;
    errorCode?: string;
  }>;
  getPersonalMemories(): Promise<NoemaPersonalMemoryList>;
  setPersonalMemoryEnabled(enabled: boolean): Promise<boolean>;
  addPersonalMemory(content: string): Promise<NoemaPersonalMemory>;
  updatePersonalMemory(input: {
    id: string;
    content: string;
  }): Promise<NoemaPersonalMemory>;
  deletePersonalMemory(id: string): Promise<boolean>;
  getUserFollowups(): Promise<NoemaUserFollowupList>;
  setUserFollowupsEnabled(enabled: boolean): Promise<boolean>;
  addUserFollowup(input: {
    title: string;
    body: string;
    dueAt: string;
  }): Promise<NoemaUserFollowup>;
  updateUserFollowup(input: {
    id: string;
    title: string;
    body: string;
    dueAt: string;
  }): Promise<NoemaUserFollowup>;
  cancelUserFollowup(id: string): Promise<boolean>;
  getSocialRoom(
    roomId: string,
    options?: {
      limit?: number;
      beforeSequence?: number;
      afterSequence?: number;
      aroundMessageId?: string;
    },
  ): Promise<NoemaSocialRoomState>;
  testArmSocialWorkReverseSnapshot?: (
    roomId: string,
    taskId: string,
  ) => Promise<boolean>;
  testGetSocialWorkReverseSnapshotStatus?: () => Promise<{
    firstRequested: boolean;
    firstReturned: boolean;
    secondReturned: boolean;
  }>;
  searchSocialMessages(query: string): Promise<NoemaSocialSearchResult[]>;
  searchSocialRoomMessages(
    roomId: string,
    query: string,
  ): Promise<NoemaSocialSearchResult[]>;
  createSocialGroup(input: {
    title: string;
    agentIds: string[];
  }): Promise<NoemaSocialRoomState>;
  chooseProjectWorkspace(): Promise<{
    workspacePath: string;
    identity: unknown;
  } | null>;
  createSocialProject(input: {
    title: string;
    brief: string;
    agentIds: string[];
    originRoomId?: string;
    sourceMessageId?: string | null;
    workspacePath?: string | null;
    workspaceIdentity?: unknown;
  }): Promise<NoemaSocialProject>;
  getSocialProjectSession(
    projectId: string,
    agentId: string,
  ): Promise<NoemaSocialProjectSession>;
  archiveSocialProject(projectId: string): Promise<NoemaSocialProject>;
  getSocialProjectPlan(projectId: string): Promise<NoemaProjectPlan>;
  inspectSocialProjectPlanEvidence(
    projectId: string,
    itemId: string,
  ): Promise<{
    projectId: string;
    itemId: string;
    revision: number;
    checkedAt: string;
    state: 'unlinked' | 'needs_review' | 'unchanged';
    evidenceReview: NoemaProjectPlanItem['evidenceReview'];
    sources: Array<
      NonNullable<NoemaProjectPlanItem['evidenceRefs']>[number] & {
        state: 'unchanged' | 'changed' | 'unavailable';
        excerpt?: string | null;
        excerptTruncated?: boolean;
        error?: string;
      }
    >;
    affectedItems: Array<{ id: string; title: string }>;
    reopenBlockedItems: Array<{ id: string; title: string }>;
  }>;
  reopenSocialProjectPlanEvidence(input: {
    projectId: string;
    itemId: string;
    expectedRevision: number;
  }): Promise<NoemaProjectPlan>;
  replaceSocialProjectPlan(
    input: NoemaProjectPlanWrite,
  ): Promise<NoemaProjectPlan>;
  updateSocialProjectPlanItem(
    input: NoemaProjectPlanItemUpdate,
  ): Promise<NoemaProjectPlan>;
  updateSocialProjectPlanPhase(
    input: NoemaProjectPlanPhaseUpdate,
  ): Promise<NoemaProjectPlan>;
  restoreSocialProject(projectId: string): Promise<NoemaSocialProject>;
  retrySocialProjectGrowthMember(
    batchId: string,
    agentId: string,
  ): Promise<NoemaSocialProject['growthBatch']>;
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
  resetSocialChat(): Promise<boolean>;
  listSocialConversationThreads(
    roomId: string,
  ): Promise<SocialConversationThread[]>;
  getSocialContinuityState(roomId: string): Promise<SocialContinuityState>;
  listSocialContinuityBranches(
    roomId: string,
  ): Promise<SocialConversationBranch[]>;
  createSocialContinuityBranch(input: {
    roomId?: string;
    fromTurnId?: string | null;
    title?: string | null;
  }): Promise<SocialConversationBranch>;
  switchSocialContinuityBranch(input: {
    roomId?: string;
    branchId: string;
    expectedVersion?: number | null;
  }): Promise<SocialContinuityState>;
  createSocialContinuityEditBranch(input: {
    roomId?: string;
    messageId: string;
    title?: string | null;
  }): Promise<SocialContinuityState>;
  rewindSocialMessage(
    roomId: string,
    messageId: string,
  ): Promise<{ removed: number; archiveId?: string }>;
  editSocialAssistantMessage(
    roomId: string,
    messageId: string,
    content: string,
  ): Promise<{ updated: number; archiveId?: string }>;
  latestSocialArchive(roomId: string): Promise<{
    id: string;
    reason: string;
    createdAt: string;
  } | null>;
  restoreSocialArchive(archiveId: string): Promise<{
    roomId: string;
    messages: number;
    turns: number;
    archiveId: string;
  }>;
  sendSocialMessage(input: {
    roomId: string;
    agentId: string;
    text: string;
    replyToMessageId?: string | null;
    reviewRequestId?: string | null;
  }): Promise<{ turnId: string; messageId: string; queued?: boolean }>;
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
  stopSocialWorkTask(taskId: string): Promise<boolean>;
  reviewSocialWorkFileChange(input: {
    taskId: string;
    changeId: string;
    action: 'keep' | 'revert';
  }): Promise<NoemaSocialWorkTask>;
  reviewSocialWorkGitState(taskId: string): Promise<NoemaSocialWorkGitReview>;
  resumeSocialWorkTask(
    taskId: string,
  ): Promise<{ accepted: boolean; taskId: string; roomId: string }>;
  continueSocialWorkTask(
    taskId: string,
  ): Promise<{ accepted: boolean; taskId: string; roomId: string }>;
  getSocialWorkUsage(taskId: string): Promise<NoemaSocialWorkUsage | null>;
  getSocialWorkStepDetail(
    taskId: string,
    stepId: string,
  ): Promise<NoemaSocialWorkStepDetail | null>;
  getSocialWorkTouchedFiles(
    taskId: string,
  ): Promise<NoemaSocialWorkTouchedFile[]>;
  exportWorkTicket(taskId: string): Promise<NoemaConversationExportResult>;
  exportConversation(roomId: string): Promise<NoemaConversationExportResult>;
  setSocialWorkCaseEligible(
    taskId: string,
    eligible: boolean,
  ): Promise<NoemaSocialWorkTask>;
  withdrawSocialPracticeCandidate(taskId: string): Promise<NoemaSocialWorkTask>;
  listWorkspaceFiles(input: {
    workspacePath: string;
    relativePath?: string;
  }): Promise<NoemaWorkspaceFileListing>;
  readWorkspaceFile(input: {
    workspacePath: string;
    relativePath: string;
  }): Promise<NoemaWorkspaceFilePreview>;
  searchWorkspaceFiles(input: {
    workspacePath: string;
    query: string;
  }): Promise<NoemaWorkspaceSearchResult>;
  readWorkspaceImage(input: {
    workspacePath: string;
    relativePath: string;
  }): Promise<NoemaWorkspaceImagePreview>;
  openWorkspaceFolder(input: {
    workspacePath: string;
  }): Promise<{ root: string }>;
  refreshModels(): Promise<NoemaProviderState>;
  configureProvider(configuration: {
    baseUrl: string;
    apiKey: string;
  }): Promise<Partial<NoemaProviderState>>;
  configureWebSearch(configuration: {
    apiKey: string;
  }): Promise<{ webSearchConfigured: boolean }>;
  clearWebSearch(): Promise<{ webSearchConfigured: boolean }>;
  selectModel(model: string): Promise<string>;
  onModelStateChanged(
    listener: (event: NoemaModelStateEvent) => void,
  ): () => void;
  onSocialEvent(listener: (event: NoemaSocialEvent) => void): () => void;
  markSocialChatReady(): Promise<boolean>;
}

declare global {
  interface Window {
    noema: NoemaBridge;
  }
}
