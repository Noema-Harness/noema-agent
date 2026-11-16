import type { IpcMainInvokeEvent } from 'electron';
import type { LegacyHistoryArchiveService } from '../archive/legacy-history-archive-service.ts';
import { isMainFrameIpcEvent } from '../platform/window-security.ts';

export const LEGACY_HISTORY_ARCHIVE_CHANNELS = Object.freeze({
  categories: 'noema:legacy-history-categories',
  page: 'noema:legacy-history-page',
  exportPreview: 'noema:legacy-history-export-preview',
  exportSave: 'noema:legacy-history-export-save',
});

export function registerLegacyHistoryArchiveIpc({
  ipcMain,
  archiveService,
  saveExport = async () => ({
    saved: false,
    canceled: false,
    errorCode: 'unavailable',
  }),
  isTrustedSender,
}: {
  ipcMain: { handle: Function; removeHandler: Function };
  archiveService: LegacyHistoryArchiveService;
  saveExport?: (previewId: string) => Promise<object>;
  isTrustedSender: (sender: object) => boolean;
}) {
  // Renderer arguments are untrusted; the archive service validates them.
  const register = (
    channel: string,
    handler: (...args: unknown[]) => unknown,
  ) => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isTrustedSender(event.sender) || !isMainFrameIpcEvent(event)) {
        throw new Error('未授权的应用窗口请求');
      }
      return handler(...args);
    });
  };

  register(LEGACY_HISTORY_ARCHIVE_CHANNELS.categories, () =>
    archiveService.listCategories(),
  );
  register(LEGACY_HISTORY_ARCHIVE_CHANNELS.page, (input) =>
    archiveService.listPage(
      input as Parameters<LegacyHistoryArchiveService['listPage']>[0],
    ),
  );
  register(LEGACY_HISTORY_ARCHIVE_CHANNELS.exportPreview, (input) =>
    archiveService.getExportPreview(
      input as Parameters<LegacyHistoryArchiveService['getExportPreview']>[0],
    ),
  );
  register(LEGACY_HISTORY_ARCHIVE_CHANNELS.exportSave, (previewId) =>
    saveExport(previewId as string),
  );

  return () => {
    for (const channel of Object.values(LEGACY_HISTORY_ARCHIVE_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
  };
}
