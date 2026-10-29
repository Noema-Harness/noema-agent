import { randomUUID } from 'node:crypto';
import { ProjectPlanStore } from './project-plan-store.mjs';

function isoNow() {
  return new Date().toISOString();
}

function requireText(value, label, maxLength = 100_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${label}不能为空，且不得超过 ${maxLength} 个字符。`);
  }
  return value.trim();
}

/**
 * Projects own shared rooms and isolated per-member execution sessions.
 * Project-session rooms stay out of the ordinary contact/room list.
 */
export class SocialProjectStore {
  constructor({ db, socialChatStore }) {
    this.db = db;
    this.socialChatStore = socialChatStore;
    this.plans = new ProjectPlanStore(db);
    this.recoverProjectGrowthMembers();
  }

  listProjects({ includeArchived = true } = {}) {
    const projects = this.db
      .prepare(`
        SELECT p.id, p.title, p.brief, p.status,
               p.origin_room_id AS originRoomId,
               p.source_message_id AS sourceMessageId,
               p.group_room_id AS groupRoomId,
               p.created_at AS createdAt,
               p.updated_at AS updatedAt,
               p.archived_at AS archivedAt,
               MAX(p.updated_at, group_room.updated_at,
                   COALESCE((
                     SELECT MAX(session_room.updated_at)
                     FROM social_project_sessions AS ps
                     JOIN social_rooms AS session_room ON session_room.id = ps.room_id
                     WHERE ps.project_id = p.id
                   ), p.updated_at)) AS lastActivityAt
        FROM social_projects AS p
        JOIN social_rooms AS group_room ON group_room.id = p.group_room_id
        WHERE (? = 1 OR p.status <> 'archived')
        ORDER BY lastActivityAt DESC, p.created_at DESC
      `)
      .all(includeArchived ? 1 : 0);
    return projects.map((project) =>
      this.#hydrateProject(project, { includeGroup: false }),
    );
  }

  getProject(projectId) {
    requireText(projectId, '项目 ID', 200);
    const project = this.db
      .prepare(`
        SELECT p.id, p.title, p.brief, p.status,
               p.origin_room_id AS originRoomId,
               p.source_message_id AS sourceMessageId,
               p.group_room_id AS groupRoomId,
               p.created_at AS createdAt,
               p.updated_at AS updatedAt,
               p.archived_at AS archivedAt,
               MAX(p.updated_at, group_room.updated_at,
                   COALESCE((
                     SELECT MAX(session_room.updated_at)
                     FROM social_project_sessions AS ps
                     JOIN social_rooms AS session_room ON session_room.id = ps.room_id
                     WHERE ps.project_id = p.id
                   ), p.updated_at)) AS lastActivityAt
        FROM social_projects AS p
        JOIN social_rooms AS group_room ON group_room.id = p.group_room_id
        WHERE p.id = ?
      `)
      .get(projectId);
    if (!project) throw new Error('找不到这个项目。');
    return this.#hydrateProject(project);
  }

  #hydrateProject(project, { includeGroup = true } = {}) {
    const members = this.db
      .prepare(`
        SELECT ps.agent_id AS agentId, ps.room_id AS sessionRoomId,
               ps.status, ps.joined_at AS joinedAt, ps.removed_at AS removedAt,
               a.name, a.headline, a.kind, a.archived_at AS agentArchivedAt
        FROM social_project_sessions AS ps
        JOIN social_agents AS a ON a.id = ps.agent_id
        WHERE ps.project_id = ? ORDER BY ps.joined_at, a.name
      `)
      .all(project.id);
    const growthBatch = this.db
      .prepare(`
        SELECT id, plan_revision AS planRevision, status,
               completed_at AS completedAt, finalized_at AS finalizedAt
        FROM social_project_growth_batches
        WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 1
      `)
      .get(project.id);
    const growthMembers = growthBatch
      ? this.db
          .prepare(`
            SELECT gm.agent_id AS agentId, a.name AS agentName, gm.status,
                   gm.error_message AS errorMessage
            FROM social_project_growth_members AS gm
            JOIN social_agents AS a ON a.id = gm.agent_id
            WHERE gm.batch_id = ? ORDER BY gm.created_at, gm.agent_id
          `)
          .all(growthBatch.id)
      : [];
    return {
      ...project,
      growthBatch: growthBatch
        ? { ...growthBatch, members: growthMembers }
        : null,
      pendingReview:
        this.db
          .prepare(`SELECT id, request_message_id AS requestMessageId, room_id AS roomId
                  FROM social_project_reviews WHERE project_id = ? AND status = 'pending'`)
          .get(project.id) ?? null,
      ...(includeGroup
        ? { group: this.socialChatStore.getRoomSnapshot(project.groupRoomId) }
        : {}),
      members,
    };
  }

  getProjectGrowthBatch(batchId) {
    requireText(batchId, '成长批次 ID', 200);
    const batch = this.db
      .prepare(`
        SELECT id, project_id AS projectId, plan_revision AS planRevision,
               status, created_at AS createdAt, updated_at AS updatedAt,
               completed_at AS completedAt, finalized_at AS finalizedAt
        FROM social_project_growth_batches WHERE id = ?
      `)
      .get(batchId);
    if (!batch) return null;
    const members = this.db
      .prepare(`
        SELECT gm.agent_id AS agentId, a.name AS agentName,
               gm.session_room_id AS sessionRoomId, gm.status,
               gm.turn_id AS turnId, gm.brief, gm.error_code AS errorCode,
               gm.error_message AS errorMessage,
               gm.created_at AS createdAt, gm.updated_at AS updatedAt,
               gm.completed_at AS completedAt
        FROM social_project_growth_members AS gm
        JOIN social_agents AS a ON a.id = gm.agent_id
        WHERE gm.batch_id = ? ORDER BY gm.created_at, gm.agent_id
      `)
      .all(batchId);
    return { ...batch, members };
  }

  createProjectGrowthBatch(projectId) {
    requireText(projectId, '项目 ID', 200);
    return this.db.transaction(() => {
      const project = this.getProject(projectId);
      const plan = this.plans.get(projectId);
      const existing = plan.revision
        ? this.db
            .prepare(`
              SELECT id FROM social_project_growth_batches
              WHERE project_id = ? AND plan_revision = ?
            `)
            .get(projectId, plan.revision)
        : null;
      if (existing) return this.getProjectGrowthBatch(existing.id);
      if (project.status !== 'active') {
        throw new Error('只有进行中的项目可以开始成长整理。');
      }
      if (project.pendingReview) {
        throw new Error('项目仍在等待用户评审，不能开始成长整理。');
      }
      if (!plan.revision || !plan.items.length || !plan.phases.length) {
        throw new Error('项目尚无可验收的共享计划，不能开始成长整理。');
      }
      if (
        plan.items.some((item) => !['done', 'canceled'].includes(item.status))
      ) {
        throw new Error('共享计划仍有未验收或阻塞事项，不能开始成长整理。');
      }
      if (
        plan.phases.some(
          (phase) => !['done', 'canceled'].includes(phase.status),
        )
      ) {
        throw new Error('共享计划仍有阶段未完成验收，不能开始成长整理。');
      }
      if (!plan.items.some((item) => item.status === 'done')) {
        throw new Error('共享计划没有已验收的交付，不能启动成员成长整理。');
      }
      const activeWork = this.db
        .prepare(`
          SELECT 1 FROM social_work_tasks
          WHERE status IN ('starting', 'running', 'verifying')
            AND (room_id = ? OR room_id IN (
              SELECT room_id FROM social_project_sessions WHERE project_id = ?
            ))
          UNION ALL
          SELECT 1 FROM social_messages
          WHERE status = 'streaming' AND (room_id = ? OR room_id IN (
            SELECT room_id FROM social_project_sessions WHERE project_id = ?
          ))
          UNION ALL
          SELECT 1 FROM social_project_group_inbox WHERE project_id = ?
          UNION ALL
          SELECT 1 FROM social_project_reports
          WHERE project_id = ? AND status IN ('pending', 'processing')
          LIMIT 1
        `)
        .get(
          project.groupRoomId,
          projectId,
          project.groupRoomId,
          projectId,
          projectId,
          projectId,
        );
      if (activeWork) {
        throw new Error('项目仍有对话、待处理群消息或执行在进行。');
      }
      const members = this.db
        .prepare(`
          SELECT ps.agent_id AS agentId, ps.room_id AS sessionRoomId
          FROM social_project_sessions AS ps
          JOIN social_agents AS a ON a.id = ps.agent_id
          WHERE ps.project_id = ? AND ps.status = 'active'
            AND a.archived_at IS NULL AND a.kind = 'specialist'
          ORDER BY ps.joined_at, ps.agent_id
        `)
        .all(projectId);
      if (!members.length) throw new Error('项目没有可复盘的活跃专业成员。');

      const id = randomUUID();
      const now = isoNow();
      this.db
        .prepare(`
          INSERT INTO social_project_growth_batches
            (id, project_id, plan_revision, status, created_at, updated_at)
          VALUES (?, ?, ?, 'running', ?, ?)
        `)
        .run(id, projectId, plan.revision, now, now);
      const insertMember = this.db.prepare(`
        INSERT INTO social_project_growth_members
          (batch_id, agent_id, session_room_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', ?, ?)
      `);
      for (const member of members) {
        insertMember.run(id, member.agentId, member.sessionRoomId, now, now);
      }
      return this.getProjectGrowthBatch(id);
    })();
  }

  claimNextProjectGrowthMember(batchId) {
    requireText(batchId, '成长批次 ID', 200);
    return this.db.transaction(() => {
      const row = this.db
        .prepare(`
          SELECT gm.agent_id AS agentId, gm.session_room_id AS sessionRoomId,
                 gm.status, b.project_id AS projectId, b.plan_revision AS planRevision
          FROM social_project_growth_members AS gm
          JOIN social_project_growth_batches AS b ON b.id = gm.batch_id
          WHERE gm.batch_id = ? AND gm.status = 'pending' AND b.status = 'running'
          ORDER BY gm.created_at, gm.agent_id LIMIT 1
        `)
        .get(batchId);
      if (!row) return null;
      const now = isoNow();
      const claimed = this.db
        .prepare(`
          UPDATE social_project_growth_members SET status = 'running',
            error_code = NULL, error_message = NULL, updated_at = ?
          WHERE batch_id = ? AND agent_id = ? AND status = 'pending'
        `)
        .run(now, batchId, row.agentId);
      if (claimed.changes !== 1) return null;
      return { ...row, status: 'running' };
    })();
  }

  bindProjectGrowthTurn(batchId, agentId, turnId) {
    const id = requireText(batchId, '成长批次 ID', 200);
    const member = requireText(agentId, '成员 ID', 200);
    const turn = requireText(turnId, '成长轮次 ID', 200);
    const now = isoNow();
    const updated = this.db
      .prepare(`
        UPDATE social_project_growth_members SET turn_id = ?, updated_at = ?
        WHERE batch_id = ? AND agent_id = ? AND status = 'running'
          AND (turn_id IS NULL OR turn_id = ?)
      `)
      .run(turn, now, id, member, turn);
    if (updated.changes !== 1) throw new Error('成长轮次无法绑定到当前成员。');
    return this.getProjectGrowthBatch(id);
  }

  finishProjectGrowthMember(batchId, agentId, { status, brief }) {
    if (!['completed', 'no_change'].includes(status)) {
      throw new TypeError('成员成长结果状态无效。');
    }
    const normalizedBrief = requireText(brief, '经历简报', 4_000);
    const now = isoNow();
    return this.db.transaction(() => {
      const existing = this.db
        .prepare(`
          SELECT status, brief FROM social_project_growth_members
          WHERE batch_id = ? AND agent_id = ?
        `)
        .get(batchId, agentId);
      if (!existing) throw new Error('找不到该成员的成长任务。');
      if (['completed', 'no_change'].includes(existing.status)) {
        if (existing.status === status && existing.brief === normalizedBrief)
          return this.getProjectGrowthBatch(batchId);
        throw new Error('该成员的成长结果已提交，不能覆盖。');
      }
      if (existing.status !== 'running') {
        throw new Error('该成员的成长任务尚未运行或已结束。');
      }
      this.db
        .prepare(`
          UPDATE social_project_growth_members
          SET status = ?, brief = ?, error_code = NULL, error_message = NULL,
              updated_at = ?, completed_at = ?
          WHERE batch_id = ? AND agent_id = ? AND status = 'running'
        `)
        .run(status, normalizedBrief, now, now, batchId, agentId);
      const remaining = this.db
        .prepare(`
          SELECT 1 FROM social_project_growth_members
          WHERE batch_id = ? AND status NOT IN ('completed', 'no_change') LIMIT 1
        `)
        .get(batchId);
      if (!remaining) {
        this.db
          .prepare(`
            UPDATE social_project_growth_batches
            SET status = 'completed', updated_at = ?, completed_at = ?
            WHERE id = ? AND status = 'running'
          `)
          .run(now, now, batchId);
      }
      return this.getProjectGrowthBatch(batchId);
    })();
  }

  failProjectGrowthMember(batchId, agentId, { status, code, message }) {
    if (!['interrupted', 'failed'].includes(status)) {
      throw new TypeError('成员成长失败状态无效。');
    }
    const now = isoNow();
    const updated = this.db
      .prepare(`
        UPDATE social_project_growth_members
        SET status = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE batch_id = ? AND agent_id = ? AND status = 'running'
      `)
      .run(
        status,
        typeof code === 'string' ? code.slice(0, 100) : null,
        typeof message === 'string' ? message.slice(0, 500) : null,
        now,
        batchId,
        agentId,
      );
    if (updated.changes !== 1) throw new Error('该成员的成长任务状态已变化。');
    this.db
      .prepare(`
        UPDATE social_project_growth_batches SET updated_at = ?
        WHERE id = ? AND status = 'running'
      `)
      .run(now, batchId);
    return this.getProjectGrowthBatch(batchId);
  }

  retryProjectGrowthMember(batchId, agentId) {
    const existing = this.db
      .prepare(`
        SELECT turn_id AS turnId, status FROM social_project_growth_members
        WHERE batch_id = ? AND agent_id = ?
      `)
      .get(batchId, agentId);
    if (!existing) throw new Error('找不到该成员的成长任务。');
    if (!['interrupted', 'failed'].includes(existing.status)) {
      throw new Error('该成员的成长任务当前不能重试。');
    }
    if (
      existing.turnId &&
      this.db
        .prepare(`
          SELECT 1 FROM social_agent_asset_revisions
          WHERE agent_id = ? AND source_turn_id = ? LIMIT 1
        `)
        .get(agentId, existing.turnId)
    ) {
      throw new Error(
        '该轮已写入成员资产；为避免重复写入，请先核对资产修订再决定如何续接。',
      );
    }
    const now = isoNow();
    const updated = this.db
      .prepare(`
        UPDATE social_project_growth_members
        SET status = 'pending', turn_id = NULL, error_code = NULL,
            error_message = NULL, updated_at = ?, completed_at = NULL
        WHERE batch_id = ? AND agent_id = ? AND status IN ('interrupted', 'failed')
      `)
      .run(now, batchId, agentId);
    if (updated.changes !== 1)
      throw new Error('该成员的成长任务当前不能重试。');
    this.db
      .prepare(`
        UPDATE social_project_growth_batches
        SET status = 'running', completed_at = NULL, updated_at = ?
        WHERE id = ?
      `)
      .run(now, batchId);
    return this.getProjectGrowthBatch(batchId);
  }

  listRunningProjectGrowthBatches() {
    return this.db
      .prepare(`
        SELECT id FROM social_project_growth_batches
        WHERE status = 'running' ORDER BY created_at, id
      `)
      .all()
      .map(({ id }) => this.getProjectGrowthBatch(id));
  }

  listUnfinalizedCompletedProjectGrowthBatches() {
    return this.db
      .prepare(`
        SELECT id FROM social_project_growth_batches
        WHERE status = 'completed' AND finalized_at IS NULL
        ORDER BY completed_at, id
      `)
      .all()
      .map(({ id }) => this.getProjectGrowthBatch(id));
  }

  archiveCompletedProjectGrowthBatch(batchId) {
    requireText(batchId, '成长批次 ID', 200);
    return this.db.transaction(() => {
      const batch = this.db
        .prepare(`
          SELECT project_id AS projectId, status, finalized_at AS finalizedAt
          FROM social_project_growth_batches WHERE id = ?
        `)
        .get(batchId);
      if (!batch) throw new Error('找不到这个成长批次。');
      if (batch.status !== 'completed')
        throw new Error('成员经历整理尚未全部完成。');
      if (batch.finalizedAt) {
        return { project: this.getProject(batch.projectId), archived: false };
      }
      const project = this.getProject(batch.projectId);
      if (project.status === 'active') this.archiveProject(project.id);
      else if (project.status !== 'archived') {
        throw new Error('项目正在等待用户评审，不能完成归档。');
      }
      this.db
        .prepare(`
          UPDATE social_project_growth_batches SET finalized_at = ?, updated_at = ?
          WHERE id = ? AND finalized_at IS NULL
        `)
        .run(isoNow(), isoNow(), batchId);
      return {
        project: this.getProject(batch.projectId),
        archived: project.status !== 'archived',
      };
    })();
  }

  getPendingProjectGrowthBriefs(agentId, maxCharacters = 2_000) {
    requireText(agentId, '成员 ID', 200);
    if (!Number.isInteger(maxCharacters) || maxCharacters < 200) {
      throw new TypeError('成长简报上下文预算无效。');
    }
    const rows = this.db
      .prepare(`
        SELECT gm.batch_id AS batchId, gm.brief,
               p.title AS projectTitle, gm.completed_at AS completedAt
        FROM social_project_growth_members AS gm
        JOIN social_project_growth_batches AS b ON b.id = gm.batch_id
        JOIN social_projects AS p ON p.id = b.project_id
        WHERE gm.agent_id = ? AND gm.status IN ('completed', 'no_change')
          AND gm.resident_seen_at IS NULL
        ORDER BY gm.completed_at DESC, gm.batch_id DESC
      `)
      .all(agentId);
    const briefs = [];
    let characters = 0;
    for (const row of rows) {
      const brief = {
        batchId: row.batchId,
        projectTitle: row.projectTitle,
        completedAt: row.completedAt,
        text: row.brief.slice(0, 1_200),
      };
      const size = JSON.stringify(brief).length;
      if (characters + size > maxCharacters) break;
      briefs.push(brief);
      characters += size;
    }
    return briefs;
  }

  markProjectGrowthBriefsSeen(agentId, batchIds) {
    requireText(agentId, '成员 ID', 200);
    if (!Array.isArray(batchIds) || batchIds.length > 20) {
      throw new TypeError('成长简报列表无效。');
    }
    const ids = [...new Set(batchIds)].map((id) =>
      requireText(id, '成长批次 ID', 200),
    );
    if (!ids.length) return 0;
    const now = isoNow();
    return this.db
      .prepare(`
        UPDATE social_project_growth_members SET resident_seen_at = ?, updated_at = ?
        WHERE agent_id = ? AND batch_id IN (${ids.map(() => '?').join(', ')})
          AND status IN ('completed', 'no_change') AND resident_seen_at IS NULL
      `)
      .run(now, now, agentId, ...ids).changes;
  }

  recoverProjectGrowthMembers() {
    const interrupted = this.db
      .prepare(`
        SELECT gm.batch_id AS batchId, gm.agent_id AS agentId,
               gm.session_room_id AS sessionRoomId, gm.turn_id AS turnId,
               b.project_id AS projectId
        FROM social_project_growth_members AS gm
        JOIN social_project_growth_batches AS b ON b.id = gm.batch_id
        WHERE gm.status = 'running'
      `)
      .all();
    for (const member of interrupted) {
      if (!member.turnId) {
        this.db
          .prepare(`
            UPDATE social_project_growth_members SET status = 'pending', updated_at = ?
            WHERE batch_id = ? AND agent_id = ? AND status = 'running'
          `)
          .run(isoNow(), member.batchId, member.agentId);
        continue;
      }
      const assistant = this.socialChatStore.getTurnAssistantMessage(
        member.sessionRoomId,
        member.turnId,
        member.agentId,
      );
      if (assistant?.status === 'complete' && assistant.content.trim()) {
        const hasAssetChange = this.db
          .prepare(`
            SELECT 1 FROM social_agent_asset_revisions
            WHERE agent_id = ? AND source_project_id = ? AND source_turn_id = ?
            LIMIT 1
          `)
          .get(member.agentId, member.projectId, member.turnId);
        this.finishProjectGrowthMember(member.batchId, member.agentId, {
          status: hasAssetChange ? 'completed' : 'no_change',
          brief: assistant.content,
        });
      } else {
        const failed = assistant?.status === 'failed';
        this.failProjectGrowthMember(member.batchId, member.agentId, {
          status: failed ? 'failed' : 'interrupted',
          code: assistant?.errorCode ?? 'app_restarted',
          message: assistant?.errorMessage ?? '应用在成员成长回合完成前关闭。',
        });
      }
    }
    return interrupted.length;
  }

  getProjectSession(projectId, agentId) {
    requireText(projectId, '项目 ID', 200);
    requireText(agentId, '成员 ID', 200);
    const row = this.db
      .prepare(`
        SELECT p.id AS projectId, p.title, p.brief, p.status AS projectStatus,
               ps.agent_id AS agentId, ps.room_id AS sessionRoomId,
               ps.status AS membershipStatus
        FROM social_project_sessions AS ps
        JOIN social_projects AS p ON p.id = ps.project_id
        WHERE ps.project_id = ? AND ps.agent_id = ?
      `)
      .get(projectId, agentId);
    if (!row) throw new Error('这位成员没有加入该项目。');
    if (row.membershipStatus !== 'active') {
      throw new Error('这位成员已离开项目，不能继续使用原项目会话。');
    }
    if (row.projectStatus === 'archived') {
      throw new Error('项目已归档；恢复项目后才能打开成员会话。');
    }
    return {
      project: {
        id: row.projectId,
        title: row.title,
        brief: row.brief,
        status: row.projectStatus,
      },
      agentId: row.agentId,
      room: this.socialChatStore.getRoomSnapshot(row.sessionRoomId),
    };
  }

  getProjectSessionContext(roomId, agentId) {
    requireText(roomId, '聊天空间 ID', 200);
    requireText(agentId, '成员 ID', 200);
    const row = this.db
      .prepare(`
        SELECT p.id AS projectId, p.title, p.brief,
               p.source_message_id AS sourceMessageId,
               p.status AS projectStatus,
               p.group_room_id AS groupRoomId,
               ps.agent_id AS agentId, ps.room_id AS sessionRoomId,
               ps.status AS membershipStatus
        FROM social_project_sessions AS ps
        JOIN social_projects AS p ON p.id = ps.project_id
        WHERE ps.room_id = ? OR (p.group_room_id = ? AND ps.agent_id = ?)
      `)
      .get(roomId, roomId, agentId);
    if (!row) return null;
    if (row.agentId !== agentId) {
      throw new Error('这个项目会话只属于其指定成员。');
    }
    if (row.membershipStatus !== 'active') {
      throw new Error('成员已离开项目，不能继续使用原项目会话。');
    }
    if (row.projectStatus === 'archived') {
      throw new Error('项目已归档；恢复项目后才能继续发送。');
    }
    return {
      projectId: row.projectId,
      title: row.title,
      brief: row.brief,
      sourceMessageId: row.sourceMessageId,
      status: row.projectStatus,
      agentId: row.agentId,
      roomId: row.sessionRoomId,
      groupRoomId: row.groupRoomId,
    };
  }

  createProject({
    id = `project-${randomUUID()}`,
    title,
    brief,
    originRoomId = 'room-noema',
    sourceMessageId = null,
    agentIds,
  }) {
    const projectId = requireText(id, '项目 ID', 200);
    const normalizedTitle = requireText(title, '项目名称', 120);
    const normalizedBrief = requireText(brief, '项目说明', 40_000);
    requireText(originRoomId, '来源聊天 ID', 200);
    if (
      !Array.isArray(agentIds) ||
      agentIds.length < 2 ||
      agentIds.some((agentId) => typeof agentId !== 'string' || !agentId.trim())
    ) {
      throw new TypeError('项目需要 Noema 和至少一位专业成员。');
    }
    const uniqueAgentIds = [...new Set(agentIds.map((id) => id.trim()))];
    if (
      uniqueAgentIds.length !== agentIds.length ||
      !uniqueAgentIds.includes('noema')
    ) {
      throw new Error('项目成员必须包含一次 Noema，且不能重复。');
    }
    const origin = this.db
      .prepare(`
        SELECT r.id, r.kind, r.parent_room_id AS parentRoomId
        FROM social_rooms AS r
        JOIN social_room_members AS rm ON rm.room_id = r.id
        WHERE r.id = ? AND rm.agent_id = 'noema'
      `)
      .get(originRoomId);
    if (!origin || origin.kind !== 'direct' || origin.parentRoomId) {
      throw new Error('项目必须从 Noema 的连续主聊中创建。');
    }
    const normalizedSourceMessageId = sourceMessageId
      ? requireText(sourceMessageId, '来源消息 ID', 200)
      : null;
    if (normalizedSourceMessageId) {
      const source = this.db
        .prepare(`
          SELECT 1 FROM social_messages
          WHERE id = ? AND room_id = ? AND role = 'user'
        `)
        .get(normalizedSourceMessageId, originRoomId);
      if (!source) throw new Error('项目来源必须是 Noema 主聊中的用户消息。');
    }
    const agents = uniqueAgentIds.map((agentId) => {
      const agent = this.socialChatStore.getAgent(agentId);
      if (agent.archivedAt)
        throw new Error(`${agent.name}已归档，不能加入新项目。`);
      return agent;
    });
    if (
      agents.some(
        (agent) => agent.id !== 'noema' && agent.kind !== 'specialist',
      )
    ) {
      throw new Error('项目执行成员必须是专业成员。');
    }
    if (!agents.some((agent) => agent.id !== 'noema')) {
      throw new Error('项目需要至少一位专业成员。');
    }

    const now = isoNow();
    const groupRoomId = `room-${randomUUID()}`;
    const sessionRooms = agents
      .filter((agent) => agent.id !== 'noema')
      .map((agent) => ({ agent, roomId: `room-${randomUUID()}` }));
    this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO social_rooms (id, kind, title, created_at, updated_at)
          VALUES (?, 'group', ?, ?, ?)
        `)
        .run(groupRoomId, normalizedTitle, now, now);
      const insertGroupMember = this.db.prepare(`
        INSERT INTO social_room_members (room_id, agent_id, position)
        VALUES (?, ?, ?)
      `);
      uniqueAgentIds.forEach((agentId, position) =>
        insertGroupMember.run(groupRoomId, agentId, position),
      );
      this.db
        .prepare(`
          INSERT INTO social_projects
            (id, title, brief, origin_room_id, source_message_id,
             group_room_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          projectId,
          normalizedTitle,
          normalizedBrief,
          originRoomId,
          normalizedSourceMessageId,
          groupRoomId,
          now,
          now,
        );
      this.db
        .prepare(`
          INSERT INTO social_messages
            (id, room_id, turn_id, role, content, status, runtime, created_at, updated_at)
          VALUES (?, ?, ?, 'system', ?, 'complete', 'system', ?, ?)
        `)
        .run(
          randomUUID(),
          groupRoomId,
          randomUUID(),
          '项目已创建。群消息对成员共同可见；每位成员的实际工作在各自的项目会话中继续。',
          now,
          now,
        );

      const insertSessionRoom = this.db.prepare(`
        INSERT INTO social_rooms (id, kind, title, created_at, updated_at)
        VALUES (?, 'direct', ?, ?, ?)
      `);
      const insertSessionMember = this.db.prepare(`
        INSERT INTO social_room_members (room_id, agent_id, position)
        VALUES (?, ?, 0)
      `);
      const insertProjectSession = this.db.prepare(`
        INSERT INTO social_project_sessions
          (project_id, agent_id, room_id, joined_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const { agent, roomId } of sessionRooms) {
        insertSessionRoom.run(roomId, agent.name, now, now);
        insertSessionMember.run(roomId, agent.id);
        insertProjectSession.run(projectId, agent.id, roomId, now);
      }
    })();
    return this.getProject(projectId);
  }

  formProjectTeam({
    existingProjectId = null,
    title,
    brief,
    originRoomId = 'room-noema',
    sourceMessageId = null,
    members,
  }) {
    requireText(originRoomId, '来源聊天 ID', 200);
    if (!Array.isArray(members) || members.length < 2 || members.length > 6) {
      throw new TypeError('项目团队需要 2 至 6 位专业成员。');
    }
    const preparedMembers = members.map((member) => {
      if (!member || typeof member !== 'object') {
        throw new TypeError('项目成员说明无效。');
      }
      const task = requireText(member.task, '成员分工', 8_000);
      const hasAgentId = typeof member.agentId === 'string';
      const hasNewAgent =
        member.newAgent && typeof member.newAgent === 'object';
      if (hasAgentId === Boolean(hasNewAgent)) {
        throw new TypeError('每项分工必须选择现有成员或创建新成员。');
      }
      if (hasAgentId) {
        const agentId = requireText(member.agentId, '成员 ID', 200);
        const agent = this.socialChatStore.getAgent(agentId);
        if (
          agent.id === 'noema' ||
          agent.kind !== 'specialist' ||
          agent.archivedAt
        ) {
          throw new Error('项目只能选择未归档的专业成员。');
        }
        return { agentId, task };
      }
      const newAgent = {
        name: requireText(member.newAgent.name, '新成员名称', 60),
        headline: requireText(member.newAgent.headline, '新成员专业范围', 140),
        description: requireText(
          member.newAgent.description,
          '新成员合作方式',
          800,
        ),
        projectWork: member.newAgent.projectWork ?? false,
      };
      if (typeof newAgent.projectWork !== 'boolean') {
        throw new TypeError('新成员的项目工作能力必须是布尔值。');
      }
      return { newAgent, task };
    });
    const selectedIds = preparedMembers
      .filter((member) => member.agentId)
      .map((member) => member.agentId);
    if (new Set(selectedIds).size !== selectedIds.length) {
      throw new Error('项目团队不能重复加入同一联系人。');
    }
    const newNames = preparedMembers
      .filter((member) => member.newAgent)
      .map((member) => member.newAgent.name);
    if (
      new Set(newNames.map((name) => name.toLocaleLowerCase())).size !==
      newNames.length
    ) {
      throw new Error('新成员名称不能重复。');
    }
    for (const name of newNames) {
      if (
        this.db
          .prepare(
            'SELECT 1 FROM social_agents WHERE name = ? COLLATE NOCASE LIMIT 1',
          )
          .get(name)
      ) {
        throw new Error(`已有联系人使用名称「${name}」。`);
      }
    }

    return this.db.transaction(() => {
      const resolvedMembers = preparedMembers.map((member) => {
        if (member.agentId) return member;
        const room = this.socialChatStore.createAgent(member.newAgent);
        return {
          agentId: room.members[0].id,
          task: member.task,
        };
      });
      let project;
      if (existingProjectId) {
        const id = requireText(existingProjectId, '项目 ID', 200);
        project = this.getProject(id);
        if (project.originRoomId !== originRoomId) {
          throw new Error('只能续接来自当前 Noema 主聊的项目。');
        }
        if (project.status === 'archived') project = this.restoreProject(id);
        for (const member of resolvedMembers) {
          project = this.addProjectMember(id, member.agentId);
        }
      } else {
        const agentIds = [
          'noema',
          ...resolvedMembers.map((member) => member.agentId),
        ];
        project = this.createProject({
          title,
          brief,
          originRoomId,
          sourceMessageId,
          agentIds,
        });
      }
      return { project, members: resolvedMembers };
    })();
  }

  addProjectMember(projectId, agentId) {
    requireText(projectId, '项目 ID', 200);
    requireText(agentId, '成员 ID', 200);
    const project = this.getProject(projectId);
    if (project.status === 'archived')
      throw new Error('请先恢复项目，再添加成员。');
    const agent = this.socialChatStore.getAgent(agentId);
    if (agent.id === 'noema' || agent.kind !== 'specialist') {
      throw new Error('这里只能加入未归档的专业成员。');
    }
    if (agent.archivedAt)
      throw new Error(`${agent.name}已归档，不能加入项目。`);
    const existing = this.db
      .prepare(`
        SELECT room_id AS roomId, status FROM social_project_sessions
        WHERE project_id = ? AND agent_id = ?
      `)
      .get(projectId, agentId);
    const now = isoNow();
    const sessionRoomId = existing?.roomId ?? `room-${randomUUID()}`;
    this.db.transaction(() => {
      if (!existing) {
        this.db
          .prepare(`
            INSERT INTO social_rooms (id, kind, title, created_at, updated_at)
            VALUES (?, 'direct', ?, ?, ?)
          `)
          .run(sessionRoomId, agent.name, now, now);
        this.db
          .prepare(`
            INSERT INTO social_room_members (room_id, agent_id, position)
            VALUES (?, ?, 0)
          `)
          .run(sessionRoomId, agentId);
        this.db
          .prepare(`
            INSERT INTO social_project_sessions (project_id, agent_id, room_id, joined_at)
            VALUES (?, ?, ?, ?)
          `)
          .run(projectId, agentId, sessionRoomId, now);
      } else if (existing.status === 'removed') {
        this.db
          .prepare(`
            UPDATE social_project_sessions SET status = 'active', removed_at = NULL
            WHERE project_id = ? AND agent_id = ?
          `)
          .run(projectId, agentId);
      }
      this.db
        .prepare(`
          INSERT OR IGNORE INTO social_room_members (room_id, agent_id, position)
          VALUES (?, ?, ?)
        `)
        .run(project.groupRoomId, agentId, project.group.members.length);
      this.db
        .prepare('UPDATE social_projects SET updated_at = ? WHERE id = ?')
        .run(now, projectId);
    })();
    return this.getProject(projectId);
  }

  removeProjectMember(projectId, agentId) {
    requireText(projectId, '项目 ID', 200);
    requireText(agentId, '成员 ID', 200);
    if (agentId === 'noema')
      throw new Error('Noema 是项目协调者，不能从项目移除。');
    const project = this.getProject(projectId);
    if (project.status === 'archived')
      throw new Error('请先恢复项目，再调整成员。');
    const active = this.db
      .prepare(`
        SELECT 1
        FROM social_project_sessions AS ps
        WHERE ps.project_id = ? AND ps.agent_id = ? AND ps.status = 'active'
          AND (
            EXISTS (
              SELECT 1 FROM social_messages AS m
              WHERE m.room_id = ps.room_id AND m.status = 'streaming'
            ) OR EXISTS (
              SELECT 1 FROM social_work_tasks AS t
              WHERE t.room_id = ps.room_id
                AND t.status IN ('starting', 'running', 'verifying')
            )
          )
      `)
      .get(projectId, agentId);
    if (active) throw new Error('这位成员仍有工作在进行，结束或停止后再移除。');
    const now = isoNow();
    const result = this.db.transaction(() => {
      const removed = this.db
        .prepare(`
          UPDATE social_project_sessions SET status = 'removed', removed_at = ?
          WHERE project_id = ? AND agent_id = ? AND status = 'active'
        `)
        .run(now, projectId, agentId);
      if (removed.changes === 0) throw new Error('这位成员当前不在项目中。');
      this.db
        .prepare(`
          DELETE FROM social_room_members WHERE room_id = ? AND agent_id = ?
        `)
        .run(project.groupRoomId, agentId);
      this.db
        .prepare('UPDATE social_projects SET updated_at = ? WHERE id = ?')
        .run(now, projectId);
    });
    result();
    return this.getProject(projectId);
  }

  getReview(reviewId) {
    requireText(reviewId, '评审请求 ID', 200);
    const review = this.db
      .prepare(`
      SELECT r.id, r.project_id AS projectId, p.title AS projectTitle,
             r.room_id AS roomId, r.request_message_id AS requestMessageId,
             r.question, r.status, r.feedback, r.feedback_message_id AS feedbackMessageId,
             r.created_at AS createdAt, r.responded_at AS respondedAt
      FROM social_project_reviews AS r JOIN social_projects AS p ON p.id = r.project_id
      WHERE r.id = ?
    `)
      .get(reviewId);
    if (!review) throw new Error('找不到这条评审请求。');
    return review;
  }

  listReviewsForRoom(roomId) {
    requireText(roomId, '聊天 ID', 200);
    return this.db
      .prepare(
        'SELECT id FROM social_project_reviews WHERE room_id = ? ORDER BY created_at, id',
      )
      .all(roomId)
      .map(({ id }) => this.getReview(id));
  }

  requestReview({ projectId, messageId, question, completeMessage = true }) {
    const normalizedQuestion = requireText(question, '评审问题', 8_000);
    requireText(messageId, '评审消息 ID', 200);
    return this.db.transaction(() => {
      const project = this.getProject(projectId);
      const message = this.socialChatStore.getSocialMessage(messageId);
      if (
        !message ||
        message.role !== 'assistant' ||
        message.agentId !== 'noema' ||
        message.roomId !== project.originRoomId ||
        !['streaming', 'complete'].includes(message.status)
      ) {
        throw new Error('评审请求必须来自项目所属 Noema 主聊中的有效消息。');
      }
      const existing = this.db
        .prepare(
          'SELECT id FROM social_project_reviews WHERE request_message_id = ?',
        )
        .get(messageId);
      if (existing) {
        const review = this.getReview(existing.id);
        if (review.projectId !== projectId)
          throw new Error('这条消息已关联另一个项目的评审。');
        if (completeMessage && message.status === 'streaming')
          this.socialChatStore.completeReply(messageId);
        return review;
      }
      if (project.status === 'archived')
        throw new Error('请先恢复项目，再发起评审。');
      if (project.pendingReview)
        throw new Error('该项目已有待回复的评审请求。');
      const pendingReport = this.db
        .prepare(
          "SELECT 1 FROM social_project_reports WHERE project_id = ? AND status = 'pending' LIMIT 1",
        )
        .get(projectId);
      const readyForUserReview = this.plans
        .get(projectId)
        .phases.some((phase) => phase.state === 'awaiting_review');
      if (pendingReport && !readyForUserReview)
        throw new Error(
          '仍有项目成员报告待 Noema 处理，处理完后再请求用户评审。',
        );
      const active = this.db
        .prepare(`
        SELECT 1 FROM social_work_tasks WHERE status IN ('starting', 'running', 'verifying')
          AND (room_id = ? OR room_id IN (SELECT room_id FROM social_project_sessions WHERE project_id = ?)) LIMIT 1
      `)
        .get(project.groupRoomId, projectId);
      if (active)
        throw new Error('项目仍有执行在进行，请在阶段结束后发起评审。');
      const id = randomUUID();
      const now = isoNow();
      this.db
        .prepare(`INSERT INTO social_project_reviews
        (id, project_id, room_id, request_message_id, question, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          projectId,
          project.originRoomId,
          messageId,
          normalizedQuestion,
          now,
        );
      this.db
        .prepare(
          "UPDATE social_projects SET status = 'awaiting_user', updated_at = ? WHERE id = ?",
        )
        .run(now, projectId);
      if (completeMessage && message.status === 'streaming')
        this.socialChatStore.completeReply(messageId);
      return this.getReview(id);
    })();
  }

  submitReview({ reviewId, roomId, feedback, beginTurn }) {
    const normalizedFeedback = requireText(feedback, '评审反馈', 40_000);
    return this.db.transaction(() => {
      const review = this.getReview(reviewId);
      if (review.roomId !== roomId)
        throw new Error('请在对应 Noema 主聊中回复评审。');
      if (review.status !== 'pending')
        throw new Error('这条评审已经提交，请勿重复提交。');
      if (this.getProject(review.projectId).status !== 'awaiting_user')
        throw new Error('项目已不处于待评审状态，请刷新后检查。');
      const turn = beginTurn(review, normalizedFeedback);
      const now = isoNow();
      this.db
        .prepare(`UPDATE social_project_reviews SET status = 'answered', feedback = ?,
        feedback_message_id = ?, responded_at = ? WHERE id = ? AND status = 'pending'`)
        .run(normalizedFeedback, turn.userMessageId, now, reviewId);
      this.db
        .prepare(
          "UPDATE social_projects SET status = 'active', updated_at = ? WHERE id = ?",
        )
        .run(now, review.projectId);
      return { turn, review: this.getReview(reviewId) };
    })();
  }

  assertWorkAllowed(roomId) {
    const project = this.db
      .prepare(`
      SELECT p.id, p.status FROM social_projects AS p
      WHERE p.group_room_id = ? OR p.id IN (SELECT project_id FROM social_project_sessions WHERE room_id = ?)
    `)
      .get(roomId, roomId);
    if (project?.status === 'awaiting_user')
      throw new Error('项目正在等待用户评审，明确反馈后才能继续执行。');
    if (project?.status === 'archived')
      throw new Error('请先恢复项目，再继续执行。');
    if (
      project &&
      this.db
        .prepare(`
          SELECT 1 FROM social_project_growth_batches
          WHERE project_id = ? AND status = 'running' LIMIT 1
        `)
        .get(project.id)
    ) {
      throw new Error('项目成员正在整理经历；完成后再恢复项目交流。');
    }
  }

  setAwaitingUser(projectId, awaitingUser) {
    requireText(projectId, '项目 ID', 200);
    if (typeof awaitingUser !== 'boolean') {
      throw new TypeError('项目等待状态必须是布尔值。');
    }
    const project = this.getProject(projectId);
    if (!awaitingUser && project.pendingReview)
      throw new Error('请通过对应评审请求提交明确反馈。');
    if (project.status === 'archived')
      throw new Error('请先恢复项目，再修改项目状态。');
    this.db
      .prepare(`
        UPDATE social_projects SET status = ?, updated_at = ? WHERE id = ?
      `)
      .run(awaitingUser ? 'awaiting_user' : 'active', isoNow(), projectId);
    return this.getProject(projectId);
  }

  archiveProject(projectId) {
    requireText(projectId, '项目 ID', 200);
    const project = this.getProject(projectId);
    if (project.status === 'archived') return project;
    if (project.status === 'awaiting_user') {
      throw new Error('项目仍在等待用户反馈，不能归档。');
    }
    if (
      this.db
        .prepare(`
          SELECT 1 FROM social_project_growth_batches
          WHERE project_id = ? AND status = 'running' LIMIT 1
        `)
        .get(projectId)
    ) {
      throw new Error('成员经历整理尚未全部完成，不能归档。');
    }
    const active = this.db
      .prepare(`
        SELECT 1
        FROM social_project_sessions AS ps
        JOIN social_projects AS p ON p.id = ps.project_id
        WHERE p.id = ? AND (
          EXISTS (
            SELECT 1 FROM social_messages AS m
            WHERE m.room_id = ps.room_id AND m.status = 'streaming'
          ) OR EXISTS (
            SELECT 1 FROM social_work_tasks AS t
            WHERE t.room_id = ps.room_id
              AND t.status IN ('starting', 'running', 'verifying')
          )
        )
        UNION ALL
        SELECT 1
        FROM social_projects AS p
        WHERE p.id = ? AND (
          EXISTS (
            SELECT 1 FROM social_messages AS m
            WHERE m.room_id = p.group_room_id AND m.status = 'streaming'
          ) OR EXISTS (
            SELECT 1 FROM social_work_tasks AS t
            WHERE t.room_id = p.group_room_id
              AND t.status IN ('starting', 'running', 'verifying')
          )
        )
        LIMIT 1
      `)
      .get(projectId, projectId);
    if (active)
      throw new Error('项目仍有对话或执行在进行，结束或停止后才能归档。');
    const now = isoNow();
    this.db
      .prepare(`
        UPDATE social_projects SET status = 'archived', archived_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(now, now, projectId);
    return this.getProject(projectId);
  }

  restoreProject(projectId) {
    requireText(projectId, '项目 ID', 200);
    const project = this.getProject(projectId);
    if (project.status !== 'archived') return project;
    this.db
      .prepare(`
        UPDATE social_projects SET status = 'active', archived_at = NULL, updated_at = ?
        WHERE id = ?
      `)
      .run(isoNow(), projectId);
    return this.getProject(projectId);
  }
}
