import type { BrowserWindow } from 'electron';
import type { SocialChatService } from '../../src/main/chat/social-chat-service.mjs';
import type { DesktopDevelopmentOptions } from '../../src/main/platform/development-options';
export type DesktopProbeContext = {
  mainWindow: BrowserWindow | null;
  restoreMainWindowForTest: () => boolean;
  openFollowupSourceForTest:
    | ((target: {
        followupId: string;
        sourceRoomId: string | null;
        sourceMessageId: string | null;
      }) => boolean)
    | null;
  socialAgentE2eModelRequests: Array<{
    model: string;
    messages: Array<{ role: string; content: string }>;
  }>;
  socialChatService: SocialChatService | null;
  writeSmokeLog: (step: string, details?: Record<string, unknown>) => void;
  options: DesktopDevelopmentOptions;
};
