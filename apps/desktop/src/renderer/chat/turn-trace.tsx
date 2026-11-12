import React, { useState } from 'react';

export type LiveTraceEvent = {
  type: 'tool_call' | 'tool_result';
  name?: string | null;
  status?: string | null;
  stepId?: string | null;
  detail?: string | null;
  output?: string | null;
};

type TraceRow = {
  id: string;
  label: string;
  detail: string | null;
  output: string | null;
  status: 'running' | 'completed' | 'failed';
};

function label(name: string | null | undefined) {
  if (!name) return '工具';
  if (name.includes('start_work_ticket')) return '交给执行者';
  if (name === 'pwsh' || name.includes('command')) return '运行命令';
  if (name === 'read_file' || name === 'read') return '读取文件';
  if (name === 'write_file' || name === 'write') return '写入文件';
  if (name === 'list_files' || name === 'ls') return '列目录';
  if (name === 'edit' || name === 'edit_file') return '编辑文件';
  if (name === 'search_text' || name === 'search' || name === 'search_files')
    return '搜索代码';
  return name;
}

function rowsOf(events: LiveTraceEvent[]) {
  const rows: TraceRow[] = [];
  for (const [index, event] of events.entries()) {
    if (event.type === 'tool_call') {
      rows.push({
        id: event.stepId ?? `step-${index}`,
        label: label(event.name),
        detail: event.detail ?? null,
        output: event.output ?? null,
        status: 'running',
      });
      continue;
    }
    if (event.type !== 'tool_result') continue;
    const row = event.stepId
      ? rows.find((candidate) => candidate.id === event.stepId)
      : rows.find((candidate) => candidate.status === 'running');
    if (!row) continue;
    row.status = event.status === 'failed' ? 'failed' : 'completed';
    if (!row.output && event.output) row.output = event.output;
  }
  return rows;
}

function durationText(durationMs: number | null | undefined) {
  if (!Number.isFinite(durationMs ?? NaN) || (durationMs ?? 0) < 1000) {
    return null;
  }
  const seconds = Math.max(1, Math.round((durationMs as number) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
}

export function TurnTrace({
  events,
  done,
  durationMs,
}: {
  events: LiveTraceEvent[];
  done?: boolean;
  durationMs?: number | null;
}) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = rowsOf(events);
  if (!rows.length) return null;
  const duration = durationText(durationMs);
  const summary = [
    done ? '已完成' : '正在执行',
    duration ? `用时 ${duration}` : null,
    `${rows.length} 步`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section className={`turn-trace${done ? ' is-done' : ''}`}>
      <button
        type="button"
        className="turn-trace-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="turn-trace-live" aria-hidden="true" />
        <span>{summary}</span>
        <span className="turn-trace-chevron" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? (
        <div className="turn-trace-list">
          {rows.map((row) => {
            const isOpen = expanded === row.id;
            return (
              <div
                className={`turn-trace-step is-${row.status}${isOpen ? ' is-open' : ''}`}
                key={row.id}
              >
                <button
                  type="button"
                  className="turn-trace-row"
                  aria-expanded={row.output ? isOpen : undefined}
                  onClick={() => {
                    if (row.output) setExpanded(isOpen ? null : row.id);
                  }}
                >
                  <span className="turn-trace-mark" aria-hidden="true" />
                  <span className="turn-trace-label">{row.label}</span>
                  {row.detail ? (
                    <code className="turn-trace-detail">{row.detail}</code>
                  ) : null}
                  <span className="turn-trace-state">
                    {row.status === 'running'
                      ? '运行中'
                      : row.status === 'failed'
                        ? '失败'
                        : '完成'}
                  </span>
                </button>
                {isOpen && row.output ? (
                  <pre className="turn-trace-output">{row.output}</pre>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
