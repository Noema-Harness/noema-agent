import { randomUUID } from 'node:crypto';

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
    return {
      ...project,
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
        SELECT p.id AS projectId, p.title, p.brief, p.status AS projectStatus,
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
      status: row.projectStatus,
      agentId: row.agentId,
      roomId: row.sessionRoomId,
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

  requestReview({ projectId, messageId, question }) {
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
        if (message.status === 'streaming')
          this.socialChatStore.completeReply(messageId);
        return review;
      }
      if (project.status === 'archived')
        throw new Error('请先恢复项目，再发起评审。');
      if (project.pendingReview)
        throw new Error('该项目已有待回复的评审请求。');
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
      if (message.status === 'streaming')
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
      SELECT p.status FROM social_projects AS p
      WHERE p.group_room_id = ? OR p.id IN (SELECT project_id FROM social_project_sessions WHERE room_id = ?)
    `)
      .get(roomId, roomId);
    if (project?.status === 'awaiting_user')
      throw new Error('项目正在等待用户评审，明确反馈后才能继续执行。');
    if (project?.status === 'archived')
      throw new Error('请先恢复项目，再继续执行。');
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
