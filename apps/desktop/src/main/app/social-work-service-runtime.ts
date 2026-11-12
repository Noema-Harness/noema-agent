import { SocialWorkService } from '../execution/social-work-service.mjs';
import type { SocialChatStore } from '../chat/social-chat-store.mjs';
import type { SocialProjectStore } from '../projects/social-project-store.mjs';
import type { SocialWorkDialogs } from './social-work-dialogs';

type SocialWorkServiceOptions = ConstructorParameters<
  typeof SocialWorkService
>[0];

export interface SocialWorkServiceRuntimeOptions {
  store: SocialChatStore;
  projectStore: SocialProjectStore;
  dialogs: SocialWorkDialogs;
  adapter: SocialWorkServiceOptions['adapter'];
  secretStore: SocialWorkServiceOptions['secretStore'];
  practiceProvider: SocialWorkServiceOptions['practiceProvider'];
  getSelectedModel: () => string | null;
  assertWorkAllowed: (roomId: string) => void;
  socialWorkE2eValid: boolean;
  testSocialWorkChecksJson: string | null;
  recordDiagnosticEvent: (event: Record<string, unknown>) => void;
  currentApplicationExecutionId: string | null;
  emit: (event: object) => void;
}

export function createSocialWorkServiceRuntime(
  options: SocialWorkServiceRuntimeOptions,
): SocialWorkService {
  const {
    store,
    projectStore,
    dialogs,
    adapter,
    secretStore,
    practiceProvider,
    getSelectedModel,
    assertWorkAllowed,
    socialWorkE2eValid,
    testSocialWorkChecksJson,
    recordDiagnosticEvent,
    currentApplicationExecutionId,
    emit,
  } = options;

  return new SocialWorkService({
    store,
    projectStore,
    getSelectedModel,
    assertWorkAllowed,
    adapter,
    secretStore,
    practiceProvider,
    recordDiagnosticEvent: (event) =>
      recordDiagnosticEvent({
        ...event,
        ...(event.operation === 'workspace.selection' &&
        event.status === 'canceled'
          ? { parentExecutionId: currentApplicationExecutionId }
          : {}),
      }),
    defaultVerificationChecks:
      socialWorkE2eValid && testSocialWorkChecksJson
        ? JSON.parse(testSocialWorkChecksJson)
        : [],
    chooseWorkspace: dialogs.chooseWorkspace,
    confirmWorkspaceRebind: dialogs.confirmWorkspaceRebind,
    confirmPracticeCandidate: dialogs.confirmPracticeCandidate,
    emit,
  });
}
