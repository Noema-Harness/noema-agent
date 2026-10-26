import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  NoemaSocialProject,
  NoemaProjectPlan,
  NoemaProjectPlanWrite,
  NoemaProjectPlanStatus,
} from './noema-bridge.d.ts';
import './project-plan-panel.css';

type Draft = NoemaProjectPlanWrite['plan'];
const labels: Record<NoemaProjectPlanStatus, string> = {
  pending: '待开始',
  in_progress: '进行中',
  blocked: '受阻',
  submitted: '待验收',
  done: '已验收',
  canceled: '已取消',
};

export function ProjectPlanPanel({ project }: { project: NoemaSocialProject }) {
  const [plan, setPlan] = useState<NoemaProjectPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{
    draft: Draft;
    revision: number;
    reason: string;
  } | null>(null);
  const [action, setAction] = useState<{
    id: string;
    status: NoemaProjectPlanStatus;
    text: string;
  } | null>(null);
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const next = await window.noema.getSocialProjectPlan(project.id);
      if (request === sequence.current)
        setPlan((current) =>
          !current || next.revision >= current.revision ? next : current,
        );
      return next;
    } catch (e) {
      if (request === sequence.current)
        setError(e instanceof Error ? e.message : '计划读取失败。');
      return null;
    }
  }, [project.id]);
  useEffect(() => {
    void reload();
    const off = window.noema.onSocialEvent((event) => {
      if (event.type === 'project-updated' && event.projectId === project.id)
        void reload();
    });
    return () => {
      sequence.current += 1;
      off();
    };
  }, [project.id, reload]);
  const editable = project.status === 'active';
  const members = project.members;
  const name = (id: string) =>
    members.find((m) => m.agentId === id)?.name ?? '原项目成员';
  const beginEdit = async () => {
    const latest = await reload();
    if (!latest) return;
    setError('');
    setAction(null);
    setEditor({
      revision: latest.revision,
      reason: '',
      draft: {
        stage: latest.stage,
        objective: latest.objective,
        items: latest.items.map(
          ({ ready: _ready, blockedBy: _blocked, ...item }) => item,
        ),
      },
    });
  };
  const write = async (fn: () => Promise<NoemaProjectPlan>) => {
    setBusy(true);
    setError('');
    try {
      const saved = await fn();
      setPlan((current) =>
        !current || saved.revision >= current.revision ? saved : current,
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '计划没有保存，请重试。');
      await reload();
      return false;
    } finally {
      setBusy(false);
    }
  };
  const change = (id: string, status: NoemaProjectPlanStatus, text = '') => {
    if (!plan) return Promise.resolve(false);
    return write(() =>
      window.noema.updateSocialProjectPlanItem({
        projectId: project.id,
        expectedRevision: plan.revision,
        itemId: id,
        status,
        ...(status === 'submitted' ? { evidence: text } : {}),
        ...(status === 'blocked' ? { blocker: text } : {}),
        reason:
          status === 'done'
            ? '用户验收当前成果。'
            : `${labels[status]}${text ? `：${text}` : ''}`,
      }),
    );
  };
  const updateDraftItem = (
    id: string,
    patch: Partial<Draft['items'][number]>,
  ) =>
    setEditor((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              items: current.draft.items.map((item) =>
                item.id === id ? { ...item, ...patch } : item,
              ),
            },
          }
        : null,
    );
  return (
    <section
      className="project-plan"
      aria-label="项目共享计划"
      aria-busy={busy}
    >
      <div className="project-plan-head">
        <div>
          <h3>{plan?.stage || '共享计划'}</h3>
          <span className="project-plan-meta">
            {plan?.revision ? `版本 ${plan.revision}` : '尚未建立阶段计划'}
          </span>
        </div>
        {editable && !editor ? (
          <button
            type="button"
            className="quiet"
            disabled={busy || !plan}
            onClick={() => void beginEdit()}
          >
            {plan?.revision ? '编辑计划' : '建立计划'}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="project-plan-error" role="alert">
          {error}{' '}
          <button
            type="button"
            onClick={() => void (editor ? beginEdit() : reload())}
          >
            {editor ? '载入最新计划' : '重试'}
          </button>
        </p>
      ) : null}
      {!plan ? (
        <p aria-live="polite">正在读取计划…</p>
      ) : editor ? (
        <form
          className="project-plan-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void write(() =>
              window.noema.replaceSocialProjectPlan({
                projectId: project.id,
                expectedRevision: editor.revision,
                reason: editor.reason,
                plan: editor.draft,
              }),
            ).then((saved) => {
              if (saved) setEditor(null);
            });
          }}
        >
          <label>
            当前阶段
            <input
              required
              maxLength={120}
              value={editor.draft.stage}
              onChange={(e) =>
                setEditor({
                  ...editor,
                  draft: { ...editor.draft, stage: e.target.value },
                })
              }
            />
          </label>
          <label>
            本阶段目标
            <textarea
              required
              maxLength={4000}
              rows={2}
              value={editor.draft.objective}
              onChange={(e) =>
                setEditor({
                  ...editor,
                  draft: { ...editor.draft, objective: e.target.value },
                })
              }
            />
          </label>
          {editor.draft.items.map((item, index) => (
            <fieldset key={item.id}>
              <legend>交付 {index + 1}</legend>
              <label>
                交付成果
                <input
                  required
                  maxLength={160}
                  value={item.title}
                  onChange={(e) =>
                    updateDraftItem(item.id, { title: e.target.value })
                  }
                />
              </label>
              <div className="project-plan-edit-pair">
                <label>
                  负责人
                  <select
                    value={item.ownerAgentId}
                    onChange={(e) =>
                      updateDraftItem(item.id, { ownerAgentId: e.target.value })
                    }
                    required
                  >
                    <option value="">选择项目成员</option>
                    {members.map((member) => (
                      <option
                        key={member.agentId}
                        value={member.agentId}
                        disabled={
                          member.status !== 'active' ||
                          Boolean(member.agentArchivedAt)
                        }
                      >
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  状态
                  <select
                    value={item.status}
                    onChange={(e) =>
                      updateDraftItem(item.id, {
                        status: e.target.value as NoemaProjectPlanStatus,
                      })
                    }
                  >
                    {Object.entries(labels).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                完成条件
                <textarea
                  required
                  rows={2}
                  maxLength={2000}
                  value={item.acceptance}
                  onChange={(e) =>
                    updateDraftItem(item.id, { acceptance: e.target.value })
                  }
                />
              </label>
              {['submitted', 'done'].includes(item.status) ? (
                <label>
                  成果与验收依据
                  <textarea
                    required
                    maxLength={8000}
                    value={item.evidence}
                    onChange={(e) =>
                      updateDraftItem(item.id, { evidence: e.target.value })
                    }
                  />
                </label>
              ) : null}
              {item.status === 'blocked' ? (
                <label>
                  阻塞原因
                  <input
                    required
                    maxLength={2000}
                    value={item.blocker}
                    onChange={(e) =>
                      updateDraftItem(item.id, { blocker: e.target.value })
                    }
                  />
                </label>
              ) : null}
              {editor.draft.items.length > 1 ? (
                <details>
                  <summary>前置交付 · {item.dependsOn.length} 项</summary>
                  <div className="project-plan-dependencies">
                    {editor.draft.items
                      .filter((other) => other.id !== item.id)
                      .map((other) => (
                        <label key={other.id}>
                          <input
                            type="checkbox"
                            checked={item.dependsOn.includes(other.id)}
                            onChange={(e) =>
                              updateDraftItem(item.id, {
                                dependsOn: e.target.checked
                                  ? [...item.dependsOn, other.id]
                                  : item.dependsOn.filter(
                                      (id) => id !== other.id,
                                    ),
                              })
                            }
                          />
                          {other.title || '尚未命名的交付'}
                        </label>
                      ))}
                  </div>
                </details>
              ) : null}
              {!plan.items.some((saved) => saved.id === item.id) ? (
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    setEditor({
                      ...editor,
                      draft: {
                        ...editor.draft,
                        items: editor.draft.items
                          .filter((entry) => entry.id !== item.id)
                          .map((entry) => ({
                            ...entry,
                            dependsOn: entry.dependsOn.filter(
                              (id) => id !== item.id,
                            ),
                          })),
                      },
                    })
                  }
                >
                  撤销新增
                </button>
              ) : null}
            </fieldset>
          ))}
          <button
            type="button"
            className="quiet"
            disabled={busy || editor.draft.items.length >= 100}
            onClick={() =>
              setEditor({
                ...editor,
                draft: {
                  ...editor.draft,
                  items: [
                    ...editor.draft.items,
                    {
                      id: crypto.randomUUID(),
                      title: '',
                      ownerAgentId:
                        members.find(
                          (member) =>
                            member.status === 'active' &&
                            !member.agentArchivedAt,
                        )?.agentId ?? '',
                      acceptance: '',
                      dependsOn: [],
                      status: 'pending',
                      evidence: '',
                      blocker: '',
                    },
                  ],
                },
              })
            }
          >
            ＋ 添加交付项
          </button>
          <label>
            本次调整的原因
            <input
              required
              maxLength={1000}
              value={editor.reason}
              onChange={(e) => setEditor({ ...editor, reason: e.target.value })}
            />
          </label>
          <div className="project-plan-actions">
            <button className="secondary" type="submit" disabled={busy}>
              {busy ? '保存中…' : '保存计划'}
            </button>
            <button
              className="quiet"
              type="button"
              disabled={busy}
              onClick={() => setEditor(null)}
            >
              取消编辑
            </button>
          </div>
        </form>
      ) : (
        <>
          {plan.objective ? (
            <p className="project-plan-objective">{plan.objective}</p>
          ) : (
            <p className="project-plan-meta">
              阶段目标和交付项会共同构成计划。暂无计划时不估算进度。
            </p>
          )}
          {plan.progress.percentage !== null ? (
            <div className="project-plan-progress">
              <span>
                阶段验收完成率 <strong>{plan.progress.percentage}%</strong>
              </span>
              <span>
                {plan.progress.done} / {plan.progress.total} 项已验收
                {plan.progress.submitted
                  ? `，${plan.progress.submitted} 项待验收`
                  : ''}
              </span>
              <progress
                value={plan.progress.done}
                max={plan.progress.total}
                aria-label="阶段验收完成率"
              />
            </div>
          ) : null}
          {plan.progress.canceled ? (
            <p className="project-plan-meta">
              {plan.progress.canceled} 项已取消，不计入当前阶段比例。
            </p>
          ) : null}
          <ol className="project-plan-list">
            {plan.items.map((item) => (
              <li key={item.id} data-plan-item-id={item.id}>
                <div className="project-plan-item-head">
                  <strong>{item.title}</strong>
                  <span>
                    {name(item.ownerAgentId)} · {labels[item.status]}
                  </span>
                </div>
                <p className="project-plan-acceptance">{item.acceptance}</p>
                {item.dependsOn.length ? (
                  <p className="project-plan-meta">
                    依赖：
                    {item.dependsOn
                      .map(
                        (id) =>
                          plan.items.find((entry) => entry.id === id)?.title ??
                          id,
                      )
                      .join('、')}
                    {item.blockedBy.length ? ' · 前置尚未验收' : ''}
                  </p>
                ) : null}
                {item.blocker && item.status === 'blocked' ? (
                  <p className="project-plan-error">{item.blocker}</p>
                ) : null}
                {item.evidence ? (
                  <details className="project-plan-evidence">
                    <summary>成果依据</summary>
                    <p>{item.evidence}</p>
                  </details>
                ) : null}
                {editable ? (
                  <div className="project-plan-actions">
                    {item.status === 'pending' || item.status === 'blocked' ? (
                      <button
                        className="quiet"
                        type="button"
                        disabled={busy || item.blockedBy.length > 0}
                        onClick={() => void change(item.id, 'in_progress')}
                      >
                        {item.status === 'blocked' ? '继续工作' : '开始'}
                      </button>
                    ) : null}
                    {item.status === 'in_progress' ? (
                      <>
                        <button
                          className="quiet"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setAction({
                              id: item.id,
                              status: 'submitted',
                              text: '',
                            })
                          }
                        >
                          提交成果
                        </button>
                        <button
                          className="quiet"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setAction({
                              id: item.id,
                              status: 'blocked',
                              text: '',
                            })
                          }
                        >
                          记录阻塞
                        </button>
                      </>
                    ) : null}
                    {item.status === 'submitted' ? (
                      <>
                        <button
                          className="quiet"
                          type="button"
                          disabled={busy}
                          onClick={() => void change(item.id, 'done')}
                        >
                          验收通过
                        </button>
                        <button
                          className="quiet"
                          type="button"
                          disabled={busy}
                          onClick={() => void change(item.id, 'in_progress')}
                        >
                          退回完善
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {action?.id === item.id ? (
                  <form
                    className="project-plan-action-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void change(item.id, action.status, action.text).then(
                        (saved) => {
                          if (saved) setAction(null);
                        },
                      );
                    }}
                  >
                    <label>
                      {action.status === 'submitted'
                        ? '成果与核验依据'
                        : '阻塞原因'}
                      <textarea
                        required
                        maxLength={action.status === 'submitted' ? 8000 : 2000}
                        value={action.text}
                        onChange={(e) =>
                          setAction({ ...action, text: e.target.value })
                        }
                      />
                    </label>
                    <div className="project-plan-actions">
                      <button
                        className="secondary"
                        disabled={busy}
                        type="submit"
                      >
                        保存
                      </button>
                      <button
                        className="quiet"
                        type="button"
                        onClick={() => setAction(null)}
                      >
                        取消
                      </button>
                    </div>
                  </form>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
