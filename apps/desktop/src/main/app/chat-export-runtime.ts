import { dialog, type BrowserWindow } from 'electron';
import fs from 'node:fs';

import {
  conversationExportFileName,
  formatConversationMarkdown,
} from '../../shared/export/conversation-markdown.mjs';
import {
  formatWorkTicketMarkdown,
  workTicketExportFileName,
} from '../../shared/export/work-ticket-markdown.mjs';
import type { SocialChatStore } from '../chat/social-chat-store.mjs';
import type { ProviderRuntime } from './provider-runtime';

export interface ChatExportRuntimeOptions {
  getMainWindow: () => BrowserWindow | null;
  socialChatStore: SocialChatStore | null;
  modelUsageStore: ProviderRuntime['modelUsageStore'];
}

export interface ChatExportResult {
  saved: boolean;
  path?: string;
  canceled?: boolean;
  errorCode?: string;
}

export interface ChatExportRuntime {
  exportConversation(roomId: string): Promise<ChatExportResult>;
  exportWorkTicket(taskId: string): Promise<ChatExportResult>;
}

function usableWindow(
  getMainWindow: () => BrowserWindow | null,
): BrowserWindow | null {
  const window = getMainWindow();
  return window && !window.isDestroyed() ? window : null;
}

export function createChatExportRuntime(
  options: ChatExportRuntimeOptions,
): ChatExportRuntime {
  return {
    async exportConversation(roomId: string): Promise<ChatExportResult> {
      const window = usableWindow(options.getMainWindow);
      if (!window || !options.socialChatStore) {
        return { saved: false, errorCode: 'window_unavailable' };
      }
      try {
        const snapshot = options.socialChatStore.getRoomSnapshot(roomId);
        const markdown = formatConversationMarkdown(snapshot);
        const selected = await dialog.showSaveDialog(window, {
          title: '导出对话',
          defaultPath: conversationExportFileName(snapshot.room),
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (selected.canceled || !selected.filePath) {
          return { saved: false, canceled: true };
        }
        await fs.promises.writeFile(selected.filePath, markdown, 'utf8');
        return { saved: true, path: selected.filePath };
      } catch (error) {
        return {
          saved: false,
          errorCode: error instanceof Error ? error.message : 'export_failed',
        };
      }
    },

    async exportWorkTicket(taskId: string): Promise<ChatExportResult> {
      const window = usableWindow(options.getMainWindow);
      if (!window || !options.socialChatStore) {
        return { saved: false, errorCode: 'window_unavailable' };
      }
      try {
        const task = options.socialChatStore.getSocialWorkTask(taskId);
        const usage = options.modelUsageStore.getTaskUsage(taskId);
        const markdown = formatWorkTicketMarkdown({ task, usage });
        const selected = await dialog.showSaveDialog(window, {
          title: '导出工单结果',
          defaultPath: workTicketExportFileName(task),
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (selected.canceled || !selected.filePath) {
          return { saved: false, canceled: true };
        }
        await fs.promises.writeFile(selected.filePath, markdown, 'utf8');
        return { saved: true, path: selected.filePath };
      } catch (error) {
        return {
          saved: false,
          errorCode: error instanceof Error ? error.message : 'export_failed',
        };
      }
    },
  };
}
