import { z } from 'zod';

const text = (max) => z.string().trim().min(1).max(max);
const statusSchema = z.enum([
  'pending',
  'in_progress',
  'blocked',
  'submitted',
  'done',
  'canceled',
]);
const workItemSchema = z.object({
  id: text(80).regex(/^[\w-]+$/u),
  kind: z.enum(['group', 'work_package']).default('work_package'),
  parentId: z.string().trim().max(80).nullable().default(null),
  title: text(160),
  ownerAgentId: z.string().trim().max(200).default(''),
  acceptance: z.string().trim().max(2000).default(''),
  dependsOn: z.array(text(80)).max(100).default([]),
  relatedTo: z.array(text(80)).max(100).default([]),
  status: statusSchema,
  evidence: z.string().trim().max(8000).default(''),
  submittedByAgentId: z.string().trim().max(200).nullable().optional(),
  blocker: z.string().trim().max(2000).default(''),
});
const phaseSchema = z.object({
  id: text(80).regex(/^[\w-]+$/u),
  title: text(160),
  outcome: text(2000),
  exitCriteria: text(2000),
  dependsOn: z.array(text(80)).max(30).default([]),
  status: z.enum(['pending', 'done', 'canceled']).default('pending'),
  evidence: z.string().trim().max(8000).default(''),
  workItems: z.array(workItemSchema).max(100),
});
const planSchema = z.object({
  objective: text(4000),
  phases: z.array(phaseSchema).min(1).max(30),
});
const itemPatchSchema = z
  .object({
    title: text(160).optional(),
    ownerAgentId: z.string().trim().max(200).optional(),
    acceptance: z.string().trim().max(2000).optional(),
    parentId: z.string().trim().max(80).nullable().optional(),
    dependsOn: z.array(text(80)).max(100).optional(),
    relatedTo: z.array(text(80)).max(100).optional(),
  })
  .strict();
const { $schema: _schema, ...parameters } = z.toJSONSchema(planSchema);
export const projectPlanParameters = parameters;
export const projectPlanPhaseStatuses = ['pending', 'done', 'canceled'];

const transitions = {
  pending: ['in_progress', 'submitted', 'blocked', 'canceled'],
  in_progress: ['pending', 'blocked', 'submitted'],
  blocked: ['pending', 'in_progress', 'canceled'],
  submitted: ['in_progress', 'blocked', 'done'],
  done: ['in_progress'],
  canceled: ['pending'],
};

function phaseState(phase, phaseById, workItems) {
  const active = workItems.filter(
    (item) => item.kind === 'work_package' && item.status !== 'canceled',
  );
  const done = active.filter((item) => item.status === 'done').length;
  const waitingForPhases = phase.dependsOn.filter(
    (id) => phaseById.get(id)?.status !== 'done',
  );
  if (phase.status === 'canceled') return 'canceled';
  if (phase.status === 'done') return 'done';
  if (phase.status === 'pending' && waitingForPhases.length) return 'waiting';
  if (active.some((item) => item.status === 'blocked')) return 'blocked';
  if (active.length && done === active.length) return 'awaiting_review';
  if (
    active.some((item) =>
      ['in_progress', 'submitted', 'done'].includes(item.status),
    )
  )
    return 'in_progress';
  if (active.some((item) => item.ready)) return 'ready';
  return active.length ? 'pending' : 'needs_breakdown';
}

export function parseProjectPlanRevision(row) {
  const stored = JSON.parse(row.items_json);
  if (!Array.isArray(stored)) {
    return planSchema.parse({
      objective: row.objective,
      phases: stored.phases,
    });
  }
  const phaseId = 'legacy-stage';
  return planSchema.parse({
    objective: row.objective,
    phases: [
      {
        id: phaseId,
        title: row.stage || '既有阶段',
        outcome: row.objective,
        exitCriteria: '本阶段全部有效交付项通过验收，并核对阶段目标。',
        dependsOn: [],
        status: 'pending',
        evidence: '',
        workItems: stored,
      },
    ],
  });
}

function flatten(phases) {
  return phases.flatMap((phase) =>
    phase.workItems.map((item) => ({ ...item, phaseId: phase.id })),
  );
}

function normalizePlanInput(input) {
  if (!input || Array.isArray(input.phases) || !Array.isArray(input.items))
    return input;
  return {
    objective: input.objective,
    phases: [
      {
        id: 'legacy-stage',
        title: input.stage || '现阶段',
        outcome: input.objective,
        exitCriteria: '本阶段全部有效交付项通过验收，并核对阶段目标。',
        dependsOn: [],
        status: 'pending',
        evidence: '',
        workItems: input.items,
      },
    ],
  };
}

/** Project-owned, append-only plans. Model actor identity is supplied by the runtime. */
export class ProjectPlanStore {
  constructor(db) {
    this.db = db;
  }

  project(projectId) {
    const project = this.db
      .prepare('SELECT id, status FROM social_projects WHERE id = ?')
      .get(projectId);
    if (!project) throw new Error('项目不存在。');
    return project;
  }

  get(projectId) {
    this.project(projectId);
    const row = this.db
      .prepare(
        'SELECT * FROM social_project_plan_revisions WHERE project_id = ? ORDER BY revision DESC LIMIT 1',
      )
      .get(projectId);
    const base = row
      ? parseProjectPlanRevision(row)
      : { objective: '', phases: [] };
    const rawItems = flatten(base.phases);
    const byId = new Map(rawItems.map((item) => [item.id, item]));
    const phaseById = new Map(base.phases.map((phase) => [phase.id, phase]));
    const items = rawItems.map((item) => {
      const phase = phaseById.get(item.phaseId);
      const waitingForPhases = phase.dependsOn.filter(
        (id) => phaseById.get(id)?.status !== 'done',
      );
      const blockedBy = item.dependsOn.filter(
        (id) => byId.get(id)?.status !== 'done',
      );
      if (item.kind === 'group')
        return {
          ...item,
          ready: false,
          canResume: false,
          blockedBy: [],
          waitingForPhases,
          phaseTitle: phase.title,
        };
      return {
        ...item,
        ready:
          phase.status === 'pending' &&
          waitingForPhases.length === 0 &&
          item.status === 'pending' &&
          blockedBy.length === 0,
        canResume:
          phase.status === 'pending' &&
          waitingForPhases.length === 0 &&
          item.status === 'blocked' &&
          blockedBy.length === 0,
        blockedBy,
        waitingForPhases,
        phaseTitle: phase.title,
      };
    });
    const enrichedById = new Map(items.map((item) => [item.id, item]));
    const childrenByParent = new Map();
    for (const item of items) {
      if (!item.parentId) continue;
      const children = childrenByParent.get(item.parentId) ?? [];
      children.push(item);
      childrenByParent.set(item.parentId, children);
    }
    for (const item of items) {
      let depth = 0;
      let parentId = item.parentId;
      while (parentId && depth < 100) {
        depth += 1;
        parentId = enrichedById.get(parentId)?.parentId ?? null;
      }
      item.depth = depth;
      item.childCount = childrenByParent.get(item.id)?.length ?? 0;
    }
    const descendantPackages = (groupId) => {
      const descendants = [];
      const visit = (parentId) => {
        for (const child of childrenByParent.get(parentId) ?? []) {
          if (child.kind === 'work_package') descendants.push(child);
          else visit(child.id);
        }
      };
      visit(groupId);
      return descendants;
    };
    for (const item of items) {
      item.relatedItems = item.relatedTo
        .map((id) => enrichedById.get(id))
        .filter(Boolean)
        .map(({ id, title, status }) => ({ id, title, status }));
      if (item.kind === 'group') {
        const leaves = descendantPackages(item.id);
        const activeLeaves = leaves.filter(
          (entry) => entry.status !== 'canceled',
        );
        const doneLeaves = activeLeaves.filter(
          (entry) => entry.status === 'done',
        ).length;
        item.childProgress = {
          done: doneLeaves,
          total: activeLeaves.length,
          percentage: activeLeaves.length
            ? Math.round((doneLeaves / activeLeaves.length) * 100)
            : null,
        };
      }
    }
    const phases = base.phases.map((phase) => {
      const phaseItems = phase.workItems.map((item) =>
        enrichedById.get(item.id),
      );
      const orderedItems = [];
      const orderedIds = new Set();
      const appendTree = (item) => {
        if (orderedIds.has(item.id)) return;
        orderedIds.add(item.id);
        orderedItems.push(item);
        for (const child of childrenByParent.get(item.id) ?? [])
          appendTree(child);
      };
      for (const item of phaseItems) {
        if (!item.parentId) appendTree(item);
      }
      for (const item of phaseItems) appendTree(item);
      const active = phaseItems.filter(
        (item) => item.kind === 'work_package' && item.status !== 'canceled',
      );
      const done = active.filter((item) => item.status === 'done').length;
      const submitted = active.filter(
        (item) => item.status === 'submitted',
      ).length;
      const canceled = phaseItems.filter(
        (item) => item.kind === 'work_package' && item.status === 'canceled',
      ).length;
      const waitingForPhases = phase.dependsOn.filter(
        (id) => phaseById.get(id)?.status !== 'done',
      );
      return {
        ...phase,
        workItems: orderedItems,
        waitingForPhases,
        state: phaseState(phase, phaseById, phaseItems),
        progress: {
          done,
          total: active.length,
          percentage: active.length
            ? Math.round((done / active.length) * 100)
            : null,
          submitted,
          canceled,
        },
      };
    });
    const activeItems = items.filter(
      (item) => item.kind === 'work_package' && item.status !== 'canceled',
    );
    const done = activeItems.filter((item) => item.status === 'done').length;
    const activePhases = phases.filter((phase) => phase.status !== 'canceled');
    const donePhases = activePhases.filter(
      (phase) => phase.status === 'done',
    ).length;
    const currentPhase = phases.find(
      (phase) => !['done', 'canceled'].includes(phase.status),
    );
    return {
      projectId,
      revision: row?.revision ?? 0,
      stage: currentPhase?.title ?? '',
      objective: base.objective,
      phases,
      items,
      phaseProgress: {
        done: donePhases,
        total: activePhases.length,
        percentage: activePhases.length
          ? Math.round((donePhases / activePhases.length) * 100)
          : null,
        canceled: phases.length - activePhases.length,
      },
      progress: {
        done,
        total: activeItems.length,
        percentage: activeItems.length
          ? Math.round((done / activeItems.length) * 100)
          : null,
        submitted: activeItems.filter((item) => item.status === 'submitted')
          .length,
        canceled: items.filter(
          (item) => item.kind === 'work_package' && item.status === 'canceled',
        ).length,
      },
      updatedAt: row?.created_at ?? null,
      reason: row?.reason ?? null,
    };
  }

  history(projectId) {
    this.project(projectId);
    return this.db
      .prepare(
        'SELECT revision, stage, reason, actor_agent_id AS actorAgentId, source_turn_id AS sourceTurnId, created_at AS createdAt FROM social_project_plan_revisions WHERE project_id = ? ORDER BY revision DESC LIMIT 30',
      )
      .all(projectId);
  }

  forAgent(projectId, agentId, itemId = null, phaseId = null) {
    if (itemId && phaseId) throw new Error('一次只能读取一个具体工作范围。');
    const plan = this.get(projectId);
    const itemsById = new Map(plan.items.map((item) => [item.id, item]));
    if (phaseId) {
      const phase = plan.phases.find((entry) => entry.id === phaseId);
      if (!phase) throw new Error('阶段不存在。');
      const prerequisitePhases = phase.dependsOn.map((id) => {
        const prerequisite = plan.phases.find((entry) => entry.id === id);
        return {
          id: prerequisite.id,
          title: prerequisite.title,
          outcome: prerequisite.outcome,
          status: prerequisite.status,
          evidence: prerequisite.evidence.slice(0, 500),
        };
      });
      return {
        projectId,
        revision: plan.revision,
        objective: plan.objective,
        phase: {
          ...phase,
          evidence: phase.evidence.slice(0, 500),
          workItems: phase.workItems.map((item) => ({
            ...item,
            acceptance: item.acceptance.slice(0, 400),
            evidence: item.evidence.slice(0, 500),
            blocker: item.blocker.slice(0, 300),
          })),
        },
        prerequisitePhases,
        dependencyItems: plan.items
          .filter((item) =>
            phase.workItems.some((workItem) =>
              workItem.dependsOn.includes(item.id),
            ),
          )
          .map((item) => ({
            id: item.id,
            title: item.title,
            status: item.status,
            evidence: item.evidence.slice(0, 500),
          })),
      };
    }
    if (itemId) {
      const item = plan.items.find((item) => item.id === itemId);
      if (!item) throw new Error('交付项不存在。');
      const phase = plan.phases.find((phase) => phase.id === item.phaseId);
      const descendants =
        item.kind === 'group'
          ? plan.items.filter((candidate) => {
              let parentId = candidate.parentId;
              while (parentId) {
                if (parentId === item.id) return true;
                parentId = itemsById.get(parentId)?.parentId ?? null;
              }
              return false;
            })
          : [];
      return {
        projectId,
        revision: plan.revision,
        objective: plan.objective,
        phase,
        item,
        ...(item.kind === 'group' ? { descendants } : {}),
      };
    }
    const own = new Set();
    for (const item of plan.items) {
      if (item.kind !== 'work_package' || item.ownerAgentId !== agentId)
        continue;
      own.add(item.id);
      item.dependsOn.forEach((id) => own.add(id));
      item.relatedTo.forEach((id) => own.add(id));
      let parentId = item.parentId;
      while (parentId) {
        own.add(parentId);
        parentId = itemsById.get(parentId)?.parentId ?? null;
      }
    }
    const candidates = [...plan.items].sort(
      (a, b) => Number(own.has(b.id)) - Number(own.has(a.id)),
    );
    const items = [];
    let length = 0;
    for (const item of candidates) {
      const bounded = {
        ...item,
        acceptance: item.acceptance.slice(0, 400),
        evidence: item.evidence.slice(0, 500),
        blocker: item.blocker.slice(0, 300),
      };
      const size = JSON.stringify(bounded).length;
      if (length + size > 12_000) break;
      items.push(bounded);
      length += size;
    }
    const includedPhases = plan.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      outcome: phase.outcome,
      exitCriteria: phase.exitCriteria,
      dependsOn: phase.dependsOn,
      status: phase.status,
      state: phase.state,
      waitingForPhases: phase.waitingForPhases,
      progress: phase.progress,
      evidence: phase.evidence.slice(0, 500),
    }));
    return {
      projectId,
      revision: plan.revision,
      objective: plan.objective,
      stage: plan.stage,
      progress: plan.progress,
      phaseProgress: plan.phaseProgress,
      phases: includedPhases,
      items,
      omittedItems: plan.items.length - items.length,
    };
  }

  validate(projectId, input) {
    const plan = planSchema.parse(normalizePlanInput(input));
    const membership = this.db
      .prepare(
        `SELECT ps.agent_id AS id, ps.status, a.archived_at AS archivedAt FROM social_project_sessions ps JOIN social_agents a ON a.id = ps.agent_id WHERE ps.project_id = ?`,
      )
      .all(projectId);
    const known = new Set(membership.map((m) => m.id));
    const members = new Set(
      membership
        .filter((m) => m.status === 'active' && !m.archivedAt)
        .map((m) => m.id),
    );
    const phaseById = new Map();
    const byId = new Map();
    const sourceItems = new Map();
    let itemCount = 0;
    for (const phase of plan.phases) {
      if (phaseById.has(phase.id)) throw new Error('阶段 ID 不能重复。');
      phaseById.set(phase.id, phase);
      for (const item of phase.workItems) {
        itemCount += 1;
        if (byId.has(item.id)) throw new Error('交付项 ID 不能重复。');
        if (item.kind === 'group') {
          if (
            item.ownerAgentId ||
            item.acceptance ||
            item.dependsOn.length ||
            item.relatedTo.length ||
            item.status !== 'pending' ||
            item.evidence ||
            item.blocker
          )
            throw new Error('结构分组不能设置执行状态、负责人或工作关系。');
        } else {
          if (!item.ownerAgentId || !item.acceptance)
            throw new Error('可执行工作包必须包含负责人和验收条件。');
          if (
            !(
              item.status === 'done' || item.status === 'canceled'
                ? known
                : members
            ).has(item.ownerAgentId)
          )
            throw new Error(
              '交付项负责人必须是项目中的活跃执行成员；历史已结束项保留原归属。',
            );
        }
        if (new Set(item.dependsOn).size !== item.dependsOn.length)
          throw new Error('交付项依赖不能重复。');
        if (new Set(item.relatedTo).size !== item.relatedTo.length)
          throw new Error('相关工作项不能重复。');
        if (item.relatedTo.includes(item.id))
          throw new Error('工作项不能关联自身。');
        if (['submitted', 'done'].includes(item.status) && !item.evidence)
          throw new Error('提交或验收前必须提供成果依据。');
        if (item.status === 'blocked' && !item.blocker)
          throw new Error('阻塞事项必须说明原因。');
        byId.set(item.id, { ...item, phaseId: phase.id });
        sourceItems.set(item.id, item);
      }
      if (phase.status === 'done' && !phase.evidence)
        throw new Error('阶段验收必须提供成果依据。');
    }
    if (itemCount > 100) throw new Error('共享计划最多包含 100 项工作。');

    const parentEntries = new Map();
    for (const phase of plan.phases) {
      for (const item of phase.workItems) {
        if (!item.parentId) continue;
        const parent = byId.get(item.parentId);
        if (!parent || parent.phaseId !== phase.id || parent.kind !== 'group')
          throw new Error('工作包只能归入同阶段的结构分组。');
        parentEntries.set(item.id, parent);
      }
    }
    const visitedParents = new Set();
    const visitingParents = new Set();
    const visitParent = (id) => {
      if (visitingParents.has(id))
        throw new Error('计划父子层级不能形成循环。');
      if (visitedParents.has(id)) return;
      visitingParents.add(id);
      const parent = parentEntries.get(id);
      if (parent) visitParent(parent.id);
      visitingParents.delete(id);
      visitedParents.add(id);
    };
    for (const item of byId.values()) visitParent(item.id);

    const validateGraph = (entries, getDependencies, getId, missingMessage) => {
      const visited = new Set();
      const visiting = new Set();
      const visit = (entry) => {
        const id = getId(entry);
        if (visiting.has(id)) throw new Error('计划依赖不能形成循环。');
        if (visited.has(id)) return;
        visiting.add(id);
        for (const dependencyId of getDependencies(entry)) {
          const dependency = entries.get(dependencyId);
          if (!dependency) throw new Error(missingMessage);
          visit(dependency);
        }
        visiting.delete(id);
        visited.add(id);
      };
      for (const entry of entries.values()) visit(entry);
    };
    validateGraph(
      phaseById,
      (phase) => phase.dependsOn,
      (phase) => phase.id,
      '阶段包含不存在的前置阶段。',
    );
    validateGraph(
      byId,
      (item) => item.dependsOn,
      (item) => item.id,
      '计划包含不存在的依赖（交付项依赖）。',
    );
    for (const item of byId.values()) {
      if (item.kind === 'group') continue;
      if (item.relatedTo.some((id) => !byId.has(id)))
        throw new Error('计划包含不存在的相关工作项。');
      if (
        [...item.dependsOn, ...item.relatedTo].some(
          (id) => byId.get(id)?.kind !== 'work_package',
        )
      )
        throw new Error('工作包关系只能指向可执行工作包。');
    }
    for (const [itemId, item] of sourceItems) {
      for (const relatedId of item.relatedTo) {
        if (
          item.dependsOn.includes(relatedId) ||
          byId.get(relatedId).dependsOn.includes(itemId)
        )
          throw new Error('同一对工作项不能同时标记为相关和阻塞依赖。');
        const related = sourceItems.get(relatedId);
        if (!related.relatedTo.includes(itemId)) related.relatedTo.push(itemId);
      }
    }
    for (const phase of plan.phases) {
      for (const dependencyId of phase.dependsOn) {
        if (
          phaseById.get(dependencyId).status !== 'done' &&
          phase.status === 'done'
        )
          throw new Error('前置阶段尚未验收，不能完成后续阶段。');
      }
      const phaseItems = phase.workItems;
      const active = phaseItems.filter(
        (item) => item.kind === 'work_package' && item.status !== 'canceled',
      );
      if (phase.status === 'done') {
        if (!active.length || active.some((item) => item.status !== 'done'))
          throw new Error('阶段工作项未全部验收，不能完成阶段。');
      }
      if (phase.status === 'canceled' && active.length)
        throw new Error('取消阶段前必须先取消其中所有未完成工作项。');
      for (const item of phaseItems) {
        if (item.kind === 'group') continue;
        const phasePrerequisitesDone = phase.dependsOn.every(
          (id) => phaseById.get(id)?.status === 'done',
        );
        if (
          ['in_progress', 'submitted', 'done'].includes(item.status) &&
          !phasePrerequisitesDone
        )
          throw new Error('前置阶段尚未验收，不能启动或验收后续工作。');
        if (
          phase.status !== 'canceled' &&
          item.status !== 'canceled' &&
          item.dependsOn.some((id) => byId.get(id).status === 'canceled')
        )
          throw new Error('未取消的交付项不能依赖已取消事项。');
        if (
          ['in_progress', 'submitted', 'done'].includes(item.status) &&
          item.dependsOn.some((id) => byId.get(id).status !== 'done')
        )
          throw new Error('前置交付尚未验收，不能启动或完成后续工作。');
        if (
          item.dependsOn.some(
            (id) =>
              byId.get(id).phaseId !== phase.id &&
              !phase.dependsOn.includes(byId.get(id).phaseId),
          )
        )
          throw new Error('跨阶段工作项依赖必须同时声明对应的前置阶段。');
      }
    }
    const working = new Set();
    for (const item of byId.values()) {
      if (item.kind === 'group') continue;
      if (item.status !== 'in_progress') continue;
      if (working.has(item.ownerAgentId))
        throw new Error('同一成员在本项目中只能同时推进一项计划工作。');
      working.add(item.ownerAgentId);
    }
    return plan;
  }

  write({
    projectId,
    expectedRevision,
    actorAgentId = null,
    sourceTurnId = null,
    reason,
    plan,
  }) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0)
      throw new Error('必须提供读取到的计划版本。');
    const explanation = text(1000).parse(reason);
    const project = this.project(projectId);
    if (project.status !== 'active')
      throw new Error('项目已归档或正在等待用户反馈，计划暂不可修改。');
    const current = this.get(projectId);
    if (current.revision !== expectedRevision)
      throw new Error('计划已被更新，请重新读取最新版本后再提交。');
    const validated = this.validate(projectId, plan);
    const stage =
      validated.phases.find((phase) => phase.status === 'pending')?.title ?? '';
    this.db
      .prepare(`INSERT INTO social_project_plan_revisions
      (project_id, revision, stage, objective, items_json, actor_agent_id, source_turn_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        projectId,
        expectedRevision + 1,
        stage,
        validated.objective,
        JSON.stringify({ schemaVersion: 2, phases: validated.phases }),
        actorAgentId,
        sourceTurnId,
        explanation,
        new Date().toISOString(),
      );
    this.onChange?.(projectId, { sourceTurnId });
    return this.get(projectId);
  }

  replace(input) {
    if (input.actorAgentId && input.actorAgentId !== 'noema')
      throw new Error('成员可提出规划建议；共享范围仅由用户或 Noema 修改。');
    return this.db.transaction(() => {
      const current = this.get(input.projectId);
      const normalizedPlan = normalizePlanInput(input.plan);
      const priorSubmitters = new Map(
        current.items.map((item) => [item.id, item.submittedByAgentId ?? null]),
      );
      const plan = Array.isArray(normalizedPlan?.phases)
        ? {
            ...normalizedPlan,
            phases: normalizedPlan.phases.map((phase) => ({
              ...phase,
              workItems: Array.isArray(phase.workItems)
                ? phase.workItems.map((item) => ({
                    ...item,
                    submittedByAgentId: priorSubmitters.get(item.id) ?? null,
                  }))
                : phase.workItems,
            })),
          }
        : normalizedPlan;
      return this.write({ ...input, plan });
    })();
  }

  updateItem(input) {
    return this.db.transaction(() => {
      const current = this.get(input.projectId);
      const item = current.items.find((item) => item.id === input.itemId);
      if (!item) throw new Error('交付项不存在。');
      if (item.kind !== 'work_package')
        throw new Error('结构分组不能推进状态；请更新其中的叶工作包。');
      const phase = current.phases.find((phase) => phase.id === item.phaseId);
      if (phase?.status === 'done' && input.status !== 'done')
        throw new Error(
          '工作项所属阶段已验收；请通过计划修订调整范围并重开相关阶段。',
        );
      const coordinator = !input.actorAgentId || input.actorAgentId === 'noema';
      const patch = itemPatchSchema.parse(input.patch ?? {});
      if (Object.keys(patch).length && !coordinator)
        throw new Error('只有用户或 Noema 可以修改工作包结构与范围。');
      if (!coordinator && input.actorAgentId !== item.ownerAgentId)
        throw new Error('成员只能更新自己负责的交付项。');
      const status = statusSchema.parse(input.status ?? item.status);
      if (
        status === 'submitted' &&
        item.status !== 'submitted' &&
        input.actorAgentId === 'noema'
      )
        throw new Error('Noema 不能代替负责人提交成果。');
      if (
        !coordinator &&
        (['done', 'canceled'].includes(status) ||
          ['done', 'canceled'].includes(item.status))
      )
        throw new Error('成员不能自行验收、取消或重新开启已结束的交付项。');
      if (status !== item.status && !transitions[item.status].includes(status))
        throw new Error('交付项状态转换无效。');
      const updated = {
        ...item,
        ...patch,
        status,
        submittedByAgentId:
          status === 'submitted'
            ? item.status === 'submitted'
              ? item.submittedByAgentId
              : (input.actorAgentId ?? 'user')
            : status === 'done'
              ? item.submittedByAgentId
              : null,
        evidence: input.evidence ?? item.evidence,
        blocker: input.blocker ?? item.blocker,
      };
      return this.write({
        ...input,
        plan: {
          objective: current.objective,
          phases: current.phases.map((phase) => ({
            ...phase,
            workItems: phase.workItems.map((entry) =>
              entry.id === item.id
                ? updated
                : patch.relatedTo
                  ? {
                      ...entry,
                      relatedTo: patch.relatedTo.includes(entry.id)
                        ? [
                            ...entry.relatedTo.filter((id) => id !== item.id),
                            item.id,
                          ]
                        : entry.relatedTo.filter((id) => id !== item.id),
                    }
                  : entry,
            ),
          })),
        },
      });
    })();
  }

  updatePhase(input) {
    return this.db.transaction(() => {
      const current = this.get(input.projectId);
      const phase = current.phases.find((phase) => phase.id === input.phaseId);
      if (!phase) throw new Error('阶段不存在。');
      if (input.actorAgentId && input.actorAgentId !== 'noema')
        throw new Error('只有用户或 Noema 可以验收阶段。');
      if (current.revision !== input.expectedRevision)
        throw new Error('计划已被更新，请重新读取最新版本后再提交。');
      if (input.status === 'done' && phase.status !== 'done') {
        if (!input.evidence?.trim())
          throw new Error('阶段验收必须提供阶段成果依据。');
        const active = phase.workItems.filter(
          (item) => item.kind === 'work_package' && item.status !== 'canceled',
        );
        if (!active.length || active.some((item) => item.status !== 'done'))
          throw new Error('阶段工作项未全部验收，不能完成阶段。');
        if (
          phase.dependsOn.some(
            (id) =>
              !current.phases.some(
                (entry) => entry.id === id && entry.status === 'done',
              ),
          )
        )
          throw new Error('前置阶段尚未验收，不能完成后续阶段。');
      } else if (input.status === 'canceled' && phase.status !== 'canceled') {
        if (
          phase.workItems.some(
            (item) =>
              item.kind === 'work_package' && item.status !== 'canceled',
          ) ||
          current.phases.some(
            (entry) =>
              entry.dependsOn.includes(phase.id) &&
              !['pending', 'canceled'].includes(entry.status),
          )
        )
          throw new Error(
            '取消阶段前须取消其中工作项，并确认没有已启动的后续阶段。',
          );
      } else if (input.status === 'pending') {
        if (phase.status === 'done')
          throw new Error('已验收阶段不能直接退回；请通过新计划修订调整范围。');
        if (phase.status === 'canceled')
          throw new Error('已取消阶段不能直接恢复；请通过新计划修订调整范围。');
      } else if (input.status !== phase.status) {
        throw new Error('阶段状态无效。');
      }
      return this.write({
        ...input,
        plan: {
          objective: current.objective,
          phases: current.phases.map((entry) =>
            entry.id === phase.id
              ? {
                  ...entry,
                  status: input.status,
                  evidence:
                    input.status === 'done' ? input.evidence.trim() : '',
                }
              : entry,
          ),
        },
      });
    })();
  }
}
