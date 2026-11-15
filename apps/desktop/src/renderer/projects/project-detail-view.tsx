import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  NoemaProjectPlanItem,
  NoemaProjectPlanPhase,
  NoemaProjectPlanPhaseState,
  NoemaProjectPlanStatus,
  NoemaSocialAgent,
  NoemaSocialProject,
} from '../../shared/contracts/noema-bridge.d.ts';
import { NoemaSpinner } from '../ui/noema-spinner';
import { Icon, projectStatusLabel, timeLabel } from '../chat/presentation';
import {
  collectDeliverables,
  normalizeProjectPlan,
} from './project-detail-model.ts';

type PlanView = NonNullable<ReturnType<typeof normalizeProjectPlan>>;

const itemStatusLabels: Record<NoemaProjectPlanStatus, string> = {
  pending: '待开始',
  in_progress: '进行中',
  blocked: '受阻',
  submitted: '待验收',
  done: '已验收',
  canceled: '已取消',
};

const phaseStateLabels: Record<NoemaProjectPlanPhaseState, string> = {
  needs_breakdown: '待拆解',
  waiting: '等待前置',
  ready: '可开始',
  pending: '待开始',
  in_progress: '进行中',
  blocked: '有阻塞',
  awaiting_review: '待验收',
  done: '已验收',
  canceled: '已取消',
};

const assetMemberStatusLabels: Record<string, string> = {
  pending: '等待整理',
  running: '整理中',
  completed: '已整理',
  no_change: '无变化',
  interrupted: '已中断',
  failed: '失败',
};

function itemTone(status: string) {
  if (status === 'done') return 'done';
  if (status === 'submitted') return 'attention';
  if (status === 'blocked') return 'danger';
  if (status === 'in_progress') return 'active';
  return 'neutral';
}

function phaseTone(state: string) {
  if (state === 'done') return 'done';
  if (state === 'blocked') return 'danger';
  if (state === 'awaiting_review') return 'attention';
  if (state === 'in_progress' || state === 'ready') return 'active';
  return 'neutral';
}

function stateLabel(state: string) {
  return phaseStateLabels[state as NoemaProjectPlanPhaseState] ?? '状态未知';
}

function itemLabel(status: string) {
  return itemStatusLabels[status as NoemaProjectPlanStatus] ?? '状态未知';
}

export function ProjectDetailView({
  project,
  agents,
  canOpenGroup,
  onBack,
  onOpenGroup,
  onOpenGrowth,
}: {
  project: NoemaSocialProject;
  agents: NoemaSocialAgent[];
  canOpenGroup: boolean;
  onBack: () => void;
  onOpenGroup: () => void;
  onOpenGrowth: () => void;
}) {
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const loadPlan = useCallback(async () => {
    const request = ++requestRef.current;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const loaded = normalizeProjectPlan(
        await window.noema.getSocialProjectPlan(project.id),
      );
      if (request !== requestRef.current) return;
      setPlan(loaded);
    } catch (error) {
      if (request !== requestRef.current) return;
      setPlanError(
        error instanceof Error ? error.message : '项目计划读取失败。',
      );
    } finally {
      if (request === requestRef.current) setPlanLoading(false);
    }
  }, [project.id]);

  const approveItem = useCallback(
    async (item: NoemaProjectPlanItem) => {
      if (!plan || actionBusy) return;
      setActionBusy(`item:${item.id}`);
      setActionError(null);
      try {
        setPlan(
          normalizeProjectPlan(
            await window.noema.updateSocialProjectPlanItem({
              projectId: project.id,
              expectedRevision: plan.revision,
              itemId: item.id,
              status: 'done',
              reason: '用户验收工作项',
            }),
          ),
        );
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : '工作项验收失败。',
        );
      } finally {
        setActionBusy(null);
      }
    },
    [actionBusy, plan, project.id],
  );

  const completePhase = useCallback(
    async (phase: NoemaProjectPlanPhase) => {
      if (!plan || actionBusy) return;
      setActionBusy(`phase:${phase.id}`);
      setActionError(null);
      try {
        setPlan(
          normalizeProjectPlan(
            await window.noema.updateSocialProjectPlanPhase({
              projectId: project.id,
              expectedRevision: plan.revision,
              phaseId: phase.id,
              status: 'done',
              evidence: '阶段工作项均已验收。',
              reason: '用户验收阶段',
            }),
          ),
        );
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : '阶段验收失败。',
        );
      } finally {
        setActionBusy(null);
      }
    },
    [actionBusy, plan, project.id],
  );

  const completeProject = useCallback(async () => {
    if (!plan || actionBusy) return;
    setActionBusy('project');
    setActionError(null);
    try {
      await window.noema.completeSocialProject(project.id);
      await loadPlan();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '完成项目失败。');
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy, loadPlan, plan, project.id]);

  useEffect(() => {
    void loadPlan();
    const unsubscribe = window.noema.onSocialEvent((event) => {
      if (event.type === 'project-updated' && event.projectId === project.id) {
        void loadPlan();
      }
    });
    return () => {
      requestRef.current += 1;
      unsubscribe();
    };
  }, [loadPlan, project.id]);

  const memberById = useMemo(
    () => new Map(project.members.map((member) => [member.agentId, member])),
    [project.members],
  );
  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const resolveName = useCallback(
    (agentId: string | null | undefined) => {
      if (!agentId) return null;
      if (agentId === 'user') return '用户';
      return (
        memberById.get(agentId)?.name ?? agentById.get(agentId)?.name ?? null
      );
    },
    [agentById, memberById],
  );

  const activeMembers = useMemo(
    () => project.members.filter((member) => member.status === 'active'),
    [project.members],
  );
  const removedMembers = project.members.length - activeMembers.length;
  const deliverables = useMemo(
    () => collectDeliverables(project, plan),
    [plan, project],
  );
  const leadName = resolveName(project.leadAgentId);
  const statusLabel = projectStatusLabel(project);
  const lastActivity = timeLabel(project.lastActivityAt);

  const planSummary = (() => {
    if (!plan) return '正在读取计划状态';
    if (plan.revision === 0) return '尚无计划版本';
    const stage = plan.stage ? `当前阶段：${plan.stage}` : '计划已建立';
    return `版本 ${plan.revision} · ${stage}`;
  })();

  const planOnlySummary = plan
    ? `目前只有计划状态可用：版本 ${plan.revision}，工作项 ${plan.progress.done}/${plan.progress.total} 已验收。`
    : '目前只有项目基础资料可用，还没有读到计划状态。';
  const canComplete = Boolean(
    plan &&
    project.status === 'active' &&
    plan.phaseProgress.total > 0 &&
    plan.phaseProgress.done === plan.phaseProgress.total &&
    plan.progress.total > 0 &&
    plan.progress.done === plan.progress.total,
  );

  return (
    <main
      className="core-page core-project-detail"
      aria-label={`${project.title} 项目详情`}
    >
      <div className="core-project-detail-inner">
        <button className="core-project-back" type="button" onClick={onBack}>
          <Icon name="back" />
          返回项目
        </button>

        <header className="core-project-detail-head">
          <div className="core-project-detail-heading">
            <span className="core-project-detail-kicker">项目</span>
            <h1>{project.title}</h1>
            <p>{project.brief || '暂无项目说明。'}</p>
          </div>
          <div className="core-project-detail-actions">
            <button
              className="core-card-action"
              type="button"
              disabled={!canOpenGroup}
              onClick={onOpenGroup}
            >
              {canOpenGroup ? '打开项目群' : '项目群不可用'}
            </button>
            {canComplete ? (
              <button
                className="core-card-action"
                type="button"
                disabled={Boolean(actionBusy)}
                onClick={completeProject}
              >
                {actionBusy === 'project' ? '正在完成…' : '完成项目'}
              </button>
            ) : null}
            {project.growthBatch ? (
              <button
                className="core-card-action"
                type="button"
                onClick={onOpenGrowth}
              >
                成长记录
              </button>
            ) : null}
          </div>
        </header>

        <dl className="core-project-detail-meta">
          <div>
            <dt>状态</dt>
            <dd>{statusLabel}</dd>
          </div>
          <div>
            <dt>负责人</dt>
            <dd>{leadName ?? '未指定'}</dd>
          </div>
          <div>
            <dt>成员</dt>
            <dd>{activeMembers.length} 位</dd>
          </div>
          <div>
            <dt>最近活动</dt>
            <dd>{lastActivity || '暂无记录'}</dd>
          </div>
        </dl>

        <div className="core-project-detail-grid">
          <div className="core-project-detail-main">
            <section className="core-project-panel" aria-label="项目计划">
              <div className="core-project-panel-head">
                <div>
                  <h2>项目计划</h2>
                  <span className="core-project-panel-note">{planSummary}</span>
                </div>
                {planLoading ? (
                  <NoemaSpinner size={14} aria-label="正在读取项目计划" />
                ) : null}
              </div>

              {planError ? (
                <div className="core-project-alert" role="alert">
                  <div>
                    <strong>计划读取失败</strong>
                    <span>{planError}</span>
                  </div>
                  <button
                    className="core-project-link-button"
                    type="button"
                    onClick={() => void loadPlan()}
                  >
                    重试
                  </button>
                </div>
              ) : null}

              {actionError ? (
                <div className="core-project-alert" role="alert">
                  <div>
                    <strong>验收失败</strong>
                    <span>{actionError}</span>
                  </div>
                </div>
              ) : null}

              {!plan ? (
                !planError ? (
                  <p className="core-project-empty-line">
                    {planLoading ? '正在读取项目计划…' : '计划暂不可用。'}
                  </p>
                ) : null
              ) : plan.revision === 0 || plan.phases.length === 0 ? (
                <div className="core-project-empty-state">
                  <strong>
                    {plan.revision === 0
                      ? '还没有建立项目计划'
                      : '计划里还没有阶段'}
                  </strong>
                  <span>
                    团队开始拆解目标后，阶段、工作项和验收状态会出现在这里。
                  </span>
                </div>
              ) : (
                <>
                  {plan.objective ? (
                    <p className="core-project-objective">{plan.objective}</p>
                  ) : null}
                  <div className="core-project-progress">
                    <div>
                      <strong>
                        {plan.phaseProgress.done}/{plan.phaseProgress.total}
                      </strong>
                      <span>阶段已验收</span>
                    </div>
                    <div>
                      <strong>
                        {plan.progress.done}/{plan.progress.total}
                      </strong>
                      <span>工作项已验收</span>
                    </div>
                    {plan.progress.submitted ? (
                      <div>
                        <strong>{plan.progress.submitted}</strong>
                        <span>待验收</span>
                      </div>
                    ) : null}
                    {plan.updatedAt ? (
                      <div>
                        <strong>{timeLabel(plan.updatedAt) || '—'}</strong>
                        <span>计划更新</span>
                      </div>
                    ) : null}
                  </div>

                  <ol className="core-project-phases">
                    {plan.phases.map(
                      (phase: NoemaProjectPlanPhase, phaseIndex: number) => (
                        <li className="core-project-phase" key={phase.id}>
                          <header className="core-project-phase-head">
                            <div>
                              <span className="core-project-phase-index">
                                {String(phaseIndex + 1).padStart(2, '0')}
                              </span>
                              <h3>{phase.title || '未命名阶段'}</h3>
                            </div>
                            <span
                              className="core-project-state"
                              data-tone={phaseTone(phase.state)}
                            >
                              {stateLabel(phase.state)}
                            </span>
                          </header>
                          {phase.outcome ? (
                            <p className="core-project-phase-outcome">
                              {phase.outcome}
                            </p>
                          ) : null}
                          <div className="core-project-phase-meta">
                            <span>
                              {phase.progress.done}/{phase.progress.total}{' '}
                              项已验收
                            </span>
                            {phase.progress.submitted ? (
                              <span>{phase.progress.submitted} 项待验收</span>
                            ) : null}
                            {phase.waitingForPhases.length ? (
                              <span>等待前置阶段</span>
                            ) : null}
                            {phase.status === 'canceled' ? (
                              <span>阶段已取消</span>
                            ) : null}
                          </div>

                          {phase.workItems.length ? (
                            <ul className="core-project-items">
                              {phase.workItems.map(
                                (item: NoemaProjectPlanItem) => {
                                  const depth = Math.min(
                                    Math.max(item.depth ?? 0, 0),
                                    4,
                                  );
                                  const owner = resolveName(item.ownerAgentId);
                                  return (
                                    <li
                                      className="core-project-item"
                                      data-kind={item.kind}
                                      key={item.id}
                                      style={{
                                        marginInlineStart: `${depth * 16}px`,
                                      }}
                                    >
                                      <div className="core-project-item-main">
                                        <span className="core-project-item-title">
                                          {item.title || '未命名工作项'}
                                        </span>
                                        <span
                                          className="core-project-item-status"
                                          data-tone={itemTone(item.status)}
                                        >
                                          {itemLabel(item.status)}
                                        </span>
                                      </div>
                                      {item.kind === 'work_package' ? (
                                        <div className="core-project-item-meta">
                                          <span>
                                            负责人：{owner ?? '未指定'}
                                          </span>
                                          {item.blocker ? (
                                            <span className="core-project-item-blocker">
                                              阻塞：{item.blocker}
                                            </span>
                                          ) : null}
                                          {item.status === 'submitted' ? (
                                            <button
                                              className="core-project-link-button"
                                              type="button"
                                              disabled={
                                                actionBusy === `item:${item.id}`
                                              }
                                              onClick={() =>
                                                void approveItem(item)
                                              }
                                            >
                                              {actionBusy === `item:${item.id}`
                                                ? '验收中…'
                                                : '验收通过'}
                                            </button>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </li>
                                  );
                                },
                              )}
                            </ul>
                          ) : (
                            <p className="core-project-empty-line">
                              这一阶段还没有工作项。
                            </p>
                          )}

                          {phase.progress.total > 0 &&
                          phase.progress.done === phase.progress.total &&
                          phase.status !== 'done' &&
                          phase.status !== 'canceled' ? (
                            <div className="core-project-phase-actions">
                              <button
                                className="core-project-link-button"
                                type="button"
                                disabled={actionBusy === `phase:${phase.id}`}
                                onClick={() => void completePhase(phase)}
                              >
                                {actionBusy === `phase:${phase.id}`
                                  ? '验收中…'
                                  : '通过阶段'}
                              </button>
                            </div>
                          ) : null}
                        </li>
                      ),
                    )}
                  </ol>
                </>
              )}
            </section>

            <section className="core-project-panel" aria-label="交付物与证据">
              <div className="core-project-panel-head">
                <div>
                  <h2>交付物与证据</h2>
                  <span className="core-project-panel-note">
                    {plan && plan.revision > 0
                      ? `计划版本 ${plan.revision} · 工作项 ${plan.progress.done}/${plan.progress.total} 已验收`
                      : '尚无计划版本'}
                  </span>
                </div>
              </div>

              {deliverables.assets.length ? (
                <div className="core-project-delivery-group">
                  <h3>成长记录资产</h3>
                  <ul className="core-project-assets">
                    {deliverables.assets.map((asset, index) => (
                      <li key={`${asset.agentName}:${asset.path}:${index}`}>
                        <div className="core-project-asset-path">
                          <code>{asset.path}</code>
                          <span>v{asset.revision}</span>
                          {asset.isDeleted ? (
                            <span
                              className="core-project-item-status"
                              data-tone="danger"
                            >
                              已删除
                            </span>
                          ) : null}
                        </div>
                        <small>
                          {asset.agentName || '未知成员'}
                          {asset.memberStatus
                            ? ` · ${assetMemberStatusLabels[asset.memberStatus] ?? asset.memberStatus}`
                            : ''}
                          {asset.reason ? ` · ${asset.reason}` : ''}
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {deliverables.evidence.length ? (
                <div className="core-project-delivery-group">
                  <h3>计划证据</h3>
                  <ul className="core-project-evidence">
                    {deliverables.evidence.map((entry) => (
                      <li key={entry.itemId}>
                        <header>
                          <strong>{entry.title}</strong>
                          <span
                            className="core-project-item-status"
                            data-tone={itemTone(entry.status)}
                          >
                            {itemLabel(entry.status)}
                          </span>
                        </header>
                        {entry.phaseTitle ? (
                          <span className="core-project-evidence-phase">
                            阶段：{entry.phaseTitle}
                          </span>
                        ) : null}
                        <p>
                          {entry.evidence || '仅记录了证据来源，没有文字说明。'}
                        </p>
                        {entry.refs.length ? (
                          <ul className="core-project-evidence-refs">
                            {entry.refs.map((ref, index) => (
                              <li key={`${entry.itemId}:${index}`}>
                                <span>{ref.kind || '来源'}</span>
                                {ref.label}
                                {ref.observedAt
                                  ? ` · ${timeLabel(ref.observedAt)}`
                                  : ''}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!deliverables.assets.length && !deliverables.evidence.length ? (
                <div className="core-project-empty-state">
                  <strong>还没有交付物或证据</strong>
                  <span>{planOnlySummary}</span>
                </div>
              ) : null}
            </section>
          </div>

          <aside className="core-project-detail-side">
            <section className="core-project-panel" aria-label="项目成员">
              <div className="core-project-panel-head">
                <div>
                  <h2>项目成员</h2>
                  <span className="core-project-panel-note">
                    {activeMembers.length} 位活跃成员
                    {removedMembers ? ` · ${removedMembers} 位已移出` : ''}
                  </span>
                </div>
              </div>
              {activeMembers.length ? (
                <ul className="core-project-members">
                  {activeMembers.map((member) => (
                    <li key={member.agentId}>
                      <span
                        className="core-project-member-avatar"
                        aria-hidden="true"
                      >
                        {member.name.trim().slice(0, 1) || '?'}
                      </span>
                      <div>
                        <strong>{member.name}</strong>
                        <small>
                          {member.headline ||
                            (member.kind === 'specialist'
                              ? '专项成员'
                              : 'Noema 成员')}
                        </small>
                      </div>
                      {member.agentId === project.leadAgentId ? (
                        <span className="core-tag">负责人</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="core-project-empty-line">还没有活跃成员。</p>
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
