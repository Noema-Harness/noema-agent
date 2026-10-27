import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  NoemaProjectPlan,
  NoemaProjectPlanItem,
  NoemaProjectPlanItemUpdate,
  NoemaProjectPlanPhase,
  NoemaProjectPlanPhaseState,
  NoemaProjectPlanPhaseUpdate,
  NoemaProjectPlanStatus,
  NoemaProjectPlanWrite,
  NoemaSocialProject,
} from './noema-bridge.d.ts';
import './project-plan-panel.css';

type Draft = NoemaProjectPlanWrite['plan'];
type DraftPhase = Draft['phases'][number];
type DraftItem = DraftPhase['workItems'][number];

const itemLabels: Record<NoemaProjectPlanStatus, string> = {
  pending: '待开始',
  in_progress: '进行中',
  blocked: '受阻',
  submitted: '待验收',
  done: '已验收',
  canceled: '已取消',
};
const phaseLabels: Record<NoemaProjectPlanPhaseState, string> = {
  needs_breakdown: '待细化',
  waiting: '等待前置阶段',
  ready: '可开始',
  pending: '待开始',
  in_progress: '进行中',
  blocked: '有阻塞',
  awaiting_review: '阶段待验收',
  done: '阶段已验收',
  canceled: '已取消',
};

function draftFromPlan(plan: NoemaProjectPlan): Draft {
  return {
    objective: plan.objective,
    phases: plan.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      outcome: phase.outcome,
      exitCriteria: phase.exitCriteria,
      dependsOn: phase.dependsOn,
      status: phase.status,
      evidence: phase.evidence,
      workItems: phase.workItems.map(
        ({
          id,
          title,
          ownerAgentId,
          acceptance,
          dependsOn,
          status,
          evidence,
          blocker,
        }) => ({
          id,
          title,
          ownerAgentId,
          acceptance,
          dependsOn,
          status,
          evidence,
          blocker,
        }),
      ),
    })),
  };
}

export function ProjectPlanPanel({ project }: { project: NoemaSocialProject }) {
  const [plan, setPlan] = useState<NoemaProjectPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{
    draft: Draft;
    revision: number;
    reason: string;
  } | null>(null);
  const [phaseReview, setPhaseReview] = useState<{
    id: string;
    evidence: string;
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
    members.find((member) => member.agentId === id)?.name ?? '原项目成员';
  const savedIds = new Set(plan?.items.map((item) => item.id) ?? []);
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
  const beginEdit = async () => {
    const latest = await reload();
    if (!latest) return;
    setError('');
    setPhaseReview(null);
    setAction(null);
    setEditor({
      revision: latest.revision,
      reason: '',
      draft: draftFromPlan(latest),
    });
  };
  const updateObjective = (objective: string) =>
    setEditor((current) =>
      current ? { ...current, draft: { ...current.draft, objective } } : null,
    );
  const updatePhase = (id: string, patch: Partial<DraftPhase>) =>
    setEditor((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              phases: current.draft.phases.map((phase) =>
                phase.id === id ? { ...phase, ...patch } : phase,
              ),
            },
          }
        : null,
    );
  const updateItem = (id: string, patch: Partial<DraftItem>) =>
    setEditor((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              phases: current.draft.phases.map((phase) => ({
                ...phase,
                workItems: phase.workItems.map((item) =>
                  item.id === id ? { ...item, ...patch } : item,
                ),
              })),
            },
          }
        : null,
    );
  const addPhase = () =>
    setEditor((current) => {
      if (!current || current.draft.phases.length >= 30) return current;
      const phase: DraftPhase = {
        id: crypto.randomUUID(),
        title: '',
        outcome: '',
        exitCriteria: '',
        dependsOn: [],
        status: 'pending',
        evidence: '',
        workItems: [],
      };
      return {
        ...current,
        draft: { ...current.draft, phases: [...current.draft.phases, phase] },
      };
    });
  const addItem = (phaseId: string) =>
    setEditor((current) => {
      if (!current) return current;
      const count = current.draft.phases.reduce(
        (total, phase) => total + phase.workItems.length,
        0,
      );
      if (count >= 100) return current;
      const item: DraftItem = {
        id: crypto.randomUUID(),
        title: '',
        ownerAgentId:
          members.find(
            (member) => member.status === 'active' && !member.agentArchivedAt,
          )?.agentId ?? '',
        acceptance: '',
        dependsOn: [],
        status: 'pending',
        evidence: '',
        blocker: '',
      };
      return {
        ...current,
        draft: {
          ...current.draft,
          phases: current.draft.phases.map((phase) =>
            phase.id === phaseId
              ? { ...phase, workItems: [...phase.workItems, item] }
              : phase,
          ),
        },
      };
    });
  const removeNewItem = (phaseId: string, itemId: string) =>
    setEditor((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              phases: current.draft.phases.map((phase) => ({
                ...phase,
                workItems: phase.workItems
                  .filter(
                    (item) => !(phase.id === phaseId && item.id === itemId),
                  )
                  .map((item) => ({
                    ...item,
                    dependsOn: item.dependsOn.filter((id) => id !== itemId),
                  })),
              })),
            },
          }
        : null,
    );
  const changeItem = (
    item: NoemaProjectPlanItem,
    status: NoemaProjectPlanStatus,
    evidenceOrBlocker = '',
  ) => {
    if (!plan) return Promise.resolve(false);
    const input: NoemaProjectPlanItemUpdate = {
      projectId: project.id,
      expectedRevision: plan.revision,
      itemId: item.id,
      status,
      ...(status === 'submitted' ? { evidence: evidenceOrBlocker } : {}),
      ...(status === 'blocked' ? { blocker: evidenceOrBlocker } : {}),
      reason:
        status === 'done'
          ? '用户核验并验收当前工作项。'
          : `${itemLabels[status]}${evidenceOrBlocker ? `：${evidenceOrBlocker}` : ''}`,
    };
    return write(() => window.noema.updateSocialProjectPlanItem(input));
  };
  const changePhase = (
    phase: NoemaProjectPlanPhase,
    status: NoemaProjectPlanPhaseUpdate['status'],
    evidence = '',
  ) => {
    if (!plan) return Promise.resolve(false);
    const input: NoemaProjectPlanPhaseUpdate = {
      projectId: project.id,
      expectedRevision: plan.revision,
      phaseId: phase.id,
      status,
      ...(status === 'done' ? { evidence } : {}),
      reason:
        status === 'done'
          ? '用户核验阶段成果与退出条件并验收阶段。'
          : `阶段状态调整为${status === 'canceled' ? '取消' : '待验收'}`,
    };
    return write(() => window.noema.updateSocialProjectPlanPhase(input));
  };
  const flattenedDraftItems =
    editor?.draft.phases.flatMap((phase) =>
      phase.workItems.map((item) => ({
        ...item,
        phaseTitle: phase.title || '未命名阶段',
      })),
    ) ?? [];

  return (
    <section
      className="project-plan"
      aria-label="项目团队计划"
      aria-busy={busy}
    >
      <div className="project-plan-head">
        <div>
          <h3>团队计划</h3>
          <span className="project-plan-meta">
            {plan?.revision ? `版本 ${plan.revision}` : '尚未建立团队计划'}
          </span>
        </div>
        {editable && !editor ? (
          <button
            type="button"
            className="quiet"
            disabled={busy || !plan}
            onClick={() => void beginEdit()}
          >
            {plan?.revision ? '调整计划' : '建立计划'}
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
            项目结果
            <textarea
              required
              maxLength={4000}
              rows={2}
              value={editor.draft.objective}
              onChange={(event) => updateObjective(event.target.value)}
            />
          </label>
          {editor.draft.phases.map((phase, phaseIndex) => {
            return (
              <fieldset className="project-plan-edit-phase" key={phase.id}>
                <legend>阶段 {phaseIndex + 1}</legend>
                <label>
                  阶段名称
                  <input
                    required
                    maxLength={160}
                    value={phase.title}
                    onChange={(event) =>
                      updatePhase(phase.id, { title: event.target.value })
                    }
                  />
                </label>
                <label>
                  阶段成果
                  <textarea
                    required
                    rows={2}
                    maxLength={2000}
                    value={phase.outcome}
                    onChange={(event) =>
                      updatePhase(phase.id, { outcome: event.target.value })
                    }
                  />
                </label>
                <label>
                  退出条件
                  <textarea
                    required
                    rows={2}
                    maxLength={2000}
                    value={phase.exitCriteria}
                    onChange={(event) =>
                      updatePhase(phase.id, {
                        exitCriteria: event.target.value,
                      })
                    }
                  />
                </label>
                {editor.draft.phases.length > 1 ? (
                  <details className="project-plan-dependency-editor">
                    <summary>前置阶段 · {phase.dependsOn.length} 项</summary>
                    <div className="project-plan-dependencies">
                      {editor.draft.phases
                        .filter((other) => other.id !== phase.id)
                        .map((other) => (
                          <label key={other.id}>
                            <input
                              type="checkbox"
                              checked={phase.dependsOn.includes(other.id)}
                              onChange={(event) =>
                                updatePhase(phase.id, {
                                  dependsOn: event.target.checked
                                    ? [...phase.dependsOn, other.id]
                                    : phase.dependsOn.filter(
                                        (id) => id !== other.id,
                                      ),
                                })
                              }
                            />
                            {other.title || '尚未命名阶段'}
                          </label>
                        ))}
                    </div>
                  </details>
                ) : null}
                {phase.evidence ? (
                  <p className="project-plan-meta">
                    已验收依据：{phase.evidence}
                  </p>
                ) : null}
                <ol className="project-plan-edit-items">
                  {phase.workItems.map((item, itemIndex) => (
                    <li key={item.id}>
                      <fieldset className="project-plan-edit-item">
                        <legend>工作项 {itemIndex + 1}</legend>
                        <label>
                          交付内容
                          <input
                            required
                            maxLength={160}
                            value={item.title}
                            onChange={(event) =>
                              updateItem(item.id, { title: event.target.value })
                            }
                          />
                        </label>
                        <div className="project-plan-edit-pair">
                          <label>
                            负责人
                            <select
                              value={item.ownerAgentId}
                              onChange={(event) =>
                                updateItem(item.id, {
                                  ownerAgentId: event.target.value,
                                })
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
                            工作状态
                            <select
                              value={item.status}
                              onChange={(event) =>
                                updateItem(item.id, {
                                  status: event.target
                                    .value as NoemaProjectPlanStatus,
                                })
                              }
                            >
                              {Object.entries(itemLabels).map(
                                ([value, label]) => (
                                  <option value={value} key={value}>
                                    {label}
                                  </option>
                                ),
                              )}
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
                            onChange={(event) =>
                              updateItem(item.id, {
                                acceptance: event.target.value,
                              })
                            }
                          />
                        </label>
                        {['submitted', 'done'].includes(item.status) ? (
                          <label>
                            成果依据
                            <textarea
                              required
                              maxLength={8000}
                              value={item.evidence}
                              onChange={(event) =>
                                updateItem(item.id, {
                                  evidence: event.target.value,
                                })
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
                              onChange={(event) =>
                                updateItem(item.id, {
                                  blocker: event.target.value,
                                })
                              }
                            />
                          </label>
                        ) : null}
                        {flattenedDraftItems.length > 1 ? (
                          <details className="project-plan-dependency-editor">
                            <summary>
                              前置工作项 · {item.dependsOn.length} 项
                            </summary>
                            <div className="project-plan-dependencies">
                              {flattenedDraftItems
                                .filter((other) => other.id !== item.id)
                                .map((other) => (
                                  <label key={other.id}>
                                    <input
                                      type="checkbox"
                                      checked={item.dependsOn.includes(
                                        other.id,
                                      )}
                                      onChange={(event) =>
                                        updateItem(item.id, {
                                          dependsOn: event.target.checked
                                            ? [...item.dependsOn, other.id]
                                            : item.dependsOn.filter(
                                                (id) => id !== other.id,
                                              ),
                                        })
                                      }
                                    />
                                    {other.phaseTitle} ·{' '}
                                    {other.title || '未命名工作项'}
                                  </label>
                                ))}
                            </div>
                          </details>
                        ) : null}
                        {!savedIds.has(item.id) ? (
                          <button
                            type="button"
                            className="quiet"
                            disabled={busy}
                            onClick={() => removeNewItem(phase.id, item.id)}
                          >
                            撤销新增
                          </button>
                        ) : null}
                      </fieldset>
                    </li>
                  ))}
                </ol>
                {phase.workItems.length === 0 ? (
                  <p className="project-plan-meta">
                    阶段目标已保留，工作项可在进入前继续细化。
                  </p>
                ) : null}
                <button
                  type="button"
                  className="quiet"
                  disabled={busy || flattenedDraftItems.length >= 100}
                  onClick={() => addItem(phase.id)}
                >
                  ＋ 添加工作项
                </button>
                {!plan.phases.some((saved) => saved.id === phase.id) ? (
                  <button
                    type="button"
                    className="quiet project-plan-remove-new"
                    disabled={busy || phase.workItems.length > 0}
                    onClick={() =>
                      setEditor({
                        ...editor,
                        draft: {
                          ...editor.draft,
                          phases: editor.draft.phases
                            .filter((entry) => entry.id !== phase.id)
                            .map((entry) => ({
                              ...entry,
                              dependsOn: entry.dependsOn.filter(
                                (id) => id !== phase.id,
                              ),
                            })),
                        },
                      })
                    }
                  >
                    移除空白阶段
                  </button>
                ) : null}
              </fieldset>
            );
          })}
          <button
            type="button"
            className="quiet"
            disabled={busy || editor.draft.phases.length >= 30}
            onClick={addPhase}
          >
            ＋ 添加阶段
          </button>
          <label>
            本次计划调整的原因
            <input
              required
              maxLength={1000}
              value={editor.reason}
              onChange={(event) =>
                setEditor({ ...editor, reason: event.target.value })
              }
            />
          </label>
          <div className="project-plan-actions">
            <button className="secondary" type="submit" disabled={busy}>
              {busy ? '保存中…' : '保存计划修订'}
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
              先确定项目结果，再逐步细化阶段和工作项；未定义的远期工作不计入进度。
            </p>
          )}
          {plan.phaseProgress.percentage !== null ? (
            <div className="project-plan-progress project-plan-phase-overview">
              <span>
                阶段进度 <strong>{plan.phaseProgress.percentage}%</strong>
              </span>
              <span>
                {plan.phaseProgress.done} / {plan.phaseProgress.total}{' '}
                个阶段已验收
              </span>
              <progress
                value={plan.phaseProgress.done}
                max={plan.phaseProgress.total}
                aria-label="阶段验收进度"
              />
            </div>
          ) : null}
          {plan.progress.percentage !== null ? (
            <div className="project-plan-progress">
              <span>
                已定义工作项验收率 <strong>{plan.progress.percentage}%</strong>
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
                aria-label="已定义工作项验收率"
              />
            </div>
          ) : null}
          {plan.progress.canceled ? (
            <p className="project-plan-meta">
              {plan.progress.canceled} 项已取消，不计入当前工作项比例。
            </p>
          ) : null}
          <ol className="project-plan-phases">
            {plan.phases.map((phase, index) => (
              <li
                className={`project-plan-phase state-${phase.state}`}
                key={phase.id}
                data-plan-phase-id={phase.id}
              >
                <header className="project-plan-phase-head">
                  <div className="project-plan-phase-name">
                    <span className="project-plan-phase-number">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <h4>{phase.title}</h4>
                      <p>{phase.outcome}</p>
                    </div>
                  </div>
                  <span className="project-plan-phase-state">
                    {phaseLabels[phase.state]}
                  </span>
                </header>
                <div className="project-plan-phase-summary">
                  <div className="project-plan-phase-exit">
                    <span>阶段出口</span>
                    <p>{phase.exitCriteria}</p>
                  </div>
                  <div className="project-plan-phase-progress">
                    {phase.progress.percentage !== null ? (
                      <>
                        <strong>{phase.progress.percentage}%</strong>
                        <span>
                          {phase.progress.done}/{phase.progress.total} 项
                        </span>
                        <progress
                          value={phase.progress.done}
                          max={phase.progress.total}
                          aria-label={`${phase.title}阶段工作项验收率`}
                        />
                      </>
                    ) : (
                      <span>待细化</span>
                    )}
                  </div>
                </div>
                {phase.waitingForPhases.length ? (
                  <p className="project-plan-meta">
                    等待前置阶段：
                    {phase.waitingForPhases
                      .map(
                        (id) =>
                          plan.phases.find((entry) => entry.id === id)?.title ??
                          id,
                      )
                      .join('、')}
                  </p>
                ) : null}
                {phase.progress.canceled ? (
                  <p className="project-plan-meta">
                    {phase.progress.canceled} 项已取消，不计入本阶段比例。
                  </p>
                ) : null}
                {phase.status === 'done' && phase.evidence ? (
                  <details className="project-plan-phase-evidence">
                    <summary>阶段验收依据</summary>
                    <p>{phase.evidence}</p>
                  </details>
                ) : null}
                {editable && !['done', 'canceled'].includes(phase.status) ? (
                  <button
                    type="button"
                    className="quiet project-plan-cancel-phase"
                    disabled={
                      busy ||
                      phase.workItems.some((item) => item.status !== 'canceled')
                    }
                    title="先取消本阶段所有工作项；若后续阶段已启动，则不能取消本阶段。"
                    onClick={() => void changePhase(phase, 'canceled')}
                  >
                    取消阶段
                  </button>
                ) : null}
                {phase.state === 'awaiting_review' && editable ? (
                  <div className="project-plan-phase-gate">
                    {phaseReview?.id === phase.id ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void changePhase(
                            phase,
                            'done',
                            phaseReview.evidence,
                          ).then((saved) => {
                            if (saved) setPhaseReview(null);
                          });
                        }}
                      >
                        <label>
                          阶段成果与出口核验依据
                          <textarea
                            required
                            autoFocus
                            rows={3}
                            maxLength={8000}
                            value={phaseReview.evidence}
                            onChange={(event) =>
                              setPhaseReview({
                                id: phase.id,
                                evidence: event.target.value,
                              })
                            }
                          />
                        </label>
                        <div className="project-plan-actions">
                          <button
                            className="secondary"
                            type="submit"
                            disabled={busy}
                          >
                            {busy ? '验收中…' : '验收阶段并解锁后续工作'}
                          </button>
                          <button
                            className="quiet"
                            type="button"
                            disabled={busy}
                            onClick={() => setPhaseReview(null)}
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        className="secondary"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setPhaseReview({ id: phase.id, evidence: '' })
                        }
                      >
                        核验阶段出口
                      </button>
                    )}
                  </div>
                ) : null}
                <ol className="project-plan-work-list">
                  {phase.workItems.map((item) => (
                    <li
                      key={item.id}
                      data-plan-item-id={item.id}
                      className={`plan-item-status-${item.status}`}
                    >
                      <div className="project-plan-item-head">
                        <strong>{item.title}</strong>
                        <span>
                          {name(item.ownerAgentId)} · {itemLabels[item.status]}
                        </span>
                      </div>
                      <p className="project-plan-acceptance">
                        <span>完成条件</span> {item.acceptance}
                      </p>
                      {item.dependsOn.length ? (
                        <p className="project-plan-meta">
                          前置工作：
                          {item.dependsOn
                            .map(
                              (id) =>
                                plan.items.find((entry) => entry.id === id)
                                  ?.title ?? id,
                            )
                            .join('、')}
                          {item.blockedBy.length ? ' · 尚未验收' : ''}
                        </p>
                      ) : null}
                      {item.waitingForPhases.length ? (
                        <p className="project-plan-meta">
                          前置阶段尚未通过验收。
                        </p>
                      ) : null}
                      {item.blocker && item.status === 'blocked' ? (
                        <p className="project-plan-error">{item.blocker}</p>
                      ) : null}
                      {item.evidence ? (
                        <details className="project-plan-evidence">
                          <summary>工作成果依据</summary>
                          <p>{item.evidence}</p>
                        </details>
                      ) : null}
                      {editable ? (
                        <div className="project-plan-actions">
                          {item.status === 'pending' ||
                          item.status === 'blocked' ? (
                            <button
                              className="quiet"
                              type="button"
                              disabled={
                                busy ||
                                !(item.status === 'blocked'
                                  ? item.canResume
                                  : item.ready)
                              }
                              title={
                                !(item.status === 'blocked'
                                  ? item.canResume
                                  : item.ready)
                                  ? '阶段和前置工作通过验收后即可开始'
                                  : undefined
                              }
                              onClick={() =>
                                void changeItem(item, 'in_progress')
                              }
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
                                onClick={() => void changeItem(item, 'done')}
                              >
                                验收工作项
                              </button>
                              <button
                                className="quiet"
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void changeItem(item, 'in_progress')
                                }
                              >
                                退回完善
                              </button>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      {action?.id === item.id && editable ? (
                        <form
                          className="project-plan-action-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void changeItem(
                              item,
                              action.status,
                              action.text,
                            ).then((saved) => {
                              if (saved) setAction(null);
                            });
                          }}
                        >
                          <label>
                            {action.status === 'submitted'
                              ? '本次交付的结果与可核验依据'
                              : '阻塞原因'}
                            <textarea
                              required
                              autoFocus
                              rows={2}
                              maxLength={
                                action.status === 'submitted' ? 8000 : 2000
                              }
                              value={action.text}
                              onChange={(event) =>
                                setAction({
                                  ...action,
                                  text: event.target.value,
                                })
                              }
                            />
                          </label>
                          <div className="project-plan-actions">
                            <button
                              className="secondary"
                              type="submit"
                              disabled={busy}
                            >
                              保存
                            </button>
                            <button
                              className="quiet"
                              type="button"
                              disabled={busy}
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
              </li>
            ))}
          </ol>
          {!plan.phases.length ? (
            <p className="project-plan-meta">项目尚未形成阶段计划。</p>
          ) : null}
        </>
      )}
    </section>
  );
}
