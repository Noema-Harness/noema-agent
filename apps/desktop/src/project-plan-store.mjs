import { z } from 'zod';

const text = (max) => z.string().trim().min(1).max(max);
const itemSchema = z.object({
  id: text(80).regex(/^[\w-]+$/u),
  title: text(160),
  ownerAgentId: text(200),
  acceptance: text(2000),
  dependsOn: z.array(text(80)).max(100).default([]),
  status: z.enum([
    'pending',
    'in_progress',
    'blocked',
    'submitted',
    'done',
    'canceled',
  ]),
  evidence: z.string().trim().max(8000).default(''),
  blocker: z.string().trim().max(2000).default(''),
});
const planSchema = z.object({
  stage: text(120),
  objective: text(4000),
  items: z.array(itemSchema).max(100),
});
const { $schema: _schema, ...parameters } = z.toJSONSchema(planSchema);
export const projectPlanParameters = parameters;
const transitions = {
  pending: ['in_progress', 'blocked', 'canceled'],
  in_progress: ['pending', 'blocked', 'submitted'],
  blocked: ['pending', 'in_progress', 'canceled'],
  submitted: ['in_progress', 'blocked', 'done'],
  done: ['in_progress'],
  canceled: ['pending'],
};

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
    const items = row ? JSON.parse(row.items_json) : [];
    const byId = new Map(items.map((item) => [item.id, item]));
    const active = items.filter((item) => item.status !== 'canceled');
    const done = active.filter((item) => item.status === 'done').length;
    return {
      projectId,
      revision: row?.revision ?? 0,
      stage: row?.stage ?? '',
      objective: row?.objective ?? '',
      items: items.map((item) => ({
        ...item,
        ready:
          item.status === 'pending' &&
          item.dependsOn.every((id) => byId.get(id)?.status === 'done'),
        blockedBy: item.dependsOn.filter(
          (id) => byId.get(id)?.status !== 'done',
        ),
      })),
      progress: {
        done,
        total: active.length,
        percentage: active.length
          ? Math.round((done / active.length) * 100)
          : null,
        submitted: active.filter((item) => item.status === 'submitted').length,
        canceled: items.length - active.length,
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

  forAgent(projectId, agentId, itemId = null) {
    const plan = this.get(projectId);
    if (itemId) {
      const item = plan.items.find((item) => item.id === itemId);
      if (!item) throw new Error('交付项不存在。');
      return {
        projectId,
        revision: plan.revision,
        stage: plan.stage,
        objective: plan.objective,
        item,
      };
    }
    const own = new Set(
      plan.items
        .filter((item) => item.ownerAgentId === agentId)
        .flatMap((item) => [item.id, ...item.dependsOn]),
    );
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
    return {
      projectId,
      revision: plan.revision,
      stage: plan.stage,
      objective: plan.objective,
      progress: plan.progress,
      items,
      omittedItems: plan.items.length - items.length,
    };
  }

  validate(projectId, input) {
    const plan = planSchema.parse(input);
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
    const byId = new Map();
    for (const item of plan.items) {
      if (byId.has(item.id)) throw new Error('计划中不能重复使用交付项 ID。');
      if (
        !(
          item.status === 'done' || item.status === 'canceled' ? known : members
        ).has(item.ownerAgentId)
      )
        throw new Error(
          '交付项负责人必须是项目中的活跃执行成员；历史已结束项保留原归属。',
        );
      if (new Set(item.dependsOn).size !== item.dependsOn.length)
        throw new Error('依赖不能重复。');
      if (['submitted', 'done'].includes(item.status) && !item.evidence)
        throw new Error('提交或验收前必须提供成果依据。');
      if (item.status === 'blocked' && !item.blocker)
        throw new Error('阻塞事项必须说明原因。');
      byId.set(item.id, item);
    }
    const visited = new Set(),
      visiting = new Set();
    const visit = (item) => {
      if (visiting.has(item.id)) throw new Error('计划依赖不能形成循环。');
      if (visited.has(item.id)) return;
      visiting.add(item.id);
      for (const id of item.dependsOn) {
        const dependency = byId.get(id);
        if (!dependency) throw new Error('计划包含不存在的依赖。');
        if (item.status !== 'canceled' && dependency.status === 'canceled')
          throw new Error('未取消的交付项不能依赖已取消事项。');
        if (
          ['in_progress', 'submitted', 'done'].includes(item.status) &&
          dependency.status !== 'done'
        )
          throw new Error('前置交付尚未验收，不能启动或完成后续工作。');
        visit(dependency);
      }
      visiting.delete(item.id);
      visited.add(item.id);
    };
    plan.items.forEach(visit);
    const working = new Set();
    for (const item of plan.items.filter(
      (item) => item.status === 'in_progress',
    )) {
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
    this.db
      .prepare(`INSERT INTO social_project_plan_revisions
      (project_id, revision, stage, objective, items_json, actor_agent_id, source_turn_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        projectId,
        expectedRevision + 1,
        validated.stage,
        validated.objective,
        JSON.stringify(validated.items),
        actorAgentId,
        sourceTurnId,
        explanation,
        new Date().toISOString(),
      );
    return this.get(projectId);
  }

  replace(input) {
    if (input.actorAgentId && input.actorAgentId !== 'noema')
      throw new Error('成员可提出规划建议；共享范围仅由用户或 Noema 修改。');
    return this.db.transaction(() => this.write(input))();
  }

  updateItem(input) {
    return this.db.transaction(() => {
      const current = this.get(input.projectId);
      const item = current.items.find((item) => item.id === input.itemId);
      if (!item) throw new Error('交付项不存在。');
      const coordinator = !input.actorAgentId || input.actorAgentId === 'noema';
      if (!coordinator && input.actorAgentId !== item.ownerAgentId)
        throw new Error('成员只能更新自己负责的交付项。');
      const status = itemSchema.shape.status.parse(input.status);
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
        status,
        evidence: input.evidence ?? item.evidence,
        blocker: input.blocker ?? item.blocker,
      };
      return this.write({
        ...input,
        plan: {
          ...current,
          items: current.items.map((entry) =>
            entry.id === item.id ? updated : entry,
          ),
        },
      });
    })();
  }
}
