export function readDesktopDevelopmentOptions() {
  const testDataArgument = process.argv.find((argument) =>
    argument.startsWith('--noema-e2e-user-data-dir='),
  );
  const testDatabasePath = process.env.NOEMA_E2E_DATABASE_PATH ?? null;
  const testRendererUrl = testDataArgument
    ? (process.env.NOEMA_E2E_RENDERER_URL ?? null)
    : null;
  const testDshUserDataPath = process.env.NOEMA_E2E_DSH_USER_DATA_PATH ?? null;
  const testWorkerPreface = process.env.NOEMA_E2E_WORKER_PREFACE ?? null;
  const testWorkerPrompt = process.env.NOEMA_E2E_WORKER_PROMPT ?? null;
  const testRootOnly = process.env.NOEMA_E2E_ROOT_ONLY === '1';
  const testHistoryRecall = process.env.NOEMA_E2E_HISTORY_RECALL === '1';
  const testDirectWorker = process.env.NOEMA_E2E_DIRECT_WORKER === '1';
  const testVerificationChecksJson =
    process.env.NOEMA_E2E_VERIFICATION_CHECKS ?? null;
  const testSocialWorkPrompt = process.env.NOEMA_E2E_SOCIAL_WORK_PROMPT ?? null;
  const testSocialWorkSourcePrompt =
    process.env.NOEMA_E2E_SOCIAL_WORK_SOURCE_PROMPT ?? null;
  const testSocialWorkWorkspace =
    process.env.NOEMA_E2E_SOCIAL_WORK_WORKSPACE ?? null;
  const testSocialWorkResultPath =
    process.env.NOEMA_E2E_SOCIAL_WORK_RESULT_PATH ?? null;
  const testSocialWorkChecksJson =
    process.env.NOEMA_E2E_SOCIAL_WORK_CHECKS ?? null;
  const testSocialWorkSynthetic =
    process.env.NOEMA_E2E_SOCIAL_WORK_SYNTHETIC === '1';
  const testSocialWorkEntry = process.env.NOEMA_E2E_SOCIAL_WORK_ENTRY === '1';
  const testSocialWorkProposalSourceId =
    process.env.NOEMA_E2E_SOCIAL_WORK_PROPOSAL_SOURCE_ID ?? null;
  const testSocialWorkLiveEpisodes =
    process.env.NOEMA_E2E_SOCIAL_WORK_LIVE_EPISODES === '1';
  const testSocialWorkPracticeDecision =
    process.env.NOEMA_E2E_SOCIAL_WORK_PRACTICE_DECISION ?? null;
  const testSocialWorkEpisodeAPrompt =
    process.env.NOEMA_E2E_SOCIAL_WORK_EPISODE_A_PROMPT ?? null;
  const testSocialWorkEpisodeAChecks =
    process.env.NOEMA_E2E_SOCIAL_WORK_EPISODE_A_CHECKS ?? null;
  const testSocialWorkEpisodeBChecks =
    process.env.NOEMA_E2E_SOCIAL_WORK_EPISODE_B_CHECKS ?? null;
  const testSocialAgentWorkflow =
    process.env.NOEMA_E2E_SOCIAL_AGENT_WORKFLOW === '1';
  const testPersonalMemoryLifecycle =
    process.env.NOEMA_E2E_PERSONAL_MEMORY_LIFECYCLE === '1';
  const testUserFollowupLifecycle =
    process.env.NOEMA_E2E_USER_FOLLOWUP_LIFECYCLE === '1';
  const testSocialAttachmentsOnly =
    process.env.NOEMA_E2E_SOCIAL_ATTACHMENTS_ONLY === '1';
  const testSocialAgentLiveE2e =
    process.env.NOEMA_E2E_SOCIAL_AGENT_LIVE === '1';
  const testSocialAgentLiveModel =
    process.env.NOEMA_E2E_SOCIAL_AGENT_LIVE_MODEL ?? null;
  const testSocialProviderLiveAcceptance =
    process.env.NOEMA_E2E_SOCIAL_PROVIDER_LIVE === '1';
  const testReadOnlyCredentialDirectory =
    process.env.NOEMA_E2E_READ_ONLY_CREDENTIAL_DIRECTORY ?? null;
  const testSocialAgentR0FirstUse =
    process.env.NOEMA_E2E_SOCIAL_R0_FIRST_USE === '1';
  const testSocialAgentKeepOpen = process.env.NOEMA_E2E_KEEP_OPEN === '1';
  const socialAgentE2eResultPath =
    process.env.NOEMA_E2E_SOCIAL_AGENT_RESULT_PATH ?? null;
  const socialAgentForwardDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_FORWARD_DESKTOP_PATH ?? null;
  const socialAgentForwardNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_FORWARD_NARROW_PATH ?? null;
  const socialAgentDelegationDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_DELEGATION_DESKTOP_PATH ?? null;
  const socialAgentDelegationNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_DELEGATION_NARROW_PATH ?? null;
  const socialMessageSearchScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_SEARCH_PATH ?? null;
  const socialHistoryRecallScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_HISTORY_RECALL_PATH ?? null;
  const socialAgentProfileDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_AGENT_PROFILE_PATH ?? null;
  const socialAgentProfileNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_AGENT_PROFILE_NARROW_PATH ?? null;
  const socialAgentProjectScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_PROJECT_PATH ?? null;
  const socialMessageLayoutDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_MESSAGE_LAYOUT_DESKTOP_PATH ?? null;
  const socialMessageLayoutNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_MESSAGE_LAYOUT_NARROW_PATH ?? null;
  const socialProjectResultDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_PROJECT_RESULT_DESKTOP_PATH ?? null;
  const socialProjectResultNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_PROJECT_RESULT_NARROW_PATH ?? null;
  const socialFailureDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_FAILURE_DESKTOP_PATH ?? null;
  const socialFailureNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_FAILURE_NARROW_PATH ?? null;
  const socialComposerQueueDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_COMPOSER_QUEUE_DESKTOP_PATH ?? null;
  const socialComposerQueueNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_COMPOSER_QUEUE_NARROW_PATH ?? null;
  const socialProjectCloseoutDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_PROJECT_CLOSEOUT_DESKTOP_PATH ?? null;
  const socialProjectCloseoutNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_PROJECT_CLOSEOUT_NARROW_PATH ?? null;
  const socialProjectPlanDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_PROJECT_PLAN_DESKTOP_PATH ?? null;
  const socialProjectPlanNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_PROJECT_PLAN_NARROW_PATH ?? null;
  const socialProjectReviewDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_PROJECT_REVIEW_DESKTOP_PATH ?? null;
  const socialProjectReviewNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_PROJECT_REVIEW_NARROW_PATH ?? null;
  const socialAgentDelegationMarker = '请帮我独立核对';
  const socialComposerQueueMarker = 'NOEMA_UI_QUEUE_LAYOUT_FIXTURE';
  const socialHistoryRecallMarker = 'Noema 历史回忆验证标记：河谷石英';
  const socialAgentDelegationTask =
    '列出比较三种代码托管方案时应核对的五个关键字段。';
  const socialAgentDelegationResult =
    '核对套餐价格、计费周期、并发限制、私有仓库权限和超额费用。';
  const socialContinuationDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_DESKTOP_PATH ?? null;
  const socialContinuationNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_NARROW_PATH ?? null;
  const socialContinuationRoomDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_ROOM_DESKTOP_PATH ?? null;
  const socialContinuationRoomNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_ROOM_NARROW_PATH ?? null;
  const testCaptureHistoryTrace =
    process.env.NOEMA_SMOKE_CAPTURE_HISTORY_TRACE === '1';
  const testCaptureLegacyArchive =
    process.env.NOEMA_SMOKE_CAPTURE_LEGACY_ARCHIVE === '1';
  const testCaptureModelAvailability =
    process.env.NOEMA_SMOKE_CAPTURE_MODEL_AVAILABILITY === '1';
  const historyTraceDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_HISTORY_TRACE_DESKTOP_PATH ?? null;
  const historyTraceIntermediateScreenshotPath =
    process.env.NOEMA_SMOKE_HISTORY_TRACE_INTERMEDIATE_PATH ?? null;
  const historyTraceNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_HISTORY_TRACE_NARROW_PATH ?? null;
  const legacyArchiveDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_LEGACY_ARCHIVE_DESKTOP_PATH ?? null;
  const legacyArchiveNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_LEGACY_ARCHIVE_NARROW_PATH ?? null;
  const modelAvailabilityScreenshotPath =
    process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_SCREENSHOT_PATH ?? null;
  const modelAvailabilityNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_NARROW_SCREENSHOT_PATH ?? null;
  const captureSocialChatSmoke =
    process.env.NOEMA_SMOKE_CAPTURE_SOCIAL_CHAT === '1';
  const runSocialChatLiveSmoke =
    process.env.NOEMA_SMOKE_SOCIAL_CHAT_LIVE === '1';
  const socialChatDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_CHAT_DESKTOP_PATH ?? null;
  const socialStartStateScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_START_STATE_PATH ?? null;
  const socialStartStateNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_START_STATE_NARROW_PATH ?? null;
  const socialChatNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_CHAT_NARROW_PATH ?? null;
  const socialGroupDialogScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_GROUP_DIALOG_PATH ?? null;
  const socialSettingsNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_SETTINGS_NARROW_PATH ?? null;
  const socialSettingsDesktopReviewPath =
    process.env.NOEMA_SMOKE_SETTINGS_DESKTOP_PATH ?? null;
  const socialSettingsNarrowReviewPath =
    process.env.NOEMA_SMOKE_SETTINGS_NARROW_REVIEW_PATH ?? null;
  const socialGlobalSearchReviewPath =
    process.env.NOEMA_SMOKE_GLOBAL_SEARCH_REVIEW_PATH ?? null;
  const socialDiagnosticsReviewPath =
    process.env.NOEMA_SMOKE_DIAGNOSTICS_REVIEW_PATH ?? null;
  const socialArchivedProjectsReviewPath =
    process.env.NOEMA_SMOKE_ARCHIVED_PROJECTS_REVIEW_PATH ?? null;
  const socialPersonalMemoryReviewPath =
    process.env.NOEMA_SMOKE_PERSONAL_MEMORY_REVIEW_PATH ?? null;
  const socialUserFollowupsReviewPath =
    process.env.NOEMA_SMOKE_USER_FOLLOWUPS_REVIEW_PATH ?? null;
  const socialAgentCreateReviewPath =
    process.env.NOEMA_SMOKE_AGENT_CREATE_REVIEW_PATH ?? null;
  const socialGroupCreateReviewPath =
    process.env.NOEMA_SMOKE_GROUP_CREATE_REVIEW_PATH ?? null;
  const socialProjectCreateReviewPath =
    process.env.NOEMA_SMOKE_PROJECT_CREATE_REVIEW_PATH ?? null;
  const socialProjectWorkDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_PROJECT_WORK_PATH ?? null;
  const socialProjectWorkNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_PROJECT_WORK_NARROW_PATH ?? null;
  const socialAgentCreateDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_AGENT_CREATE_PATH ?? null;
  const socialAgentCreateNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_AGENT_CREATE_NARROW_PATH ?? null;
  const socialAgentContactDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_AGENT_CONTACT_PATH ?? null;
  const socialAgentContactNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_AGENT_CONTACT_NARROW_PATH ?? null;
  const socialTextAttachmentDesktopScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_ATTACHMENTS_DESKTOP_PATH ?? null;
  const socialTextAttachmentNarrowScreenshotPath =
    process.env.NOEMA_SMOKE_SOCIAL_ATTACHMENTS_NARROW_PATH ?? null;
  delete process.env.NOEMA_SMOKE_SOCIAL_AGENT_CREATE_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_AGENT_CREATE_NARROW_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_AGENT_CONTACT_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_AGENT_CONTACT_NARROW_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_ATTACHMENTS_DESKTOP_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_ATTACHMENTS_NARROW_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_FORWARD_DESKTOP_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_FORWARD_NARROW_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_DELEGATION_DESKTOP_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_DELEGATION_NARROW_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_SEARCH_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_DESKTOP_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_NARROW_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_ROOM_DESKTOP_PATH;
  delete process.env.NOEMA_SMOKE_SOCIAL_CONTINUATION_ROOM_NARROW_PATH;
  delete process.env.NOEMA_E2E_DATABASE_PATH;
  delete process.env.NOEMA_E2E_DSH_USER_DATA_PATH;
  delete process.env.NOEMA_E2E_WORKER_PREFACE;
  delete process.env.NOEMA_E2E_WORKER_PROMPT;
  delete process.env.NOEMA_E2E_ROOT_ONLY;
  delete process.env.NOEMA_E2E_HISTORY_RECALL;
  delete process.env.NOEMA_E2E_DIRECT_WORKER;
  delete process.env.NOEMA_E2E_VERIFICATION_CHECKS;
  delete process.env.NOEMA_E2E_SOCIAL_WORK_PROMPT;
  delete process.env.NOEMA_E2E_SOCIAL_WORK_SOURCE_PROMPT;
  delete process.env.NOEMA_E2E_SOCIAL_WORK_WORKSPACE;
  delete process.env.NOEMA_E2E_SOCIAL_WORK_RESULT_PATH;
  delete process.env.NOEMA_E2E_SOCIAL_WORK_CHECKS;
  delete process.env.NOEMA_E2E_SOCIAL_WORK_SYNTHETIC;
  delete process.env.NOEMA_E2E_SOCIAL_WORK_ENTRY;
  delete process.env.NOEMA_E2E_SOCIAL_WORK_PROPOSAL_SOURCE_ID;
  delete process.env.NOEMA_E2E_SOCIAL_WORK_LIVE_EPISODES;
  delete process.env.NOEMA_E2E_SOCIAL_WORK_PRACTICE_DECISION;
  delete process.env.NOEMA_E2E_SOCIAL_WORK_EPISODE_A_PROMPT;
  delete process.env.NOEMA_E2E_SOCIAL_WORK_EPISODE_A_CHECKS;
  delete process.env.NOEMA_E2E_SOCIAL_WORK_EPISODE_B_CHECKS;
  delete process.env.NOEMA_E2E_SOCIAL_AGENT_WORKFLOW;
  delete process.env.NOEMA_E2E_PERSONAL_MEMORY_LIFECYCLE;
  delete process.env.NOEMA_E2E_USER_FOLLOWUP_LIFECYCLE;
  delete process.env.NOEMA_E2E_SOCIAL_ATTACHMENTS_ONLY;
  delete process.env.NOEMA_E2E_SOCIAL_AGENT_LIVE;
  delete process.env.NOEMA_E2E_SOCIAL_AGENT_LIVE_MODEL;
  delete process.env.NOEMA_E2E_SOCIAL_PROVIDER_LIVE;
  delete process.env.NOEMA_E2E_READ_ONLY_CREDENTIAL_DIRECTORY;
  delete process.env.NOEMA_E2E_SOCIAL_R0_FIRST_USE;
  delete process.env.NOEMA_E2E_KEEP_OPEN;
  delete process.env.NOEMA_E2E_SOCIAL_AGENT_RESULT_PATH;
  delete process.env.NOEMA_SMOKE_CAPTURE_HISTORY_TRACE;
  delete process.env.NOEMA_SMOKE_CAPTURE_LEGACY_ARCHIVE;
  delete process.env.NOEMA_SMOKE_CAPTURE_MODEL_AVAILABILITY;
  delete process.env.NOEMA_SMOKE_HISTORY_TRACE_DESKTOP_PATH;
  delete process.env.NOEMA_SMOKE_HISTORY_TRACE_INTERMEDIATE_PATH;
  delete process.env.NOEMA_SMOKE_HISTORY_TRACE_NARROW_PATH;
  delete process.env.NOEMA_SMOKE_LEGACY_ARCHIVE_DESKTOP_PATH;
  delete process.env.NOEMA_SMOKE_LEGACY_ARCHIVE_NARROW_PATH;
  delete process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_SCREENSHOT_PATH;
  delete process.env.NOEMA_SMOKE_MODEL_AVAILABILITY_NARROW_SCREENSHOT_PATH;
  return {
    testDataArgument,
    testDatabasePath,
    testRendererUrl,
    testDshUserDataPath,
    testWorkerPreface,
    testWorkerPrompt,
    testRootOnly,
    testHistoryRecall,
    testDirectWorker,
    testVerificationChecksJson,
    testSocialWorkPrompt,
    testSocialWorkSourcePrompt,
    testSocialWorkWorkspace,
    testSocialWorkResultPath,
    testSocialWorkChecksJson,
    testSocialWorkSynthetic,
    testSocialWorkEntry,
    testSocialWorkProposalSourceId,
    testSocialWorkLiveEpisodes,
    testSocialWorkPracticeDecision,
    testSocialWorkEpisodeAPrompt,
    testSocialWorkEpisodeAChecks,
    testSocialWorkEpisodeBChecks,
    testSocialAgentWorkflow,
    testPersonalMemoryLifecycle,
    testUserFollowupLifecycle,
    testSocialAttachmentsOnly,
    testSocialAgentLiveE2e,
    testSocialAgentLiveModel,
    testSocialProviderLiveAcceptance,
    testReadOnlyCredentialDirectory,
    testSocialAgentR0FirstUse,
    testSocialAgentKeepOpen,
    socialAgentE2eResultPath,
    socialAgentForwardDesktopScreenshotPath,
    socialAgentForwardNarrowScreenshotPath,
    socialAgentDelegationDesktopScreenshotPath,
    socialAgentDelegationNarrowScreenshotPath,
    socialMessageSearchScreenshotPath,
    socialHistoryRecallScreenshotPath,
    socialAgentProfileDesktopScreenshotPath,
    socialAgentProfileNarrowScreenshotPath,
    socialAgentProjectScreenshotPath,
    socialMessageLayoutDesktopScreenshotPath,
    socialMessageLayoutNarrowScreenshotPath,
    socialProjectResultDesktopScreenshotPath,
    socialProjectResultNarrowScreenshotPath,
    socialFailureDesktopScreenshotPath,
    socialFailureNarrowScreenshotPath,
    socialComposerQueueDesktopScreenshotPath,
    socialComposerQueueNarrowScreenshotPath,
    socialProjectCloseoutDesktopScreenshotPath,
    socialProjectCloseoutNarrowScreenshotPath,
    socialProjectPlanDesktopScreenshotPath,
    socialProjectPlanNarrowScreenshotPath,
    socialProjectReviewDesktopScreenshotPath,
    socialProjectReviewNarrowScreenshotPath,
    socialAgentDelegationMarker,
    socialComposerQueueMarker,
    socialHistoryRecallMarker,
    socialAgentDelegationTask,
    socialAgentDelegationResult,
    socialContinuationDesktopScreenshotPath,
    socialContinuationNarrowScreenshotPath,
    socialContinuationRoomDesktopScreenshotPath,
    socialContinuationRoomNarrowScreenshotPath,
    testCaptureHistoryTrace,
    testCaptureLegacyArchive,
    testCaptureModelAvailability,
    historyTraceDesktopScreenshotPath,
    historyTraceIntermediateScreenshotPath,
    historyTraceNarrowScreenshotPath,
    legacyArchiveDesktopScreenshotPath,
    legacyArchiveNarrowScreenshotPath,
    modelAvailabilityScreenshotPath,
    modelAvailabilityNarrowScreenshotPath,
    captureSocialChatSmoke,
    runSocialChatLiveSmoke,
    socialChatDesktopScreenshotPath,
    socialStartStateScreenshotPath,
    socialStartStateNarrowScreenshotPath,
    socialChatNarrowScreenshotPath,
    socialGroupDialogScreenshotPath,
    socialSettingsNarrowScreenshotPath,
    socialSettingsDesktopReviewPath,
    socialSettingsNarrowReviewPath,
    socialGlobalSearchReviewPath,
    socialDiagnosticsReviewPath,
    socialArchivedProjectsReviewPath,
    socialPersonalMemoryReviewPath,
    socialUserFollowupsReviewPath,
    socialAgentCreateReviewPath,
    socialGroupCreateReviewPath,
    socialProjectCreateReviewPath,
    socialProjectWorkDesktopScreenshotPath,
    socialProjectWorkNarrowScreenshotPath,
    socialAgentCreateDesktopScreenshotPath,
    socialAgentCreateNarrowScreenshotPath,
    socialAgentContactDesktopScreenshotPath,
    socialAgentContactNarrowScreenshotPath,
    socialTextAttachmentDesktopScreenshotPath,
    socialTextAttachmentNarrowScreenshotPath,
  };
}
export type DesktopDevelopmentOptions = ReturnType<
  typeof readDesktopDevelopmentOptions
>;
