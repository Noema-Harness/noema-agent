/**
 * Read-only view model helpers for the Core project detail surface.
 *
 * Owns no state and performs no writes: it only makes the bridge's plan
 * payload safe to render and gathers the two kinds of delivery evidence the
 * shell can already see (growth assets and plan item evidence).
 */

// Inputs are unvalidated bridge payloads; these helpers are the validation.
function asArray(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeProgress(value: any) {
  const progress = value && typeof value === 'object' ? value : {};
  return {
    done: asNumber(progress.done),
    total: asNumber(progress.total),
    percentage:
      typeof progress.percentage === 'number' &&
      Number.isFinite(progress.percentage)
        ? progress.percentage
        : null,
    submitted: asNumber(progress.submitted),
    canceled: asNumber(progress.canceled),
  };
}

function normalizeEvidenceRef(value: any) {
  const ref = value && typeof value === 'object' ? value : {};
  const source = ref.source && typeof ref.source === 'object' ? ref.source : {};
  return {
    ...ref,
    source,
    label: typeof ref.label === 'string' ? ref.label : '',
    observedAt: typeof ref.observedAt === 'string' ? ref.observedAt : '',
  };
}

function normalizeItem(value: any) {
  const item = value && typeof value === 'object' ? value : {};
  return {
    ...item,
    id: typeof item.id === 'string' ? item.id : '',
    kind: item.kind === 'group' ? 'group' : 'work_package',
    title: typeof item.title === 'string' ? item.title : '',
    ownerAgentId:
      typeof item.ownerAgentId === 'string' ? item.ownerAgentId : null,
    acceptance: typeof item.acceptance === 'string' ? item.acceptance : '',
    evidence: typeof item.evidence === 'string' ? item.evidence : '',
    evidenceRefs: asArray(item.evidenceRefs).map(normalizeEvidenceRef),
    evidenceReviews: asArray(item.evidenceReviews),
    reviewerIds: asArray(item.reviewerIds),
    dependsOn: asArray(item.dependsOn),
    relatedTo: asArray(item.relatedTo),
    relatedItems: asArray(item.relatedItems),
    waitingForPhases: asArray(item.waitingForPhases),
    blockedBy: asArray(item.blockedBy),
    phaseId: typeof item.phaseId === 'string' ? item.phaseId : null,
    phaseTitle: typeof item.phaseTitle === 'string' ? item.phaseTitle : '',
    blocker: typeof item.blocker === 'string' ? item.blocker : '',
  };
}

function normalizePhase(value: any) {
  const phase = value && typeof value === 'object' ? value : {};
  return {
    ...phase,
    id: typeof phase.id === 'string' ? phase.id : '',
    title: typeof phase.title === 'string' ? phase.title : '',
    outcome: typeof phase.outcome === 'string' ? phase.outcome : '',
    exitCriteria:
      typeof phase.exitCriteria === 'string' ? phase.exitCriteria : '',
    evidence: typeof phase.evidence === 'string' ? phase.evidence : '',
    dependsOn: asArray(phase.dependsOn),
    waitingForPhases: asArray(phase.waitingForPhases),
    workItems: asArray(phase.workItems).map(normalizeItem),
    progress: normalizeProgress(phase.progress),
  };
}

/**
 * Coerce a bridge plan into the arrays/fields the read-only detail renders.
 * An absent plan stays null so the view can distinguish "not loaded" from
 * "loaded but empty" (revision 0, no phases).
 */
export function normalizeProjectPlan(value: any) {
  if (!value || typeof value !== 'object') return null;
  return {
    ...value,
    projectId: typeof value.projectId === 'string' ? value.projectId : '',
    revision: asNumber(value.revision),
    stage: typeof value.stage === 'string' ? value.stage : '',
    objective: typeof value.objective === 'string' ? value.objective : '',
    phases: asArray(value.phases).map(normalizePhase),
    items: asArray(value.items).map(normalizeItem),
    phaseProgress: normalizeProgress(value.phaseProgress),
    progress: normalizeProgress(value.progress),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    reason: typeof value.reason === 'string' ? value.reason : null,
  };
}

function evidenceRefLabel(ref: any): string {
  if (ref.label) return ref.label;
  const source = ref.source ?? {};
  if (source.kind === 'file' && source.path) return source.path;
  if (source.kind === 'message' && source.messageId)
    return `消息 ${source.messageId}`;
  if (source.kind === 'execution' && source.taskId) {
    return source.stepId
      ? `执行 ${source.taskId} / ${source.stepId}`
      : `执行 ${source.taskId}`;
  }
  return '未命名来源';
}

/**
 * Return the real delivery material already present in the loaded payload.
 * Growth assets come from the project's growth batch; evidence comes from
 * work-package items. Groups and empty evidence are skipped.
 */
export function collectDeliverables(project: any, plan: any) {
  const assets: Array<{
    path: string;
    revision: number;
    isDeleted: boolean;
    reason: string;
    agentName: string;
    memberStatus: string;
    batchStatus: string;
  }> = [];
  const batch = project?.growthBatch;
  for (const member of asArray(batch?.members)) {
    for (const asset of asArray(member?.assets)) {
      if (!asset || typeof asset.path !== 'string' || !asset.path) continue;
      assets.push({
        path: asset.path,
        revision: asNumber(asset.revision),
        isDeleted: Boolean(asset.isDeleted),
        reason: typeof asset.reason === 'string' ? asset.reason : '',
        agentName: typeof member.agentName === 'string' ? member.agentName : '',
        memberStatus: member.status ?? '',
        batchStatus: batch?.status ?? '',
      });
    }
  }

  const evidence: Array<{
    itemId: string;
    title: string;
    status: string;
    phaseTitle: string;
    evidence: string;
    refs: Array<{ label: string; kind: string; observedAt: string }>;
  }> = [];
  const seen = new Set<string>();
  for (const item of asArray(plan?.items)) {
    if (!item || item.kind === 'group' || !item.id || seen.has(item.id))
      continue;
    const text = typeof item.evidence === 'string' ? item.evidence.trim() : '';
    const refs = asArray(item.evidenceRefs);
    if (!text && refs.length === 0) continue;
    seen.add(item.id);
    evidence.push({
      itemId: item.id,
      title: item.title || '未命名工作项',
      status: item.status ?? 'pending',
      phaseTitle: item.phaseTitle || '',
      evidence: text,
      refs: refs.map((ref) => ({
        label: evidenceRefLabel(ref),
        kind: ref?.source?.kind ?? '',
        observedAt: typeof ref?.observedAt === 'string' ? ref.observedAt : '',
      })),
    });
  }
  return { assets, evidence };
}
