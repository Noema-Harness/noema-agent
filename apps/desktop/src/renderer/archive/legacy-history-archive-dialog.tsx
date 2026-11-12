import React, { useEffect, useRef, useState } from 'react';
import { NoemaButton } from '../ui/noema-button';
import { NoemaCheckbox, NoemaSelect } from '../ui/noema-form-controls';
import { NoemaOverlay } from '../ui/noema-overlay';
import type {
  NoemaLegacyHistoryCategory,
  NoemaLegacyHistoryCategoryInfo,
  NoemaLegacyHistoryExportPreview,
  NoemaLegacyHistoryPage,
  NoemaLegacyHistoryRecord,
} from '../../shared/contracts/noema-bridge.d.ts';

const CATEGORY_LABELS: Record<NoemaLegacyHistoryCategory, string> = {
  'root-turns': '旧对话轮次',
  'root-messages': '旧对话消息',
  'dsh-tasks': '旧后台任务',
  captures: '速记记录',
  'context-imports': '导入快照',
  'interaction-adjustments': '旧行为调整',
};

function textValue(value: unknown, fallback = '—') {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function dateValue(value: unknown) {
  if (typeof value !== 'string') return '时间未知';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function ownerLabel(value: unknown) {
  if (value === 'legacy-dsh') return '来源：DSH';
  if (value === 'legacy-codex') return '来源：Codex';
  return '来源：Root';
}

function recordHeading(
  category: NoemaLegacyHistoryCategory,
  record: NoemaLegacyHistoryRecord,
) {
  switch (category) {
    case 'root-turns':
      return `对话轮次 · ${textValue(record.id)}`;
    case 'root-messages':
      return `${record.role === 'user' ? '用户消息' : 'Noema 回复'} · ${textValue(record.id)}`;
    case 'dsh-tasks':
      return `后台任务 · ${textValue(record.id)}`;
    case 'captures':
      return `速记 · ${textValue(record.id)}`;
    case 'context-imports':
      return `导入快照 · ${textValue(record.title, textValue(record.id))}`;
    case 'interaction-adjustments':
      return `行为调整 · ${textValue(record.id)}`;
  }
}

function recordSummary(
  category: NoemaLegacyHistoryCategory,
  record: NoemaLegacyHistoryRecord,
) {
  switch (category) {
    case 'root-turns':
      return `${textValue(record.status)} · 第 ${textValue(String(record.attempt))} 次 · ${dateValue(record.createdAt)}`;
    case 'root-messages':
      return `轮次 ${textValue(record.turnId)} · ${textValue(record.status)} · ${dateValue(record.createdAt)}`;
    case 'dsh-tasks':
      return `${textValue(record.status)} · ${textValue(record.phase)} · ${dateValue(record.createdAt)}`;
    case 'captures':
      return `${dateValue(record.createdAt)}${record.discussionTurnId ? ` · 关联轮次 ${String(record.discussionTurnId)}` : ''}`;
    case 'context-imports':
      return `${textValue(record.source)} · ${textValue(String(record.messageCount ?? '0'))} 条消息 · ${dateValue(record.capturedAt)}`;
    case 'interaction-adjustments':
      return `${textValue(record.scope)} · ${textValue(record.status)} · ${dateValue(record.createdAt)}`;
  }
}

function recordPreview(
  category: NoemaLegacyHistoryCategory,
  record: NoemaLegacyHistoryRecord,
) {
  if (category === 'root-messages') return record.content;
  if (category === 'captures') return record.content;
  if (category === 'dsh-tasks') return record.resultText || record.prompt;
  if (category === 'interaction-adjustments') {
    return `${textValue(record.situation)}\n${textValue(record.behavior)}`;
  }
  if (category === 'root-turns') return record.errorMessage;
  if (category === 'context-imports') return record.messages;
  return null;
}

function onDialogKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  dialog: HTMLElement | null,
  onClose: () => void,
) {
  if (event.key === 'Escape') {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== 'Tab' || !dialog) return;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]',
    ),
  ).filter((element) => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function LegacyHistoryArchiveDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [categories, setCategories] = useState<
    NoemaLegacyHistoryCategoryInfo[]
  >([]);
  const [category, setCategory] =
    useState<NoemaLegacyHistoryCategory>('root-turns');
  const [page, setPage] = useState<NoemaLegacyHistoryPage | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<number | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedForExport, setSelectedForExport] = useState<
    NoemaLegacyHistoryCategory[]
  >([]);
  const [preview, setPreview] =
    useState<NoemaLegacyHistoryExportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    setError('');
    void window.noema
      .getLegacyHistoryCategories()
      .then((nextCategories) => {
        if (!current) return;
        setCategories(nextCategories);
        if (!nextCategories.some((item) => item.id === category)) {
          const first = nextCategories[0]?.id ?? 'root-turns';
          setCategory(first);
          setCursorStack([null]);
          setPageIndex(0);
        }
      })
      .catch(() => {
        if (current) setError('本机历史归档目录暂不可读取。');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !categories.some((item) => item.id === category)) return;
    let current = true;
    setLoading(true);
    setPage(null);
    setError('');
    void window.noema
      .getLegacyHistoryPage({
        category,
        cursor: cursorStack[pageIndex] ?? null,
        limit: 20,
      })
      .then((nextPage) => {
        if (!current) return;
        setPage(nextPage);
        if (nextPage.status !== 'available')
          setError('这类历史记录暂不可读取。');
      })
      .catch(() => {
        if (current) setError('本机历史记录读取失败；原记录没有改变。');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open, category, categories, cursorStack, pageIndex]);

  const selectCategory = (next: NoemaLegacyHistoryCategory) => {
    setCategory(next);
    setCursorStack([null]);
    setPageIndex(0);
    setPreview(null);
    setError('');
    setNotice('');
  };

  const toggleExportCategory = (value: NoemaLegacyHistoryCategory) => {
    setSelectedForExport((selected) =>
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    );
    setPreview(null);
    setError('');
    setNotice('');
  };

  const createPreview = async () => {
    setExportBusy(true);
    setError('');
    setNotice('');
    try {
      setPreview(
        await window.noema.previewLegacyHistoryExport({
          categories: selectedForExport,
        }),
      );
    } catch {
      setError('无法生成归档预览；原历史记录没有改变。');
    } finally {
      setExportBusy(false);
    }
  };

  const savePreview = async () => {
    if (!preview) return;
    setExportBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await window.noema.saveLegacyHistoryExport(
        preview.previewId,
      );
      if (result.canceled) {
        setNotice('已取消导出，历史记录没有改变。');
      } else if (result.saved) {
        setNotice(`已导出 ${preview.totalRecords} 条历史记录。`);
        setPreview(null);
      } else {
        setError(
          result.errorCode === 'preview_expired'
            ? '预览已过期，请重新生成。'
            : '保存失败；源历史记录没有改变。',
        );
      }
    } catch {
      setError('保存失败；源历史记录没有改变。');
    } finally {
      setExportBusy(false);
    }
  };

  const selectedInfo = categories.find((item) => item.id === category);
  const previousAvailable = pageIndex > 0;
  const nextAvailable = Boolean(page?.hasMore && page.nextCursor !== null);

  return open ? (
    <NoemaOverlay isOpen onClose={onClose} className="legacy-history-backdrop">
      <section
        ref={dialogRef}
        className="social-dialog legacy-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legacy-history-title"
        tabIndex={-1}
        onKeyDown={(event) =>
          onDialogKeyDown(event, dialogRef.current, onClose)
        }
      >
        <header className="dialog-heading legacy-history-heading">
          <div>
            <p className="diagnostics-eyebrow">只读 · 本机数据</p>
            <h2 id="legacy-history-title">历史归档</h2>
            <p>这里的旧记录不会进入新对话，也不会恢复旧任务。</p>
          </div>
          <NoemaButton
            ref={closeRef}
            className="icon-button"
            type="button"
            aria-label="关闭历史归档"
            onClick={onClose}
          >
            ×
          </NoemaButton>
        </header>

        <section className="legacy-history-explorer" aria-label="历史记录查询">
          <div className="legacy-history-toolbar">
            <label
              className="legacy-history-category-label"
              htmlFor="legacy-history-category"
            >
              记录类型
              <NoemaSelect
                id="legacy-history-category"
                value={category}
                onChange={(event) =>
                  selectCategory(
                    event.currentTarget.value as NoemaLegacyHistoryCategory,
                  )
                }
                options={categories.map((item) => ({
                  value: item.id,
                  label: `${CATEGORY_LABELS[item.id]} · ${item.count}`,
                }))}
              />
            </label>
            <span className="legacy-history-count" role="status">
              {selectedInfo ? `${selectedInfo.count} 条记录` : '记录数未知'}
            </span>
          </div>

          {loading ? <p role="status">正在读取历史记录…</p> : null}
          {error ? (
            <p className="diagnostics-feedback is-error" role="alert">
              {error}
            </p>
          ) : null}
          {!loading && !error && page?.records.length === 0 ? (
            <p className="legacy-history-empty" role="status">
              此类归档目前没有记录。
            </p>
          ) : null}
          {!loading && page?.records.length ? (
            <div className="legacy-history-record-list" aria-live="polite">
              {page.records.map((record) => {
                const previewValue = recordPreview(category, record);
                return (
                  <article
                    className="legacy-history-record"
                    key={`${category}:${record.id}`}
                  >
                    <header>
                      <h3>{recordHeading(category, record)}</h3>
                      <span>
                        {ownerLabel(record.legacyOwner)} ·{' '}
                        {recordSummary(category, record)}
                      </span>
                    </header>
                    {record.recordStatus === 'partial' ? (
                      <p className="legacy-history-partial" role="status">
                        记录有字段损坏或超出显示上限；已显示部分在本机可读内容。
                      </p>
                    ) : null}
                    {typeof previewValue === 'string' && previewValue ? (
                      <p className="legacy-history-record-preview">
                        {previewValue}
                      </p>
                    ) : null}
                    <details>
                      <summary>查看完整归档字段</summary>
                      <pre>{JSON.stringify(record, null, 2)}</pre>
                    </details>
                  </article>
                );
              })}
            </div>
          ) : null}

          <nav className="legacy-history-pagination" aria-label="历史记录分页">
            <NoemaButton
              className="secondary-action"
              type="button"
              disabled={!previousAvailable || loading}
              onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
            >
              上一页
            </NoemaButton>
            <span>第 {pageIndex + 1} 页</span>
            <NoemaButton
              className="secondary-action"
              type="button"
              disabled={!nextAvailable || loading}
              onClick={() => {
                if (page?.nextCursor === null || page?.nextCursor === undefined)
                  return;
                setCursorStack((stack) => [
                  ...stack.slice(0, pageIndex + 1),
                  page.nextCursor,
                ]);
                setPageIndex((index) => index + 1);
              }}
            >
              下一页
            </NoemaButton>
          </nav>
        </section>

        <section
          className="legacy-history-export"
          aria-labelledby="legacy-history-export-title"
        >
          <h3 id="legacy-history-export-title">导出历史记录</h3>
          <p>
            选择类别后先预览导出范围，再选择本机保存位置；不会上传或发送给模型。
          </p>
          <div className="legacy-history-export-categories">
            {categories.map((item) => (
              <NoemaCheckbox
                key={item.id}
                checked={selectedForExport.includes(item.id)}
                onChange={() => toggleExportCategory(item.id)}
                label={`${CATEGORY_LABELS[item.id]}（${item.count}）`}
                disabled={exportBusy}
              />
            ))}
          </div>
          {!preview ? (
            <NoemaButton
              className="secondary-action"
              type="button"
              onClick={() => void createPreview()}
              disabled={exportBusy || selectedForExport.length === 0}
            >
              {exportBusy ? '正在生成预览…' : '预览导出内容'}
            </NoemaButton>
          ) : (
            <div
              className="legacy-history-export-preview"
              aria-labelledby="legacy-history-preview-title"
            >
              <h4 id="legacy-history-preview-title">
                导出预览 · {preview.totalRecords} 条记录
              </h4>
              <p>格式 {preview.format} · 仅导出以下类别，保留源 ID 与类别。</p>
              {preview.categories.map((item) => (
                <details key={item.id}>
                  <summary>
                    {CATEGORY_LABELS[item.id]} · {item.count} 条
                  </summary>
                  {item.sample ? (
                    <pre>{JSON.stringify(item.sample, null, 2)}</pre>
                  ) : (
                    <p>此类别为空。</p>
                  )}
                </details>
              ))}
              <div className="legacy-history-pagination">
                <NoemaButton
                  className="secondary-action"
                  type="button"
                  onClick={() => setPreview(null)}
                  disabled={exportBusy}
                >
                  取消预览
                </NoemaButton>
                <NoemaButton
                  className="primary-action"
                  type="button"
                  onClick={() => void savePreview()}
                  disabled={exportBusy}
                >
                  {exportBusy ? '正在导出…' : '选择本机保存位置'}
                </NoemaButton>
              </div>
            </div>
          )}
        </section>
        {notice ? (
          <p className="diagnostics-feedback" role="status">
            {notice}
          </p>
        ) : null}
      </section>
    </NoemaOverlay>
  ) : null;
}
