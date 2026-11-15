const LEGACY_HISTORY_CATEGORIES = Object.freeze([
  'root-turns',
  'root-messages',
  'dsh-tasks',
  'captures',
  'context-imports',
  'interaction-adjustments',
] as const);
type LegacyHistoryCategory = (typeof LEGACY_HISTORY_CATEGORIES)[number];
type LegacyHistoryRecord = Record<string, unknown>;
type LegacyHistoryPage = {
  records: LegacyHistoryRecord[];
  nextCursor: number | null;
  hasMore: boolean;
};
/** The read-only RootStore surface this archive depends on. */
type LegacyHistoryRootStore = {
  listLegacyHistoryPage(input: {
    category: LegacyHistoryCategory;
    cursor: number | null;
    limit: number;
    fullText?: boolean;
  }): LegacyHistoryPage;
  // RootStore (root-store.mjs) builds counts imperatively, so its inferred
  // type is wider than the real `number` values; callers validate each count.
  getLegacyHistoryCategoryCounts(): Partial<Record<LegacyHistoryCategory, any>>;
};
type LegacyHistoryExportPreviewState = {
  createdAtMs: number;
  categories: LegacyHistoryCategory[];
};
/** Membership check for untrusted category input. */
const LEGACY_HISTORY_CATEGORY_SET: ReadonlySet<unknown> = new Set(
  LEGACY_HISTORY_CATEGORIES,
);
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_ARCHIVE_TEXT_LENGTH = 100_000;
const MAX_ARCHIVE_JSON_LENGTH = 1_000_000;

function parseArrayJson(value: unknown): {
  value: unknown[];
  complete: boolean;
} {
  if (typeof value !== 'string' || value.length > MAX_ARCHIVE_JSON_LENGTH) {
    return { value: [], complete: false };
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? { value: parsed, complete: true }
      : { value: [], complete: false };
  } catch {
    return { value: [], complete: false };
  }
}

function boundedText(
  record: LegacyHistoryRecord,
  key: string,
  truncatedFields: string[],
) {
  const value = record[key];
  if (typeof value !== 'string' || value.length <= MAX_ARCHIVE_TEXT_LENGTH) {
    return value;
  }
  truncatedFields.push(key);
  return value.slice(0, MAX_ARCHIVE_TEXT_LENGTH);
}

function projectRecord(
  category: LegacyHistoryCategory,
  source: LegacyHistoryRecord,
) {
  const record: LegacyHistoryRecord = { ...source };
  delete record.seq;
  record.category = category;
  record.legacyOwner =
    category === 'dsh-tasks'
      ? 'legacy-dsh'
      : category === 'context-imports'
        ? 'legacy-codex'
        : 'legacy-root';
  const truncatedFields: string[] = [];
  const textFields = [
    'content',
    'prompt',
    'resultText',
    'noemaResponse',
    'errorMessage',
    'noemaResponseError',
    'workspacePath',
  ];
  for (const key of textFields) {
    if (key in record) record[key] = boundedText(record, key, truncatedFields);
  }

  let complete = true;
  if (category === 'root-messages') {
    const fields = [
      ['routedViaJson', 'routedVia'],
      ['interactionAdjustmentIdsJson', 'interactionAdjustmentIds'],
      ['interactionAdjustmentSnapshotsJson', 'interactionAdjustmentSnapshots'],
      ['historySourcesJson', 'historySources'],
      ['externalSourcesJson', 'externalSources'],
    ];
    for (const [rawKey, key] of fields) {
      const parsed = parseArrayJson(record[rawKey]);
      record[key] = parsed.value;
      complete &&= parsed.complete;
      delete record[rawKey];
    }
    delete record.routeMetadataStatus;
  } else if (category === 'dsh-tasks') {
    const fields = [
      ['verificationChecksJson', 'verificationChecks'],
      ['verificationResultsJson', 'verificationResults'],
      ['interactionAdjustmentIdsJson', 'interactionAdjustmentIds'],
      ['interactionAdjustmentSnapshotsJson', 'interactionAdjustmentSnapshots'],
      ['toolActionCategoriesJson', 'toolActionCategories'],
    ];
    for (const [rawKey, key] of fields) {
      const parsed = parseArrayJson(record[rawKey]);
      record[key] = parsed.value;
      complete &&= parsed.complete;
      delete record[rawKey];
    }
    record.toolActionsTruncated = Boolean(record.toolActionsTruncated);
  } else if (category === 'context-imports') {
    const parsed = parseArrayJson(record.snapshotJson);
    record.messages = parsed.value;
    complete &&= parsed.complete;
    delete record.snapshotJson;
  }

  record.truncatedFields = truncatedFields;
  record.recordStatus =
    complete && truncatedFields.length === 0 ? 'complete' : 'partial';
  return record;
}

function rawRecordStatus(
  category: LegacyHistoryCategory,
  record: LegacyHistoryRecord,
) {
  const jsonFieldsByCategory: Record<LegacyHistoryCategory, string[]> = {
    'root-turns': [],
    'root-messages': [
      'routedViaJson',
      'interactionAdjustmentIdsJson',
      'interactionAdjustmentSnapshotsJson',
      'historySourcesJson',
      'externalSourcesJson',
    ],
    'dsh-tasks': [
      'verificationChecksJson',
      'verificationResultsJson',
      'interactionAdjustmentIdsJson',
      'interactionAdjustmentSnapshotsJson',
      'toolActionCategoriesJson',
    ],
    captures: [],
    'context-imports': ['snapshotJson'],
    'interaction-adjustments': [],
  };
  const textFields = [
    'content',
    'prompt',
    'resultText',
    'noemaResponse',
    'errorMessage',
    'noemaResponseError',
    'workspacePath',
  ];
  const validJson = (jsonFieldsByCategory[category] ?? []).every(
    (field) => parseArrayJson(record[field]).complete,
  );
  const boundedText = textFields.every(
    (field) =>
      typeof record[field] !== 'string' ||
      record[field].length <= MAX_ARCHIVE_TEXT_LENGTH,
  );
  return validJson && boundedText ? 'complete' : 'partial';
}

/** Read-only access to records created by the retired Root/Legacy workflows. */
export class LegacyHistoryArchiveService {
  declare rootStore: LegacyHistoryRootStore;
  declare exportPreviews: Map<string, LegacyHistoryExportPreviewState>;

  constructor({ rootStore }: { rootStore: LegacyHistoryRootStore }) {
    if (
      typeof rootStore?.listLegacyHistoryPage !== 'function' ||
      typeof rootStore?.getLegacyHistoryCategoryCounts !== 'function'
    ) {
      throw new TypeError('历史归档需要只读 RootStore 接口。');
    }
    this.rootStore = rootStore;
    this.exportPreviews = new Map();
  }

  listCategories() {
    const counts = this.rootStore.getLegacyHistoryCategoryCounts();
    return LEGACY_HISTORY_CATEGORIES.map((id) => ({
      id,
      count:
        Number.isSafeInteger(counts[id]) && counts[id] >= 0 ? counts[id] : 0,
    }));
  }

  listPage({
    category,
    cursor = null,
    limit = DEFAULT_PAGE_SIZE,
  }: {
    category?: LegacyHistoryCategory;
    cursor?: number | null;
    limit?: number;
  } = {}) {
    if (!LEGACY_HISTORY_CATEGORY_SET.has(category)) {
      throw new TypeError('历史记录类别无效。');
    }
    if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 0)) {
      throw new TypeError('历史记录分页位置无效。');
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new TypeError('历史记录分页大小无效。');
    }
    const page = this.rootStore.listLegacyHistoryPage({
      category: category as LegacyHistoryCategory,
      cursor,
      limit: Math.min(limit, MAX_PAGE_SIZE),
    });
    if (!page || !Array.isArray(page.records)) {
      return {
        category,
        records: [],
        nextCursor: null,
        hasMore: false,
        status: 'unavailable',
      };
    }
    return {
      category,
      records: page.records.map((record) =>
        projectRecord(category as LegacyHistoryCategory, record),
      ),
      nextCursor: page.nextCursor ?? null,
      hasMore: Boolean(page.hasMore),
      status: 'available',
    };
  }

  getExportPreview({
    categories,
  }: { categories?: LegacyHistoryCategory[] } = {}) {
    if (
      !Array.isArray(categories) ||
      categories.length === 0 ||
      categories.length > LEGACY_HISTORY_CATEGORIES.length ||
      categories.some((category) => !LEGACY_HISTORY_CATEGORY_SET.has(category))
    ) {
      throw new TypeError('请选择有效的历史记录类别。');
    }
    const selected = [...new Set(categories)];
    if (selected.length !== categories.length) {
      throw new TypeError('历史记录类别不能重复。');
    }
    const counts = this.rootStore.getLegacyHistoryCategoryCounts();
    const previewCategories = selected.map((category) => {
      const sample = this.listPage({ category, limit: 1 }).records[0] ?? null;
      return {
        id: category,
        count:
          Number.isSafeInteger(counts[category]) && counts[category] >= 0
            ? counts[category]
            : 0,
        sample,
      };
    });
    const preview = {
      previewId: randomUUID(),
      format: 'noema-legacy-history-v1',
      createdAt: new Date().toISOString(),
      categories: previewCategories,
      totalRecords: previewCategories.reduce(
        (total, category) => total + category.count,
        0,
      ),
    };
    const cutoff = Date.now() - 5 * 60_000;
    for (const [id, value] of this.exportPreviews) {
      if (value.createdAtMs < cutoff) this.exportPreviews.delete(id);
    }
    while (this.exportPreviews.size >= 10) {
      this.exportPreviews.delete(
        this.exportPreviews.keys().next().value as string,
      );
    }
    this.exportPreviews.set(preview.previewId, {
      createdAtMs: Date.now(),
      categories: selected,
    });
    return preview;
  }

  getExportMetadata(previewId: string) {
    const preview = this.exportPreviews.get(previewId);
    if (!preview || Date.now() - preview.createdAtMs > 5 * 60_000) {
      this.exportPreviews.delete(previewId);
      return null;
    }
    const counts = this.rootStore.getLegacyHistoryCategoryCounts();
    const categories = preview.categories.map((id) => ({
      id,
      count:
        Number.isSafeInteger(counts[id]) && counts[id] >= 0 ? counts[id] : 0,
    }));
    return {
      format: 'noema-legacy-history-v1',
      previewId,
      categories,
      totalRecords: categories.reduce(
        (total, category) => total + category.count,
        0,
      ),
    };
  }

  async *iterateExportRecords(previewId: string) {
    const preview = this.exportPreviews.get(previewId);
    if (!preview || Date.now() - preview.createdAtMs > 5 * 60_000) {
      this.exportPreviews.delete(previewId);
      throw new Error('历史归档导出预览已失效，请重新预览。');
    }
    for (const category of preview.categories) {
      let cursor: number | null = null;
      do {
        const page = this.rootStore.listLegacyHistoryPage({
          category,
          cursor,
          limit: MAX_PAGE_SIZE,
          fullText: true,
        });
        for (const record of page.records) {
          yield {
            category,
            legacyOwner:
              category === 'dsh-tasks'
                ? 'legacy-dsh'
                : category === 'context-imports'
                  ? 'legacy-codex'
                  : 'legacy-root',
            recordStatus: rawRecordStatus(category, record),
            record,
          };
        }
        cursor = page.nextCursor;
        if (!page.hasMore) break;
      } while (true);
    }
    this.exportPreviews.delete(previewId);
  }
}

export { LEGACY_HISTORY_CATEGORIES };
import { randomUUID } from 'node:crypto';
