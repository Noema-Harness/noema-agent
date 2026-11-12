import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Saves a reviewed legacy-history export to a user-selected local path.
 * @param {{previewId:string,archiveService:object,selectFile:()=>Promise<{canceled:boolean,filePath?:string}>,createWriteStream:Function}} options
 */
export async function saveLegacyHistoryExport({
  previewId,
  archiveService,
  selectFile,
  createWriteStream,
}) {
  const metadata = archiveService.getExportMetadata(previewId);
  if (!metadata)
    return { saved: false, canceled: false, errorCode: 'preview_expired' };

  const selection = await selectFile();
  if (selection.canceled || !selection.filePath) {
    return { saved: false, canceled: true, errorCode: null };
  }

  const temporaryPath = path.join(
    path.dirname(selection.filePath),
    `.noema-legacy-history-${randomUUID()}.tmp`,
  );
  const actualCounts = Object.fromEntries(
    metadata.categories.map(({ id }) => [id, 0]),
  );
  const records = archiveService.iterateExportRecords(previewId);
  const chunks = async function* () {
    yield `${JSON.stringify({ ...metadata, createdAt: new Date().toISOString() }).slice(0, -1)},"records":[`;
    let first = true;
    for await (const entry of records) {
      if (!(entry.category in actualCounts)) {
        throw new Error(
          'Legacy history export returned an unselected category.',
        );
      }
      actualCounts[entry.category] += 1;
      if (!first) yield ',';
      first = false;
      yield JSON.stringify(entry);
    }
    for (const { id, count } of metadata.categories) {
      if (actualCounts[id] !== count) {
        throw new Error('Legacy history changed after export preview.');
      }
    }
    yield `],"complete":true,"exportedCounts":${JSON.stringify(actualCounts)}}`;
  };

  try {
    await pipeline(
      Readable.from(chunks(), { encoding: 'utf8' }),
      createWriteStream(temporaryPath, { flags: 'wx', encoding: 'utf8' }),
    );
    await rename(temporaryPath, selection.filePath);
    return { saved: true, canceled: false, errorCode: null };
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => {});
    return { saved: false, canceled: false, errorCode: 'write_failed' };
  }
}
