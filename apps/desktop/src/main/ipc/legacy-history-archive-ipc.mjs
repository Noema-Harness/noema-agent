import { isMainFrameIpcEvent } from '../platform/window-security.ts';

export const LEGACY_HISTORY_ARCHIVE_CHANNELS = Object.freeze({
  categories: 'noema:legacy-history-categories',
  page: 'noema:legacy-history-page',
  exportPreview: 'noema:legacy-history-export-preview',
  exportSave: 'noema:legacy-history-export-save',
});

/**
 * @param {{ipcMain:{handle:Function,removeHandler:Function},archiveService:object,saveExport:(previewId:string)=>Promise<object>,isTrustedSender:(sender:object)=>boolean}} options
 */
export function registerLegacyHistoryArchiveIpc({
  ipcMain,
  archiveService,
  saveExport = async () => ({
    saved: false,
    canceled: false,
    errorCode: 'unavailable',
  }),
  isTrustedSender,
}) {
  const register = (channel, handler) => {
    ipcMain.handle(channel, (event, ...args) => {
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
    archiveService.listPage(input),
  );
  register(LEGACY_HISTORY_ARCHIVE_CHANNELS.exportPreview, (input) =>
    archiveService.getExportPreview(input),
  );
  register(LEGACY_HISTORY_ARCHIVE_CHANNELS.exportSave, (previewId) =>
    saveExport(previewId),
  );

  return () => {
    for (const channel of Object.values(LEGACY_HISTORY_ARCHIVE_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
  };
}
