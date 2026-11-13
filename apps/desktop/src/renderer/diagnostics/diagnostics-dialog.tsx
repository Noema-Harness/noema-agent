/**
 * DORMANT (2026-11-12): no current renderer entrypoint.
 * Retained intentionally for a future diagnostics surface; do not delete as dead code.
 * Revive only together with a real product entrypoint and acceptance case.
 */
import { NoemaCheckbox, NoemaSelect } from '../ui/noema-form-controls';
import { NoemaButton } from '../ui/noema-button';
import { NoemaOverlay } from '../ui/noema-overlay';
import React, { useEffect, useRef, useState } from 'react';
import type {
  NoemaDiagnosticExecution,
  NoemaDiagnosticExportPreview,
  NoemaDiagnosticRuntimeInfo,
  NoemaDiagnosticTimeline,
  NoemaWindowsRunnerCapability,
} from '../../shared/contracts/noema-bridge.d.ts';
import {
  formatCacheBreakdownLabel,
  formatMessageRoleCharactersLabel,
  formatRequestShapeLabel,
  formatTokenUsageLabel,
} from './request-shape-label.ts';
import {
  canOfferWindowsRunnerSetup,
  windowsRunnerReasonLabel,
} from './windows-runner-status.ts';
import { Icon } from '../chat/presentation';

const GAP_LABELS: Record<string, string> = {
  no_persisted_events: '没有找到已保存的执行事件。',
  test_context_unavailable: '所选执行没有可附带的对话或任务内容。',
  provider_usage_unavailable_or_unlinked:
    '模型用量暂不可用，或尚未关联到请求。',
  provider_usage_not_reported: '服务商没有返回本次 token 用量。',
  timeline_truncated: '时间线已达到显示上限，较早事件未显示。',
  task_owner_record_unavailable: '原 task 状态记录暂不可用。',
  diagnostic_event_details_unavailable: '部分事件详情损坏或超限，已安全隐藏。',
  os_child_process_lifecycle_not_recorded:
    '该 DSH 任务缺少子进程启动或退出记录。',
  business_store_row_writes_not_recorded: '当前不逐条记录业务数据库写入。',
  tool_arguments_and_results_not_recorded:
    '该轮记录了工具批次，但不会记录工具参数或返回正文。',
};

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    starting: '启动中',
    running: '运行中',
    completed: '完成',
    failed: '失败',
    interrupted: '中断',
    requested: '已请求',
    granted: '已允许',
    denied: '已拒绝',
    revoked: '已撤回',
    available: '可用',
    unavailable: '不可用',
    observed: '已记录',
    started: '开始',
  };
  return labels[status] ?? status;
}

export function DiagnosticsDialog({
  open,
  onClose,
  onOpenLegacyHistory,
}: {
  open: boolean;
  onClose: () => void;
  onOpenLegacyHistory: () => void;
}) {
  const [executions, setExecutions] = useState<NoemaDiagnosticExecution[]>([]);
  const [runtimeInfo, setRuntimeInfo] =
    useState<NoemaDiagnosticRuntimeInfo | null>(null);
  const [selected, setSelected] = useState<NoemaDiagnosticExecution | null>(
    null,
  );
  const [timeline, setTimeline] = useState<NoemaDiagnosticTimeline | null>(
    null,
  );
  const [preview, setPreview] = useState<NoemaDiagnosticExportPreview | null>(
    null,
  );
  const [includeTestContext, setIncludeTestContext] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listLoadFailed, setListLoadFailed] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineLoadFailed, setTimelineLoadFailed] = useState(false);
  const [timelineRetryVersion, setTimelineRetryVersion] = useState(0);
  const [eventModuleFilter, setEventModuleFilter] = useState('all');
  const [eventPhaseFilter, setEventPhaseFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [runnerCapability, setRunnerCapability] =
    useState<NoemaWindowsRunnerCapability | null>(null);
  const [runnerSetupBusy, setRunnerSetupBusy] = useState(false);
  const [runnerStatusError, setRunnerStatusError] = useState('');
  const [databaseHealth, setDatabaseHealth] = useState<
    'checking' | 'healthy' | 'problem' | 'unavailable'
  >('checking');
  const [dataDirectoryBusy, setDataDirectoryBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setListLoading(true);
    setListLoadFailed(false);
    setError('');
    void window.noema
      .getDiagnosticsRecent(30)
      .then((response) => {
        if (!current) return;
        setExecutions(response.executions);
        setRuntimeInfo(response.runtime);
        if (response.executions.length) setSelected(response.executions[0]);
        else {
          setSelected(null);
          setTimeline(null);
        }
      })
      .catch(() => {
        if (current) setListLoadFailed(true);
      })
      .finally(() => {
        if (current) setListLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open, refreshVersion]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setDatabaseHealth('checking');
    void window.noema
      .getDiagnosticsDatabaseHealth()
      .then((health) => {
        if (current && ['healthy', 'problem', 'unavailable'].includes(health)) {
          setDatabaseHealth(health);
        } else if (current) {
          setDatabaseHealth('unavailable');
        }
      })
      .catch(() => {
        if (current) setDatabaseHealth('unavailable');
      });
    return () => {
      current = false;
    };
  }, [open, refreshVersion]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    const unsubscribe = window.noema.onWindowsRunnerCapabilityChanged(
      (state) => {
        if (current) setRunnerCapability(state);
      },
    );
    void window.noema
      .getWindowsRunnerCapability()
      .then((state) => {
        if (current) {
          setRunnerCapability(state);
          setRunnerStatusError('');
        }
      })
      .catch(() => {
        if (current) setRunnerStatusError('Windows 命令状态暂不可查。');
      });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [open]);

  const startWindowsRunnerSetup = async () => {
    setRunnerSetupBusy(true);
    setRunnerStatusError('');
    try {
      const result = await window.noema.setupWindowsRunner();
      setRunnerCapability(await window.noema.getWindowsRunnerCapability());
      if (result.canceled) setRunnerStatusError('设置已取消；命令仍不可用。');
      else if (!result.supported)
        setRunnerStatusError(windowsRunnerReasonLabel(result.reasonCode));
    } catch {
      setRunnerStatusError('设置没有完成；命令仍保持不可用。');
    } finally {
      setRunnerSetupBusy(false);
    }
  };

  const openDataDirectory = async () => {
    if (dataDirectoryBusy) return;
    setDataDirectoryBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await window.noema.openUserDataDirectory();
      if (result.opened) {
        setNotice(
          '已打开 Noema 数据与备份目录。手动复制或恢复文件前，请先退出 Noema；应用不会自动更改这些文件。',
        );
      } else {
        setError('Noema 数据目录无法打开，请检查目录权限后重试。');
      }
    } catch {
      setError('Noema 数据目录暂不可打开。');
    } finally {
      setDataDirectoryBusy(false);
    }
  };

  useEffect(() => {
    if (!open || !selected) return;
    let current = true;
    setTimelineLoading(true);
    setTimelineLoadFailed(false);
    setTimeline(null);
    setPreview(null);
    setError('');
    void window.noema
      .getDiagnosticsTimeline({
        executionId: selected.executionId,
        taskId: selected.taskId,
      })
      .then((result) => {
        if (current) setTimeline(result);
      })
      .catch(() => {
        if (current) setTimelineLoadFailed(true);
      })
      .finally(() => {
        if (current) setTimelineLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open, selected, timelineRetryVersion]);

  const timelineEvents = timeline?.events ?? [];
  const eventModules = [
    ...new Set(timelineEvents.map((event) => event.module)),
  ].sort((left, right) => left.localeCompare(right));
  const eventPhases = [
    ...new Set(timelineEvents.map((event) => event.status)),
  ].sort((left, right) => left.localeCompare(right));
  const filteredEvents = timelineEvents.filter(
    (event) =>
      (eventModuleFilter === 'all' || event.module === eventModuleFilter) &&
      (eventPhaseFilter === 'all' || event.status === eventPhaseFilter),
  );

  const close = () => {
    if (saving) return;
    setPreview(null);
    setIncludeTestContext(false);
    setEventModuleFilter('all');
    setEventPhaseFilter('all');
    setNotice('');
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusables = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((item) => item.getClientRects().length > 0);
    requestAnimationFrame(() => {
      (
        dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
        focusables()[0] ??
        dialog
      ).focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0].focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open, saving]);

  const prepareExport = async () => {
    if (!selected) return;
    setError('');
    setNotice('');
    try {
      const result = await window.noema.previewDiagnosticsExport({
        executionId: selected.executionId,
        taskId: selected.taskId,
        includeTestContext,
      });
      setPreview(result);
    } catch {
      setError('无法生成导出预览。');
    }
  };

  const saveExport = async () => {
    if (!preview || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await window.noema.saveDiagnosticsExport(
        preview.previewId,
      );
      if (result.canceled) {
        setPreview(null);
      } else if (result.saved) {
        setPreview(null);
        setNotice(`已保存 ${result.fileName ?? '诊断报告'}。`);
      } else {
        setError(
          result.errorCode === 'write_failed'
            ? '保存失败，请检查所选位置后重试。'
            : '导出预览已失效，请重新生成。',
        );
      }
    } catch {
      setError('保存失败，在线诊断记录没有改变。');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  return (
    <NoemaOverlay isOpen onClose={close} className="diagnostics-backdrop">
      <section
        ref={dialogRef}
        className="social-dialog diagnostics-dialog"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagnostics-title"
      >
        <header className="dialog-heading diagnostics-heading">
          <div>
            <p className="diagnostics-eyebrow">本机运行记录</p>
            <h2 id="diagnostics-title">运行诊断</h2>
            <p>查看执行、模型用量和任务状态。记录只保存在此设备。</p>
          </div>
          <NoemaButton
            className="secondary-action diagnostics-history-link"
            type="button"
            onClick={onOpenLegacyHistory}
          >
            历史归档
          </NoemaButton>
          <NoemaButton
            className="icon-button"
            type="button"
            aria-label="关闭运行诊断"
            data-dialog-initial-focus
            onClick={close}
            disabled={saving}
          >
            <Icon name="close" />
          </NoemaButton>
        </header>

        <details className="diagnostics-runtime-info">
          <summary>应用与数据版本</summary>
          <p>
            Noema {runtimeInfo?.applicationVersion ?? window.noema.appVersion}
            {' · '}Electron {runtimeInfo?.electronVersion ?? '未知'}
            {' · '}Node {runtimeInfo?.nodeVersion ?? '未知'}
          </p>
          <p>
            {runtimeInfo?.platform ?? '未知平台'}{' '}
            {runtimeInfo?.architecture ?? ''}
            {runtimeInfo?.osVersion ? ` · 系统 ${runtimeInfo.osVersion}` : ''}
            {runtimeInfo?.isPackaged ? ' · 安装/打包版本' : ' · 开发版本'}
          </p>
          <p>
            SocialChat schema v{runtimeInfo?.socialSchemaVersion ?? '未知'}
            {' · '}Diagnostics schema v
            {runtimeInfo?.diagnosticsSchemaVersion ?? '未知'}
          </p>
        </details>

        <section
          className="diagnostics-runner-capability"
          aria-label="本机数据库状态"
        >
          <div>
            <strong>本机数据库完整性检查</strong>
            <p role="status" aria-label="数据库检查状态">
              {databaseHealth === 'checking'
                ? '正在检查…'
                : databaseHealth === 'healthy'
                  ? '检查通过。'
                  : databaseHealth === 'problem'
                    ? '检查发现问题。请保留现有文件，并先退出 Noema 再进行恢复。'
                    : '暂时无法检查。请保留现有文件，并先退出 Noema 再进行恢复。'}
            </p>
            <p>迁移快照与数据库位于同一目录；诊断不会自动替换或删除文件。</p>
          </div>
          <NoemaButton
            className="secondary-action"
            type="button"
            aria-label="打开 Noema 数据与备份目录"
            onClick={() => void openDataDirectory()}
            disabled={dataDirectoryBusy}
          >
            <Icon name="folder-open" />
            {dataDirectoryBusy ? '正在打开…' : '打开数据与备份目录'}
          </NoemaButton>
        </section>

        {runnerCapability?.platform === 'win32' ? (
          <section
            className="diagnostics-runner-capability"
            aria-label="Windows 命令隔离能力"
          >
            <div>
              <strong>
                Windows 命令隔离：
                {runnerCapability.supported ? '可用' : '不可用'}
              </strong>
              <p>
                {runnerCapability.supported
                  ? `${runnerCapability.backendId ?? 'Windows runner'} ${runnerCapability.backendVersion ?? ''} · 协议 ${runnerCapability.protocolVersion ?? '未知'}`
                  : runnerStatusError ||
                    windowsRunnerReasonLabel(
                      runnerCapability.reasonCodes.length > 0
                        ? runnerCapability.reasonCodes
                        : runnerCapability.reasonCode,
                    )}
              </p>
              <p>此状态只影响 Windows 项目命令，不影响 Noema 桌面应用运行。</p>
            </div>
            {canOfferWindowsRunnerSetup(runnerCapability) &&
            runnerCapability.backendId ? (
              <NoemaButton
                className="secondary-action"
                type="button"
                onClick={() => void startWindowsRunnerSetup()}
                disabled={runnerSetupBusy}
              >
                {runnerSetupBusy ? '正在设置…' : '完成或修复隔离设置'}
              </NoemaButton>
            ) : null}
          </section>
        ) : runnerStatusError ? (
          <p className="diagnostics-runner-unavailable" role="status">
            {runnerStatusError}
          </p>
        ) : null}

        <div className="diagnostics-body">
          <aside className="diagnostics-execution-list" aria-label="最近执行">
            <div className="diagnostics-section-heading">
              <h3>最近执行</h3>
              <div className="diagnostics-list-tools">
                <span>
                  {listLoadFailed && !executions.length
                    ? '—'
                    : executions.length}
                </span>
                <NoemaButton
                  className="diagnostics-refresh"
                  type="button"
                  aria-label="刷新诊断记录"
                  onClick={() => setRefreshVersion((value) => value + 1)}
                  disabled={listLoading}
                >
                  刷新
                </NoemaButton>
              </div>
            </div>
            {listLoading && !executions.length ? (
              <p className="diagnostics-muted">正在读取记录…</p>
            ) : listLoadFailed && !executions.length ? (
              <div className="diagnostics-list-retry" role="alert">
                <span>本机诊断记录暂不可读取。</span>
                <NoemaButton
                  className="secondary-action"
                  type="button"
                  onClick={() => setRefreshVersion((value) => value + 1)}
                  disabled={listLoading}
                >
                  重试
                </NoemaButton>
              </div>
            ) : executions.length ? (
              <>
                {listLoadFailed ? (
                  <p className="diagnostics-list-stale" role="status">
                    刷新失败，当前显示上次读取的记录。
                  </p>
                ) : null}
                <ul>
                  {executions.map((execution) => (
                    <li key={execution.executionId}>
                      <NoemaButton
                        type="button"
                        className={`diagnostics-execution${selected?.executionId === execution.executionId ? ' is-selected' : ''}`}
                        aria-current={
                          selected?.executionId === execution.executionId
                            ? 'true'
                            : undefined
                        }
                        onClick={() => {
                          setSelected(execution);
                          setEventModuleFilter('all');
                          setEventPhaseFilter('all');
                          setPreview(null);
                          setIncludeTestContext(false);
                          setNotice('');
                        }}
                      >
                        <span className="diagnostics-execution-title">
                          {execution.taskId ? '工作区任务' : '聊天执行'}
                        </span>
                        <span className="diagnostics-execution-state">
                          {statusLabel(execution.status)}
                          <time dateTime={execution.occurredAt}>
                            {dateTime(execution.occurredAt)}
                          </time>
                        </span>
                        <span className="diagnostics-execution-usage">
                          {execution.inputTokens === null
                            ? 'Token 用量未知'
                            : `输入 ${execution.inputTokens.toLocaleString()} · 输出 ${(execution.outputTokens ?? 0).toLocaleString()}`}
                        </span>
                      </NoemaButton>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="diagnostics-muted">还没有可显示的执行记录。</p>
            )}
          </aside>

          <section className="diagnostics-timeline" aria-label="执行详情">
            {selected ? (
              <>
                <div className="diagnostics-section-heading diagnostics-detail-heading">
                  <div>
                    <h3>{selected.taskId ? '任务时间线' : '执行时间线'}</h3>
                    <code>{selected.taskId ?? selected.executionId}</code>
                  </div>
                  <NoemaButton
                    className="secondary-action"
                    type="button"
                    onClick={() => void prepareExport()}
                    disabled={timelineLoading || timelineLoadFailed || saving}
                  >
                    导出报告
                  </NoemaButton>
                </div>

                {timelineLoadFailed ? (
                  <div className="diagnostics-list-retry" role="alert">
                    <span>无法读取这条执行时间线。</span>
                    <NoemaButton
                      className="secondary-action"
                      type="button"
                      onClick={() =>
                        setTimelineRetryVersion((value) => value + 1)
                      }
                      disabled={timelineLoading}
                    >
                      重试时间线
                    </NoemaButton>
                  </div>
                ) : null}

                <label className="diagnostics-context-toggle">
                  <NoemaCheckbox
                    type="checkbox"
                    checked={includeTestContext}
                    onChange={(event) => {
                      setIncludeTestContext(event.currentTarget.checked);
                      setPreview(null);
                    }}
                  />
                  <span>
                    <strong>附带这次实测的对话与任务内容</strong>
                    <small>
                      可能含个人信息、路径或命令文本；先完整预览，再由你选择本地保存。不会自动上传。
                    </small>
                  </span>
                </label>

                {timeline?.task ? (
                  <div className="diagnostics-task-summary">
                    <span>任务：{statusLabel(timeline.task.status)}</span>
                    {timeline.task.verificationStatus ? (
                      <span>
                        验证：{statusLabel(timeline.task.verificationStatus)}
                      </span>
                    ) : null}
                    {timeline.task.errorCode ? (
                      <code>错误码：{timeline.task.errorCode}</code>
                    ) : null}
                    <span>工具步骤：{timeline.task.executionSteps.length}</span>
                  </div>
                ) : null}

                {timeline?.coverageGaps.length ? (
                  <aside
                    className="diagnostics-coverage"
                    aria-label="追踪覆盖边界"
                  >
                    <strong>当前追踪边界</strong>
                    <ul>
                      {timeline.coverageGaps.map((gap) => (
                        <li key={gap}>
                          {GAP_LABELS[gap] ?? '部分诊断数据不可用。'}
                        </li>
                      ))}
                    </ul>
                  </aside>
                ) : null}

                {timelineLoading || listLoading ? (
                  <p className="diagnostics-muted">正在读取时间线…</p>
                ) : null}
                {timeline?.usage.length ? (
                  <section className="diagnostics-usage" aria-label="模型用量">
                    <h4>模型请求</h4>
                    {timeline.usage.map((usage, index) => (
                      <div
                        className="diagnostics-usage-row"
                        key={`${usage.requestId ?? index}-${index}`}
                      >
                        <span>
                          {usage.model} · {usage.operation}
                        </span>
                        <span>{formatTokenUsageLabel(usage)}</span>
                        {usage.requestId ? (
                          <small>请求 ID：{usage.requestId}</small>
                        ) : null}
                        <small>{formatRequestShapeLabel(usage)}</small>
                        <small>
                          {formatMessageRoleCharactersLabel(
                            usage.messageRoleCharacters,
                          )}
                        </small>
                        {formatCacheBreakdownLabel(usage) ? (
                          <small>{formatCacheBreakdownLabel(usage)}</small>
                        ) : null}
                        <time dateTime={usage.createdAt}>
                          {dateTime(usage.createdAt)}
                        </time>
                      </div>
                    ))}
                  </section>
                ) : null}

                {timeline ? (
                  <div
                    className="diagnostics-event-filters"
                    role="group"
                    aria-label="筛选诊断事件"
                  >
                    <span>
                      显示 {filteredEvents.length} / {timelineEvents.length}{' '}
                      条事件
                    </span>
                    <NoemaSelect
                      aria-label="按模块筛选诊断事件"
                      value={eventModuleFilter}
                      onChange={(event) =>
                        setEventModuleFilter(event.currentTarget.value)
                      }
                    >
                      <option value="all">所有模块</option>
                      {eventModules.map((module) => (
                        <option value={module} key={module}>
                          {module}
                        </option>
                      ))}
                    </NoemaSelect>
                    <NoemaSelect
                      aria-label="按阶段筛选诊断事件"
                      value={eventPhaseFilter}
                      onChange={(event) =>
                        setEventPhaseFilter(event.currentTarget.value)
                      }
                    >
                      <option value="all">所有阶段</option>
                      {eventPhases.map((phase) => (
                        <option value={phase} key={phase}>
                          {statusLabel(phase)}
                        </option>
                      ))}
                    </NoemaSelect>
                  </div>
                ) : null}
                {timeline && filteredEvents.length ? (
                  <ol className="diagnostics-event-list" aria-label="诊断事件">
                    {filteredEvents.map((event) => (
                      <li key={event.eventId}>
                        <time dateTime={event.occurredAt}>
                          {dateTime(event.occurredAt)}
                        </time>
                        <div>
                          <strong>{event.operation}</strong>
                          <span>
                            {event.module} · {statusLabel(event.status)}
                          </span>
                          {event.errorCode ? (
                            <code>错误码：{event.errorCode}</code>
                          ) : null}
                          {event.requestId ? (
                            <code>请求 ID：{event.requestId}</code>
                          ) : null}
                          {event.toolCallId ? (
                            <code>工具调用 ID：{event.toolCallId}</code>
                          ) : null}
                          {event.parentExecutionId ? (
                            <small>父执行 ID：{event.parentExecutionId}</small>
                          ) : null}
                          {event.details.handoffId ? (
                            <small>交办 ID：{event.details.handoffId}</small>
                          ) : null}
                          {event.details.memberAgentId ? (
                            <small>
                              成员 ID：{event.details.memberAgentId}
                            </small>
                          ) : null}
                          {event.details.parentInteractionId ? (
                            <small>
                              父回复 ID：{event.details.parentInteractionId}
                            </small>
                          ) : null}
                          {event.details.assistantMessageId ? (
                            <small>
                              回复消息 ID：{event.details.assistantMessageId}
                            </small>
                          ) : null}
                          {event.module === 'social.memory' &&
                          event.details.itemId ? (
                            <small>记忆 ID：{event.details.itemId}</small>
                          ) : null}
                          {event.details.toolCategory ? (
                            <small>
                              工具类别：{event.details.toolCategory}
                            </small>
                          ) : null}
                          {event.details.toolName ? (
                            <small>工具：{event.details.toolName}</small>
                          ) : null}
                          {event.details.effectStatus ? (
                            <small>副作用：{event.details.effectStatus}</small>
                          ) : null}
                          {event.detailsStatus === 'filtered' ? (
                            <small>部分事件详情已按隐私规则过滤</small>
                          ) : null}
                          {event.detailsStatus === 'unavailable' ? (
                            <small>事件详情不可读取，已安全隐藏</small>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : timeline ? (
                  <div className="diagnostics-empty diagnostics-filter-empty">
                    <strong>
                      {timelineEvents.length
                        ? '当前筛选没有匹配事件'
                        : '此执行暂时没有诊断事件'}
                    </strong>
                    {timelineEvents.length ? (
                      <NoemaButton
                        className="secondary-action"
                        type="button"
                        onClick={() => {
                          setEventModuleFilter('all');
                          setEventPhaseFilter('all');
                        }}
                      >
                        清除筛选
                      </NoemaButton>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="diagnostics-empty">
                <strong>
                  {listLoadFailed
                    ? '记录暂不可读取'
                    : executions.length
                      ? '选择一条执行记录'
                      : '暂无执行记录'}
                </strong>
                <span>
                  {listLoadFailed
                    ? '读取失败不会影响 Noema 的聊天和任务。'
                    : '当 Noema 开始处理聊天或工作区任务后，记录会显示在这里。'}
                </span>
              </div>
            )}
          </section>
        </div>

        {preview ? (
          <div
            className="diagnostics-preview"
            role="region"
            aria-labelledby="diagnostics-preview-title"
          >
            <div>
              <h3 id="diagnostics-preview-title">导出前确认</h3>
              <p>
                报告 v{preview.schemaVersion} · {preview.eventCount} 个事件 ·{' '}
                {preview.usageCount} 条模型用量
              </p>
              {preview.includesTestContext ? (
                <p className="diagnostics-context-warning">
                  此报告包含所选轮次的对话或任务文本，凭据形状内容已尝试脱敏；仍可能含个人信息、路径或命令文本。保存前请检查下方完整预览。
                </p>
              ) : null}
              <div className="diagnostics-preview-columns">
                <section>
                  <strong>包含</strong>
                  <ul>
                    {preview.included.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <strong>不包含</strong>
                  <ul>
                    {preview.excluded.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              </div>
              {preview.coverageGaps.length ? (
                <p className="diagnostics-preview-gap">
                  存在 {preview.coverageGaps.length}{' '}
                  项追踪覆盖边界，报告会列明。
                </p>
              ) : null}
              <details className="diagnostics-preview-content">
                <summary>查看将保存的完整报告</summary>
                <pre>{preview.reportJson}</pre>
              </details>
            </div>
            <div className="diagnostics-preview-actions">
              <NoemaButton
                type="button"
                className="secondary-action"
                onClick={() => setPreview(null)}
                disabled={saving}
              >
                取消
              </NoemaButton>
              <NoemaButton
                type="button"
                className="primary-action"
                onClick={() => void saveExport()}
                disabled={saving}
              >
                {saving ? '正在保存…' : '选择本地位置'}
              </NoemaButton>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="diagnostics-feedback is-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="diagnostics-feedback" role="status">
            {notice}
          </p>
        ) : null}
      </section>
    </NoemaOverlay>
  );
}
