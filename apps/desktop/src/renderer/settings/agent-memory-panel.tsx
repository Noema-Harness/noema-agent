import { useCallback, useEffect, useState } from 'react';
import { NoemaButton } from '../ui/noema-button';

type Memory = Awaited<
  ReturnType<NonNullable<Window['noema']>['listAgentMemories']>
>['items'][number];

const KIND_LABELS: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  episode: '经历',
  procedure: '做法',
};

const GROUP_TITLES = {
  candidate: '等你确认',
  active: '已生效',
  retired: '已失效',
} as const;

type Group = keyof typeof GROUP_TITLES;

function groupOf(memory: Memory): Group {
  if (memory.status === 'candidate') return 'candidate';
  if (memory.status === 'active') return 'active';
  return 'retired';
}

function sourceLabel(memory: Memory): string {
  if (memory.sourceProjectTitle) return `项目「${memory.sourceProjectTitle}」`;
  if (memory.sourceRoomTitle) return `对话「${memory.sourceRoomTitle}」`;
  if (memory.sourceKind === 'manual') return '手动添加';
  return '来源未记录';
}

function formatDay(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export function AgentMemoryPanel({ agentId = 'noema' }: { agentId?: string }) {
  const [items, setItems] = useState<Memory[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const list = await window.noema.listAgentMemories({ agentId });
      setItems(list.items);
    } catch (loadError) {
      setItems([]);
      setError(
        loadError instanceof Error ? loadError.message : '无法读取记忆。',
      );
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirm = async (id: string) => {
    setBusy(id);
    setNote('');
    try {
      await window.noema.confirmAgentMemory(id);
      setNote('已确认，之后可以被想起。');
      await load();
    } catch (confirmError) {
      setError(
        confirmError instanceof Error ? confirmError.message : '无法确认。',
      );
    } finally {
      setBusy('');
    }
  };

  const retract = async (id: string) => {
    setBusy(id);
    setNote('');
    try {
      await window.noema.retractAgentMemory({ id, reason: '用户在设置中撤销' });
      setNote('已撤销，不再被想起，记录仍可查。');
      setConfirming('');
      await load();
    } catch (retractError) {
      setError(
        retractError instanceof Error ? retractError.message : '无法撤销。',
      );
    } finally {
      setBusy('');
    }
  };

  const groups: Record<Group, Memory[]> = {
    candidate: [],
    active: [],
    retired: [],
  };
  for (const memory of items ?? []) groups[groupOf(memory)].push(memory);

  return (
    <section className="agent-memory-panel" aria-label="Noema 的记忆">
      <div className="agent-memory-heading">
        <h3>记忆</h3>
        <p>Noema 从对话里记下的事。事实等你确认后才使用。</p>
      </div>
      {note ? (
        <p className="agent-memory-note" role="status">
          {note}
        </p>
      ) : null}
      {error ? (
        <p className="agent-memory-error" role="alert">
          {error}
        </p>
      ) : null}
      {items === null ? (
        <p className="agent-memory-muted">正在读取记忆…</p>
      ) : items.length === 0 ? (
        <p className="agent-memory-muted">
          还没有记忆。聊到值得长期记住的事时，Noema 会先记下来。
        </p>
      ) : (
        (Object.keys(GROUP_TITLES) as Group[]).map((group) =>
          groups[group].length ? (
            <div key={group} className="agent-memory-group">
              <h4>{GROUP_TITLES[group]}</h4>
              <ul>
                {groups[group].map((memory) => (
                  <li key={memory.id} className="agent-memory-item">
                    <div className="agent-memory-body">
                      <p className="agent-memory-content">{memory.content}</p>
                      <p className="agent-memory-meta">
                        <span>{KIND_LABELS[memory.kind] ?? memory.kind}</span>
                        <span>{sourceLabel(memory)}</span>
                        <span>{formatDay(memory.updatedAt)}</span>
                      </p>
                    </div>
                    {group === 'candidate' ? (
                      <NoemaButton
                        type="button"
                        disabled={busy === memory.id}
                        onClick={() => void confirm(memory.id)}
                      >
                        确认
                      </NoemaButton>
                    ) : null}
                    {group === 'active' ? (
                      confirming === memory.id ? (
                        <span className="agent-memory-confirm">
                          <NoemaButton
                            type="button"
                            disabled={busy === memory.id}
                            onClick={() => void retract(memory.id)}
                          >
                            撤销
                          </NoemaButton>
                          <NoemaButton
                            type="button"
                            onClick={() => setConfirming('')}
                          >
                            取消
                          </NoemaButton>
                        </span>
                      ) : (
                        <NoemaButton
                          type="button"
                          onClick={() => setConfirming(memory.id)}
                        >
                          撤销
                        </NoemaButton>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )
      )}
    </section>
  );
}
