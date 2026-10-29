import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  NoemaProjectPlan,
  NoemaProjectPlanItem,
  NoemaProjectPlanItemUpdate,
  NoemaProjectPlanPhase,
  NoemaProjectPlanPhaseState,
  NoemaProjectPlanPhaseUpdate,
  NoemaProjectPlanStatus,
  NoemaProjectPlanWrite,
  NoemaSocialMessage,
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
function itemStatusLabel(
  item: Pick<NoemaProjectPlanItem, 'status' | 'acceptanceRecorded'>,
) {
  return item.status === 'done' && !item.acceptanceRecorded
    ? '验收记录不完整'
    : itemLabels[item.status];
}
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
          kind,
          parentId,
          title,
          ownerAgentId,
          acceptance,
          dependsOn,
          relatedTo,
          status,
          evidence,
          evidenceRefs,
          evidenceReview,
          submittedByAgentId,
          submittedAt,
          submissionRevision,
          blocker,
        }) => ({
          id,
          kind,
          parentId,
          title,
          ownerAgentId,
          acceptance,
          dependsOn,
          relatedTo,
          status,
          evidence,
          evidenceRefs,
          evidenceReview,
          submittedByAgentId,
          submittedAt,
          submissionRevision,
          blocker,
        }),
      ),
    })),
  };
}

export function ProjectPlanPanel({ project }: { project: NoemaSocialProject }) {
  const [evidenceChecks, setEvidenceChecks] = useState<
    Record<
      string,
      Awaited<ReturnType<typeof window.noema.inspectSocialProjectPlanEvidence>>
    >
  >({});
  const [checkingEvidence, setCheckingEvidence] = useState<string | null>(null);
  const [pendingEvidenceReopen, setPendingEvidenceReopen] = useState<
    Awaited<ReturnType<typeof window.noema.inspectSocialProjectPlanEvidence>> | null
  >(null);
  const [plan, setPlan] = useState<NoemaProjectPlan | null>(null);
  const [groupMessages, setGroupMessages] = useState<NoemaSocialMessage[]>([]);
  const [groupMessagesError, setGroupMessagesError] = useState('');
  const groupMessagesSequence = useRef(0);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const phaseFlowRef = useRef<HTMLDivElement>(null);
  const phaseNodeRefs = useRef(new Map<string, HTMLLIElement>());
  const [phaseLinks, setPhaseLinks] = useState<
    Array<{ id: string; path: string; active: boolean }>
  >([]);
  const [phaseFlowSize, setPhaseFlowSize] = useState({ width: 0, height: 0 });
  const [workDetailsOpen, setWorkDetailsOpen] = useState<Record<string, boolean>>({});
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
    evidenceMessageId: string;
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
    let active = true;
    const refreshGroupMessages = () => {
      const request = ++groupMessagesSequence.current;
      void window.noema
        .getSocialRoom(project.groupRoomId)
        .then((room) => {
          if (active && request === groupMessagesSequence.current) {
            setGroupMessages(
              room.messages.filter(
                (message) =>
                  message.role !== 'system' &&
                  message.status === 'complete' &&
                  message.content.trim().length > 0,
              ),
            );
            setGroupMessagesError('');
          }
        })
        .catch((e: unknown) => {
          if (active && request === groupMessagesSequence.current)
            setGroupMessagesError(
              e instanceof Error ? e.message : '项目群消息读取失败。',
            );
        });
    };
    void reload();
    refreshGroupMessages();
    const off = window.noema.onSocialEvent((event) => {
      if (event.type === 'project-updated' && event.projectId === project.id) {
        void reload();
        refreshGroupMessages();
      }
      if (
        (event.type === 'chat-state-updated' ||
          event.type === 'chat-turn-completed') &&
        event.roomId === project.groupRoomId
      )
        refreshGroupMessages();
    });
    return () => {
      active = false;
      groupMessagesSequence.current += 1;
      sequence.current += 1;
      off();
    };
  }, [project.groupRoomId, project.id, reload]);
  const editable = project.status === 'active';
  const members = project.members;
  const name = (id: string) =>
    id === 'user'
      ? '用户'
      : (members.find((member) => member.agentId === id)?.name ?? '原项目成员');
  const savedIds = new Set(plan?.items.map((item) => item.id) ?? []);
  const selectedPhase = plan
    ? (plan.phases.find((phase) => phase.id === selectedPhaseId) ??
      plan.phases.find((phase) =>
        ['blocked', 'awaiting_review', 'in_progress'].includes(phase.state),
      ) ??
      plan.phases.find((phase) => phase.state === 'ready') ??
      plan.phases[0] ??
      null)
    : null;
  const phaseDepths = new Map<string, number>();
  const phaseDepth = (phaseId: string, ancestors = new Set<string>()): number => {
    const known = phaseDepths.get(phaseId);
    if (known !== undefined) return known;
    const phase = plan?.phases.find((entry) => entry.id === phaseId);
    if (!phase || ancestors.has(phaseId)) return 0;
    const nextAncestors = new Set(ancestors).add(phaseId);
    const dependencies = phase.dependsOn
      .map((id) => plan?.phases.find((entry) => entry.id === id))
      .filter((entry): entry is NoemaProjectPlanPhase => Boolean(entry));
    const depth = dependencies.length
      ? Math.max(...dependencies.map((entry) => phaseDepth(entry.id, nextAncestors) + 1))
      : 0;
    phaseDepths.set(phaseId, depth);
    return depth;
  };
  const phaseLanes = plan
    ? Array.from(
        { length: Math.max(1, ...plan.phases.map((phase) => phaseDepth(phase.id) + 1)) },
        (_, depth) => ({
          depth,
          phases: plan.phases.filter((phase) => phaseDepths.get(phase.id) === depth),
        }),
      )
    : [];
  const currentPhase =
    plan?.phases.find((phase) => phase.state === 'blocked') ??
    plan?.phases.find((phase) => phase.state === 'awaiting_review') ??
    plan?.phases.find((phase) => phase.state === 'in_progress') ??
    plan?.phases.find((phase) => phase.state === 'ready') ??
    plan?.phases.find(
      (phase) => phase.state !== 'done' && phase.state !== 'canceled',
    ) ??
    null;
  const phaseWorkStatusDistribution = (phase: NoemaProjectPlanPhase) => {
    const items = phase.workItems.filter(
      (item) => item.kind === 'work_package' && item.status !== 'canceled',
    );
    return [
      {
        key: 'accepted',
        label: '已验收',
        count: items.filter(
          (item) => item.status === 'done' && item.acceptanceRecorded,
        ).length,
      },
      {
        key: 'submitted',
        label: '待验收',
        count: items.filter((item) => item.status === 'submitted').length,
      },
      {
        key: 'in-progress',
        label: '进行中',
        count: items.filter((item) => item.status === 'in_progress').length,
      },
      {
        key: 'blocked',
        label: '受阻',
        count: items.filter((item) => item.status === 'blocked').length,
      },
      {
        key: 'pending',
        label: '待开始',
        count: items.filter((item) => item.status === 'pending').length,
      },
      {
        key: 'unverified',
        label: '验收待补',
        count: items.filter(
          (item) => item.status === 'done' && !item.acceptanceRecorded,
        ).length,
      },
    ].filter((segment) => segment.count > 0);
  };
  useLayoutEffect(() => {
    const flow = phaseFlowRef.current;
    if (!flow || !plan) return;
    const updateLinks = () => {
      const flowRect = flow.getBoundingClientRect();
      setPhaseFlowSize({ width: flow.scrollWidth, height: flow.scrollHeight });
      const centers = new Map<string, { left: number; right: number; y: number }>();
      for (const [id, node] of phaseNodeRefs.current) {
        const rect = node.getBoundingClientRect();
        centers.set(id, {
          left: rect.left - flowRect.left + flow.scrollLeft,
          right: rect.right - flowRect.left + flow.scrollLeft,
          y: rect.top - flowRect.top + flow.scrollTop + rect.height / 2,
        });
      }
      const links = plan.phases.flatMap((phase) => {
        const target = centers.get(phase.id);
        if (!target) return [];
        return phase.dependsOn.flatMap((dependencyId) => {
          const source = centers.get(dependencyId);
          if (!source) return [];
          const bend = Math.max(24, (target.left - source.right) * 0.48);
          return [
            {
              id: `${dependencyId}-${phase.id}`,
              path: `M ${source.right} ${source.y} C ${source.right + bend} ${source.y}, ${target.left - bend} ${target.y}, ${target.left} ${target.y}`,
              active:
                phase.state === 'in_progress' ||
                phase.state === 'awaiting_review' ||
                dependencyId === selectedPhaseId,
            },
          ];
        });
      });
      setPhaseLinks(links);
    };
    updateLinks();
    const observer = new ResizeObserver(updateLinks);
    observer.observe(flow);
    for (const node of phaseNodeRefs.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [plan, selectedPhaseId, phaseLanes.length]);
  const phaseFocus = selectedPhase
    ? (() => {
        const workItems = selectedPhase.workItems.filter(
          (item) => item.kind === 'work_package',
        );
        const focusedItem =
          workItems.find((item) => item.status === 'blocked') ??
          workItems.find((item) => item.status === 'submitted') ??
          workItems.find((item) => item.status === 'in_progress') ??
          workItems.find(
            (item) =>
              item.status === 'pending' &&
              !item.blockedBy.length &&
              !item.waitingForPhases.length,
          );
        if (focusedItem) {
          const statusLabel =
            focusedItem.status === 'blocked'
              ? '受阻'
              : focusedItem.status === 'submitted'
                ? '待验收'
                : focusedItem.status === 'in_progress'
                  ? '正在推进'
                  : '下一项';
          const detail =
            focusedItem.status === 'blocked'
              ? focusedItem.blocker || '负责人尚未补充阻塞原因。'
              : focusedItem.status === 'submitted'
                ? '成果已提交，等待独立核验。'
                : focusedItem.status === 'in_progress'
                  ? `由${name(focusedItem.ownerAgentId)}负责。`
                  : `由${name(focusedItem.ownerAgentId)}负责，前置条件已满足。`;
          const otherActiveCount = workItems.filter(
            (item) =>
              item.id !== focusedItem.id &&
              ['blocked', 'submitted', 'in_progress'].includes(item.status),
          ).length;
          return {
            state: focusedItem.status,
            label: statusLabel,
            title: focusedItem.title,
            detail:
              otherActiveCount > 0
                ? `${detail} 另有 ${otherActiveCount} 项正在处理或等待验收。`
                : detail,
          };
        }
        if (selectedPhase.state === 'awaiting_review')
          return {
            state: 'awaiting_review',
            label: '阶段待验收',
            title: '工作项已提交，等待核验阶段出口',
            detail: selectedPhase.exitCriteria,
          };
        if (selectedPhase.waitingForPhases.length)
          return {
            state: 'waiting',
            label: '等待前置阶段',
            title: selectedPhase.waitingForPhases
              .map(
                (id) => plan?.phases.find((phase) => phase.id === id)?.title ?? id,
              )
              .join('、'),
            detail: '前置阶段通过验收后，这一阶段才会解锁。',
          };
        if (selectedPhase.state === 'done')
          return {
            state: 'done',
            label: '阶段已验收',
            title: selectedPhase.title,
            detail: '阶段成果与出口条件已记录。',
          };
        if (!workItems.length)
          return {
            state: 'needs_breakdown',
            label: '待细化',
            title: '这一阶段暂时没有可执行工作项',
            detail: '进入阶段前再补充近期工作，不影响其他阶段推进。',
          };
        const waitingItem = workItems.find(
          (item) =>
            item.status === 'pending' &&
            (item.blockedBy.length > 0 || item.waitingForPhases.length > 0),
        );
        return {
          state: 'waiting',
          label: '等待工作项前置条件',
          title: waitingItem?.title ?? '本阶段暂时没有可启动的工作项',
          detail: waitingItem
            ? '前置工作尚未验收。展开工作项可查看具体依赖。'
            : '查看工作项依赖，确认前置成果是否已经提交并验收。',
        };
      })()
    : null;
  const phaseWorkDetailsOpen = (phase: NoemaProjectPlanPhase) =>
    workDetailsOpen[phase.id] ??
    phase.workItems.some(
      (item) =>
        item.kind === 'work_package' &&
        ['blocked', 'submitted'].includes(item.status),
    );
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
  const updateRelated = (itemId: string, relatedId: string, enabled: boolean) =>
    setEditor((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              phases: current.draft.phases.map((phase) => ({
                ...phase,
                workItems: phase.workItems.map((item) => {
                  const otherId =
                    item.id === itemId
                      ? relatedId
                      : item.id === relatedId
                        ? itemId
                        : null;
                  if (!otherId) return item;
                  return {
                    ...item,
                    relatedTo: enabled
                      ? [...new Set([...item.relatedTo, otherId])]
                      : item.relatedTo.filter((id) => id !== otherId),
                  };
                }),
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
  const addItem = (phaseId: string, parentId: string | null = null) =>
    setEditor((current) => {
      if (!current) return current;
      const count = current.draft.phases.reduce(
        (total, phase) => total + phase.workItems.length,
        0,
      );
      if (count >= 100) return current;
      const item: DraftItem = {
        id: crypto.randomUUID(),
        kind: 'work_package',
        parentId,
        title: '',
        ownerAgentId:
          members.find(
            (member) => member.status === 'active' && !member.agentArchivedAt,
          )?.agentId ?? '',
        acceptance: '',
        dependsOn: [],
        relatedTo: [],
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
  const addGroup = (phaseId: string, parentId: string | null = null) =>
    setEditor((current) => {
      if (!current) return current;
      const count = current.draft.phases.reduce(
        (total, phase) => total + phase.workItems.length,
        0,
      );
      if (count >= 100) return current;
      const item: DraftItem = {
        id: crypto.randomUUID(),
        kind: 'group',
        parentId,
        title: '',
        ownerAgentId: '',
        acceptance: '',
        dependsOn: [],
        relatedTo: [],
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
                    relatedTo: item.relatedTo.filter((id) => id !== itemId),
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
    evidenceMessageId = '',
  ) => {
    if (!plan) return Promise.resolve(false);
    const input: NoemaProjectPlanItemUpdate = {
      projectId: project.id,
      expectedRevision: plan.revision,
      itemId: item.id,
      status,
      ...(status === 'submitted' ? { evidence: evidenceOrBlocker } : {}),
      ...(status === 'submitted' && evidenceMessageId
        ? {
            evidenceSources: [
              { kind: 'message' as const, messageId: evidenceMessageId },
            ],
          }
        : {}),
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
  const reopenEvidenceImpact = (
    check: Awaited<
      ReturnType<typeof window.noema.inspectSocialProjectPlanEvidence>
    >,
  ) => {
    if (!plan || check.state !== 'needs_review') return;
    if (check.reopenBlockedItems.length) {
      setError(
        `仍有工作正在进行，需先停止或结束：${check.reopenBlockedItems
          .map((entry) => entry.title)
          .join('、')}。`,
      );
      return;
    }
    setPendingEvidenceReopen(check);
  };
  const confirmEvidenceReopen = async () => {
    if (!plan || !pendingEvidenceReopen) return;
    const saved = await write(() =>
      window.noema.reopenSocialProjectPlanEvidence({
        projectId: project.id,
        itemId: pendingEvidenceReopen.itemId,
        expectedRevision: plan.revision,
      }),
    );
    if (saved) {
      setEvidenceChecks({});
      setPendingEvidenceReopen(null);
    }
  };
  const flattenedDraftItems =
    editor?.draft.phases.flatMap((phase) =>
      phase.workItems.map((item) => ({
        ...item,
        phaseTitle: phase.title || '未命名阶段',
      })),
    ) ?? [];
  const isDescendantOf = (itemId: string, ancestorId: string) => {
    let parentId = flattenedDraftItems.find(
      (item) => item.id === itemId,
    )?.parentId;
    while (parentId) {
      if (parentId === ancestorId) return true;
      parentId =
        flattenedDraftItems.find((item) => item.id === parentId)?.parentId ??
        null;
    }
    return false;
  };
  const depthOf = (itemId: string) => {
    let depth = 0;
    let parentId = flattenedDraftItems.find(
      (item) => item.id === itemId,
    )?.parentId;
    while (parentId && depth < 100) {
      depth += 1;
      parentId =
        flattenedDraftItems.find((item) => item.id === parentId)?.parentId ??
        null;
    }
    return depth;
  };

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
                    <li
                      key={item.id}
                      style={{
                        marginInlineStart: `${depthOf(item.id) * 18}px`,
                      }}
                    >
                      <fieldset className="project-plan-edit-item">
                        <legend>
                          {item.kind === 'group' ? '工作分组' : '工作包'}{' '}
                          {itemIndex + 1}
                        </legend>
                        <label>
                          {item.kind === 'group' ? '分组名称' : '工作包名称'}
                          <input
                            required
                            maxLength={160}
                            value={item.title}
                            onChange={(event) =>
                              updateItem(item.id, { title: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          所属分组
                          <select
                            value={item.parentId ?? ''}
                            onChange={(event) =>
                              updateItem(item.id, {
                                parentId: event.target.value || null,
                              })
                            }
                          >
                            <option value="">阶段下</option>
                            {flattenedDraftItems
                              .filter(
                                (other) =>
                                  other.kind === 'group' &&
                                  other.id !== item.id &&
                                  !isDescendantOf(other.id, item.id),
                              )
                              .map((other) => (
                                <option key={other.id} value={other.id}>
                                  {other.title || '未命名分组'}
                                </option>
                              ))}
                          </select>
                        </label>
                        {item.kind === 'group' ? (
                          <>
                            <p className="project-plan-meta">
                              仅用于归组；子工作包决定进度，不产生额外完成率。
                            </p>
                            <div className="project-plan-actions">
                              <button
                                type="button"
                                className="quiet"
                                disabled={
                                  busy || flattenedDraftItems.length >= 100
                                }
                                onClick={() => addGroup(phase.id, item.id)}
                              >
                                ＋ 添加子分组
                              </button>
                              <button
                                type="button"
                                className="quiet"
                                disabled={
                                  busy || flattenedDraftItems.length >= 100
                                }
                                onClick={() => addItem(phase.id, item.id)}
                              >
                                ＋ 添加工作包
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
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
                              {['submitted', 'done'].includes(item.status) ? (
                                <p className="project-plan-meta">
                                  工作状态 · {itemStatusLabel(item)}
                                </p>
                              ) : (
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
                                    {Object.entries(itemLabels)
                                      .filter(
                                        ([value]) =>
                                          !['submitted', 'done'].includes(
                                            value,
                                          ),
                                      )
                                      .map(([value, label]) => (
                                        <option value={value} key={value}>
                                          {label}
                                        </option>
                                      ))}
                                  </select>
                                </label>
                              )}
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
                                    .filter(
                                      (other) =>
                                        other.kind === 'work_package' &&
                                        other.id !== item.id,
                                    )
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
                            {flattenedDraftItems.length > 1 ? (
                              <details className="project-plan-dependency-editor">
                                <summary>
                                  相关工作项 · {item.relatedTo.length}{' '}
                                  项（不阻塞开始）
                                </summary>
                                <div className="project-plan-dependencies">
                                  {flattenedDraftItems
                                    .filter(
                                      (other) =>
                                        other.kind === 'work_package' &&
                                        other.id !== item.id,
                                    )
                                    .map((other) => (
                                      <label key={other.id}>
                                        <input
                                          type="checkbox"
                                          checked={item.relatedTo.includes(
                                            other.id,
                                          )}
                                          onChange={(event) =>
                                            updateRelated(
                                              item.id,
                                              other.id,
                                              event.target.checked,
                                            )
                                          }
                                        />
                                        {other.phaseTitle} ·{' '}
                                        {other.title || '未命名工作项'}
                                      </label>
                                    ))}
                                </div>
                              </details>
                            ) : null}
                          </>
                        )}
                        {!savedIds.has(item.id) ? (
                          <button
                            type="button"
                            className="quiet"
                            disabled={
                              busy ||
                              flattenedDraftItems.some(
                                (candidate) => candidate.parentId === item.id,
                              )
                            }
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
                  onClick={() => addGroup(phase.id)}
                >
                  ＋ 添加分组
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={busy || flattenedDraftItems.length >= 100}
                  onClick={() => addItem(phase.id)}
                >
                  ＋ 添加工作包
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
          {plan.phases.length ? (
            <div className="project-plan-overview" aria-label="项目阶段概览">
              <div className="project-plan-overview-status">
                <strong>
                  {plan.phases.some((phase) => phase.state === 'blocked')
                    ? '有工作受阻'
                    : plan.phases.some((phase) => phase.state === 'awaiting_review')
                      ? '有阶段待验收'
                      : plan.phases.every((phase) => phase.state === 'done')
                        ? '阶段全部验收'
                        : plan.phases.some((phase) => phase.state === 'in_progress')
                          ? '项目正在推进'
                          : '项目准备中'}
                </strong>
                <div className="project-plan-overview-metrics" aria-label="项目验收进度">
                  <span><b>{plan.phaseProgress.done}/{plan.phaseProgress.total}</b>阶段验收</span>
                  {plan.progress.total ? (
                    <span><b>{plan.progress.done}/{plan.progress.total}</b>工作项验收</span>
                  ) : null}
                  {plan.progress.submitted ? (
                    <span className="state-submitted"><b>{plan.progress.submitted}</b>待验收</span>
                  ) : null}
                  {plan.items.some((item) => item.status === 'blocked') ? (
                    <span className="state-blocked">
                      <b>{plan.items.filter((item) => item.status === 'blocked').length}</b>项受阻
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="project-plan-flow-heading">
                <strong>阶段关系</strong>
                <span>颜色表示状态；连线表示前置条件，未连线的阶段可并行推进。</span>
              </div>
              <div
                className="project-plan-phase-flow"
                ref={phaseFlowRef}
                aria-label="项目阶段依赖图"
                tabIndex={0}
                role="region"
                aria-describedby="project-plan-flow-help"
                style={{
                  gridTemplateColumns: `repeat(${phaseLanes.length}, minmax(${phaseLanes.length <= 3 ? '0' : '210px'}, 1fr))`,
                }}
              >
                <svg
                  className="project-plan-phase-links"
                  width={phaseFlowSize.width}
                  height={phaseFlowSize.height}
                  aria-hidden="true"
                  focusable="false"
                >
                  <defs>
                    <marker
                      id="project-plan-arrowhead"
                      markerWidth="7"
                      markerHeight="7"
                      refX="6"
                      refY="3.5"
                      orient="auto"
                    >
                      <path d="M 0 0 L 7 3.5 L 0 7 z" />
                    </marker>
                    <marker
                      id="project-plan-arrowhead-active"
                      markerWidth="7"
                      markerHeight="7"
                      refX="6"
                      refY="3.5"
                      orient="auto"
                    >
                      <path d="M 0 0 L 7 3.5 L 0 7 z" />
                    </marker>
                  </defs>
                  {phaseLinks.map((link) => (
                    <path
                      key={link.id}
                      d={link.path}
                      className={link.active ? 'is-active' : undefined}
                      markerEnd={`url(#project-plan-arrowhead${link.active ? '-active' : ''})`}
                    />
                  ))}
                </svg>
                {phaseLanes.map((lane) => (
                  <section className="project-plan-phase-lane" key={lane.depth}>
                    <header>
                      <span>{lane.depth === 0 ? '起点' : `依赖层 ${String(lane.depth + 1).padStart(2, '0')}`}</span>
                      <small>{lane.depth === 0 ? '无需前置阶段' : '前置成果通过后解锁'}</small>
                    </header>
                    <ol>
                      {lane.phases.map((phase) => (
                        <li
                          className={`project-plan-phase-stop state-${phase.state}${currentPhase?.id === phase.id ? ' is-current' : ''}${selectedPhase?.id === phase.id ? ' is-selected' : ''}`}
                          key={phase.id}
                          ref={(node) => {
                            if (node) phaseNodeRefs.current.set(phase.id, node);
                            else phaseNodeRefs.current.delete(phase.id);
                          }}
                        >
                          <button
                            type="button"
                            aria-current={selectedPhase?.id === phase.id ? 'step' : undefined}
                            aria-controls="project-plan-phase-detail"
                            onClick={() => setSelectedPhaseId(phase.id)}
                          >
                            <span className="project-plan-phase-stop-state">
                              <span className="project-plan-phase-stop-index">
                                阶段{' '}
                                {String(
                                  plan.phases.findIndex(
                                    (item) => item.id === phase.id,
                                  ) + 1,
                                ).padStart(2, '0')}
                              </span>
                              <span className="project-plan-phase-stop-status">
                                <i aria-hidden="true" />
                                {currentPhase?.id === phase.id
                                  ? '当前 · ' + phaseLabels[phase.state]
                                  : phaseLabels[phase.state]}
                              </span>
                            </span>
                            <strong>{phase.title}</strong>
                            <span className="project-plan-phase-stop-outcome">
                              {phase.outcome}
                            </span>
                            <span className="project-plan-phase-stop-progress">
                              {(() => {
                                const distribution = phaseWorkStatusDistribution(phase);
                                return phase.progress.total ? (
                                  <>
                                    <span>
                                      {phase.progress.done}/{phase.progress.total} 项已验收
                                      {distribution
                                        .filter((segment) => segment.key !== 'accepted')
                                        .map((segment) => ` · ${segment.count} ${segment.label}`)
                                        .join('')}
                                    </span>
                                    <span
                                      className="project-plan-phase-stop-meter"
                                      role="img"
                                      aria-label={`${phase.title}工作项状态：${distribution.map((segment) => `${segment.label} ${segment.count} 项`).join('，')}`}
                                    >
                                      {distribution.map((segment) => (
                                        <i
                                          key={segment.key}
                                          className={`state-${segment.key}`}
                                          style={{ flexGrow: segment.count }}
                                        />
                                      ))}
                                    </span>
                                  </>
                                ) : (
                                  <span>工作包待细化</span>
                                );
                              })()}
                            </span>
                            <span className="project-plan-phase-dependencies">
                              {phase.dependsOn.length ? (
                                <span
                                  className="project-plan-phase-dependency"
                                  title={`前置阶段：${phase.dependsOn
                                    .map(
                                      (dependencyId) =>
                                        plan.phases.find(
                                          (item) => item.id === dependencyId,
                                        )?.title ?? '未知阶段',
                                    )
                                    .join('、')}`}
                                >
                                  前置{' '}
                                  {phase.dependsOn
                                    .map((dependencyId) =>
                                      String(
                                        plan.phases.findIndex(
                                          (item) => item.id === dependencyId,
                                        ) + 1,
                                      ).padStart(2, '0'),
                                    )
                                    .join('、')}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}
              </div>
              <span className="project-plan-flow-help" id="project-plan-flow-help">
                横向滚动可查看后续依赖层；点击阶段查看出口条件与团队工作项。
              </span>
              {plan.progress.canceled ? (
                <p className="project-plan-meta">
                  {plan.progress.canceled} 项已取消，不计入当前进度。
                </p>
              ) : null}
            </div>
          ) : null}
          {plan.phases
            .filter((phase) => phase.id === selectedPhase?.id)
            .map((phase) => (
              <section
                className={`project-plan-phase state-${phase.state}`}
                key={phase.id}
                data-plan-phase-id={phase.id}
                id="project-plan-phase-detail"
                aria-label={`${phase.title}阶段详情`}
              >
                <p className="project-plan-phase-detail-label">
                  阶段详情 · {phaseDepths.get(phase.id) === 0
                    ? '起点'
                    : `依赖层 ${String((phaseDepths.get(phase.id) ?? 0) + 1).padStart(2, '0')}`}
                </p>
                <header className="project-plan-phase-head">
                  <div className="project-plan-phase-name">
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
                {phaseFocus ? (
                  <div
                    className={`project-plan-focus state-${phaseFocus.state}`}
                    aria-label="本阶段当前焦点"
                  >
                    <span className="project-plan-focus-label">
                      {phaseFocus.label}
                    </span>
                    <div className="project-plan-focus-copy">
                      <strong>{phaseFocus.title}</strong>
                      <p>{phaseFocus.detail}</p>
                    </div>
                    {phase.workItems.some(
                      (item) => item.kind === 'work_package',
                    ) ? (
                      <button
                        type="button"
                        className="quiet project-plan-focus-link"
                        aria-expanded={phaseWorkDetailsOpen(phase)}
                        onClick={() =>
                          setWorkDetailsOpen((current) => {
                            const wasOpen =
                              current[phase.id] ?? phaseWorkDetailsOpen(phase);
                            return { ...current, [phase.id]: !wasOpen };
                          })
                        }
                      >
                        {phaseWorkDetailsOpen(phase)
                          ? '收起工作项'
                          : '展开工作项'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
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
                      phase.workItems.some(
                        (item) =>
                          item.kind === 'work_package' &&
                          item.status !== 'canceled',
                      )
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
                <details
                  className="project-plan-work-details"
                  open={phaseWorkDetailsOpen(phase)}
                  onToggle={(event) => {
                    const isOpen = event.currentTarget.open;
                    setWorkDetailsOpen((current) =>
                      current[phase.id] === isOpen
                        ? current
                        : { ...current, [phase.id]: isOpen },
                    );
                  }}
                >
                  <summary>
                    工作项 · {phase.progress.done}/{phase.progress.total} 已验收
                    {phase.progress.submitted
                      ? ` · ${phase.progress.submitted} 项待验收`
                      : ''}
                    {phase.workItems.some(
                      (item) =>
                        item.kind === 'work_package' &&
                        item.status === 'blocked',
                    )
                      ? ' · 有阻塞'
                      : ''}
                  </summary>
                  <ol className="project-plan-work-list">
                  {phase.workItems.map((item) => (
                    <li
                      key={item.id}
                      data-plan-item-id={item.id}
                      className={`plan-item-status-${item.status} ${item.kind === 'group' ? 'project-plan-group-node' : ''}`}
                      style={{
                        marginInlineStart: `${Math.min(item.depth ?? 0, 8) * 18}px`,
                      }}
                    >
                      <div className="project-plan-item-head">
                        <strong>{item.title}</strong>
                        {item.kind === 'group' ? (
                          <span>
                            分组 · {item.childCount ?? 0} 个子项
                            {!item.childCount ? ' · 待细化' : null}
                            {item.childCount &&
                            item.childProgress?.percentage !== null &&
                            item.childProgress?.percentage !== undefined
                              ? ` · ${item.childProgress.percentage}%`
                              : ''}
                          </span>
                        ) : (
                          <span>
                            {name(item.ownerAgentId)} · {itemStatusLabel(item)}
                            {item.submittedByAgentId
                              ? ` · 提交者：${name(item.submittedByAgentId)}`
                              : ''}
                          </span>
                        )}
                      </div>
                      {item.kind === 'work_package' ? (
                        <p className="project-plan-acceptance">
                          <span>完成条件</span> {item.acceptance}
                        </p>
                      ) : null}
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
                      {item.relatedItems?.length ? (
                        <p className="project-plan-meta">
                          相关工作：
                          {item.relatedItems
                            .map((related) => related.title)
                            .join('、')}
                          {' · 不影响开始条件'}
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
                      {item.evidence || item.evidenceRefs?.length ? (
                        <details className="project-plan-evidence">
                          <summary>工作成果依据</summary>
                          <p>{item.evidence}</p>
                          <p>
                            {item.submittedByAgentId
                              ? `提交者：${name(item.submittedByAgentId)}${item.submissionRevision ? ` · 提交版本 ${item.submissionRevision}` : ''}`
                              : '缺少独立提交记录'}
                          </p>
                          <p>
                            {item.evidenceReview
                              ? `验收者：${name(item.evidenceReview.actorId)} · 核验提交版本 ${item.evidenceReview.submissionRevision}`
                              : '尚无独立验收记录'}
                          </p>
                          <button
                            type="button"
                            className="quiet"
                            disabled={checkingEvidence !== null}
                            onClick={async () => {
                              setCheckingEvidence(item.id);
                              try {
                                const check =
                                  await window.noema.inspectSocialProjectPlanEvidence(
                                    project.id,
                                    item.id,
                                  );
                                setEvidenceChecks((current) => ({
                                  ...current,
                                  [item.id]: check,
                                }));
                              } catch (e) {
                                setError(
                                  e instanceof Error
                                    ? e.message
                                    : '依据读取失败。',
                                );
                              } finally {
                                setCheckingEvidence(null);
                              }
                            }}
                          >
                            {checkingEvidence === item.id
                              ? '正在读取来源…'
                              : '核对来源版本'}
                          </button>
                          {evidenceChecks[item.id]?.projectId === project.id &&
                          evidenceChecks[item.id]?.revision ===
                            plan.revision ? (
                            <div aria-live="polite">
                              <p>
                                {evidenceChecks[item.id].state === 'unlinked'
                                  ? '仅有文字说明，尚未关联可核对来源。'
                                  : `核对时间：${new Date(evidenceChecks[item.id].checkedAt).toLocaleString()}。版本一致不代表成果已通过业务验收。`}
                              </p>
                              {evidenceChecks[item.id].sources.map(
                                (source, index) => (
                                  <details key={index}>
                                    <summary>
                                      {source.label} ·{' '}
                                      {source.state === 'unchanged'
                                        ? '来源版本一致'
                                        : source.state === 'changed'
                                          ? '来源已变，需重核'
                                          : '来源不可用'}
                                    </summary>
                                    <p>
                                      采集：
                                      {new Date(
                                        source.observedAt,
                                      ).toLocaleString()}{' '}
                                      · 来源关联成员：
                                      {source.sourceAuthorId
                                        ? name(source.sourceAuthorId)
                                        : '用户/系统'}{' '}
                                      · 采集时状态：
                                      {(
                                        {
                                          complete: '已完成',
                                          completed: '已完成',
                                          failed: '失败',
                                          interrupted: '已中断',
                                          captured: '文件快照',
                                        } as Record<string, string>
                                      )[source.sourceStatus] ??
                                        source.sourceStatus}
                                    </p>
                                    <details>
                                      <summary>来源标识与指纹</summary>
                                      <code>
                                        {JSON.stringify(source.source)}
                                        <br />
                                        SHA-256：{source.fingerprint}
                                      </code>
                                    </details>
                                    {source.excerpt ? (
                                      <pre>{source.excerpt}</pre>
                                    ) : null}
                                    {source.excerptTruncated ? (
                                      <p>
                                        仅显示前 4000
                                        字，完整内容仍保留在来源记录。
                                      </p>
                                    ) : null}
                                    {source.error ? (
                                      <p className="project-plan-error">
                                        {source.error}
                                      </p>
                                    ) : null}
                                  </details>
                                ),
                              )}
                              {evidenceChecks[item.id].affectedItems.length ? (
                                <>
                                  <p className="project-plan-error">
                                    需重核的工作项：
                                    {evidenceChecks[item.id].affectedItems
                                      .map((entry) => entry.title)
                                      .join('、')}
                                  </p>
                                  {evidenceChecks[item.id].reopenBlockedItems
                                    .length ? (
                                    <p className="project-plan-error">
                                      需先停止或结束仍在进行的工作：
                                      {evidenceChecks[
                                        item.id
                                      ].reopenBlockedItems
                                        .map((entry) => entry.title)
                                        .join('、')}
                                    </p>
                                  ) : null}
                                  {editable ? (
                                    <button
                                      type="button"
                                      className="quiet"
                                      disabled={
                                        busy ||
                                        evidenceChecks[item.id]
                                          .reopenBlockedItems.length > 0
                                      }
                                      title={
                                        evidenceChecks[item.id]
                                          .reopenBlockedItems.length
                                          ? '先停止或结束仍在进行的受影响工作。'
                                          : '重开受影响交付链；之前的验收保留在计划历史。'
                                      }
                                      onClick={() =>
                                        void reopenEvidenceImpact(
                                          evidenceChecks[item.id],
                                        )
                                      }
                                    >
                                      退回受影响工作重核
                                    </button>
                                  ) : null}
                                  {pendingEvidenceReopen?.itemId === item.id ? (
                                    <div
                                      className="project-plan-reopen-confirmation"
                                      role="group"
                                      aria-label="确认退回受影响的工作项"
                                    >
                                      <p>
                                        将退回
                                        {pendingEvidenceReopen.affectedItems
                                          .map((entry) => entry.title)
                                          .join('、')}
                                        ，通知负责人重新处理，并重新打开对应阶段。原验收记录会保留在计划历史中。
                                      </p>
                                      <div className="project-plan-actions">
                                        <button
                                          type="button"
                                          className="quiet"
                                          disabled={busy}
                                          onClick={() =>
                                            setPendingEvidenceReopen(null)
                                          }
                                        >
                                          取消
                                        </button>
                                        <button
                                          type="button"
                                          className="secondary"
                                          disabled={busy}
                                          onClick={() =>
                                            void confirmEvidenceReopen()
                                          }
                                        >
                                          {busy
                                            ? '正在退回…'
                                            : '退回并通知负责人'}
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </details>
                      ) : null}
                      {editable && item.kind === 'work_package' ? (
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
                                    evidenceMessageId: '',
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
                                    evidenceMessageId: '',
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
                          {item.status === 'done' &&
                          !item.acceptanceRecorded ? (
                            <button
                              className="quiet"
                              type="button"
                              disabled={busy}
                              title="这条旧记录缺少独立提交与验收凭据；退回负责人重新提交，再由另一方验收。"
                              onClick={() =>
                                void changeItem(item, 'in_progress')
                              }
                            >
                              退回补齐验收
                            </button>
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
                              action.evidenceMessageId,
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
                          {action.status === 'submitted' ? (
                            <label>
                              关联项目群中的成果消息
                              <select
                                required
                                value={action.evidenceMessageId}
                                onChange={(event) =>
                                  setAction({
                                    ...action,
                                    evidenceMessageId: event.target.value,
                                  })
                                }
                              >
                                <option value="">
                                  {groupMessagesError
                                    ? '项目群消息读取失败'
                                    : groupMessages.length
                                      ? '选择一条实际成果消息'
                                      : '项目群还没有可关联的成果消息'}
                                </option>
                                {groupMessages
                                  .slice()
                                  .reverse()
                                  .map((message) => {
                                    const senderId =
                                      message.senderAgentId ??
                                      message.agentId ??
                                      'user';
                                    const preview = message.content
                                      .replace(/\s+/g, ' ')
                                      .trim();
                                    return (
                                      <option key={message.id} value={message.id}>
                                        {`${name(senderId)} · ${new Date(message.createdAt).toLocaleString()} · ${preview.slice(0, 100)}${preview.length > 100 ? '…' : ''}`}
                                      </option>
                                    );
                                  })}
                              </select>
                              <span className="project-plan-meta">
                                先在项目群中留下成果，再把对应消息关联到提交记录。验收将单独记录。
                                {groupMessagesError ? ` ${groupMessagesError}` : ''}
                              </span>
                            </label>
                          ) : null}
                          <div className="project-plan-actions">
                            <button
                              className="secondary"
                              type="submit"
                              disabled={
                                busy ||
                                (action.status === 'submitted' &&
                                  !action.evidenceMessageId)
                              }
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
                </details>
              </section>
            ))}
          {!plan.phases.length ? (
            <p className="project-plan-meta">项目尚未形成阶段计划。</p>
          ) : null}
        </>
      )}
    </section>
  );
}
