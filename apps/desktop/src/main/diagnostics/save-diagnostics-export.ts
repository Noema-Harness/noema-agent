import path from 'node:path';

/** Handles a user-picked local save without exposing paths to the renderer. */
export async function saveDiagnosticsExport({
  previewId,
  queryService,
  selectFile,
  writeFile,
}: {
  previewId: string;
  queryService: {
    getExportFileContent: (previewId: string) => string | null;
    recordExportOutcome: (
      previewId: string,
      outcome: 'completed' | 'canceled' | 'failed',
      errorCode?: string,
    ) => void;
    discardExportPreview: (previewId: string) => void;
  };
  selectFile: () => Promise<
    { canceled?: boolean; filePath?: string } | null | undefined
  >;
  writeFile: (filePath: string, content: string) => Promise<void>;
}) {
  const content = queryService.getExportFileContent(previewId);
  if (content === null) {
    queryService.recordExportOutcome(previewId, 'failed', 'preview_expired');
    return { saved: false, errorCode: 'preview_expired' };
  }
  let selection;
  try {
    selection = await selectFile();
  } catch {
    queryService.recordExportOutcome(previewId, 'failed', 'save_dialog_failed');
    return { saved: false, errorCode: 'save_dialog_failed' };
  }
  if (!selection || selection.canceled || !selection.filePath) {
    queryService.recordExportOutcome(previewId, 'canceled');
    queryService.discardExportPreview(previewId);
    return { saved: false, canceled: true };
  }
  try {
    await writeFile(selection.filePath, content);
    queryService.recordExportOutcome(previewId, 'completed');
    queryService.discardExportPreview(previewId);
    return { saved: true, fileName: path.basename(selection.filePath) };
  } catch {
    queryService.recordExportOutcome(previewId, 'failed', 'write_failed');
    return { saved: false, errorCode: 'write_failed' };
  }
}
