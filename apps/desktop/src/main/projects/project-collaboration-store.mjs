import { randomUUID } from 'node:crypto';
import { resolveGroupRecipients } from '../../shared/chat/group-mentions.mjs';
import { parseProjectPlanRevision } from './project-plan-store.mjs';
import { projectGroupPublicText } from '../../shared/chat/project-group-public-text.mjs';

const MAX_CHAIN_DISPATCHES = 24;
const MAX_CHAIN_DEPTH = 8;

/** Public records and durable recipient queues, without model calls on receipt. */
export class ProjectCollaborationStore {
  constructor({ db, social, projects }) {
    this.db = db;
    this.social = social;
    this.projects = projects;
  }

  publish({
    projectId,
    senderAgentId = null,
    text,
    eventKey = null,
    rootId = null,
    depth = 0,
    triggerKind = null,
    planItemId = null,
    planSubmissionRevision = null,
    replyTo = null,
    system = false,
  }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 16_000)
      throw new Error('群消息不能为空，且不得超过 16000 个字符。');
    if (senderAgentId && !system) {
      text = projectGroupPublicText(text);
      if (!text) throw new Error('没有可发送的公开内容。');
    }
    return this.db.transaction(() => {
      const project = this.projects.getProject(projectId);
      this.projects.assertWorkAllowed(project.groupRoomId);
      const members = this.social.getRoomSnapshot(project.groupRoomId).members;
      if (
        senderAgentId &&
        !members.some((m) => m.id === senderAgentId && !m.archivedAt)
      )
        throw new Error('发送者不是项目的活跃成员。');
      if (eventKey) {
        const previous = this.db
          .prepare(
            'SELECT message_id AS messageId FROM social_project_publications WHERE event_key=? AND project_id=?',
          )
          .get(eventKey, projectId);
        if (previous) return { ...previous, duplicate: true, queued: true };
      }
      const route = resolveGroupRecipients(text, members, {
        allowEveryone: !senderAgentId || senderAgentId === 'noema',
      });
      if (route.error) throw new Error(route.error);
      const messageId = randomUUID(),
        turnId = randomUUID(),
        now = new Date().toISOString();
      this.db
        .prepare(`INSERT INTO social_messages
        (id, room_id, turn_id, role, agent_id, sender_agent_id, content, status, runtime, reply_to_message_id, reply_to_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'complete', 'local', ?, ?, ?, ?)`)
        .run(
          messageId,
          project.groupRoomId,
          turnId,
          system ? 'system' : senderAgentId ? 'assistant' : 'user',
          senderAgentId,
          null,
          text.trim(),
          replyTo?.id ?? null,
          JSON.stringify(replyTo),
          now,
          now,
        );
      this.db
        .prepare('UPDATE social_rooms SET updated_at=? WHERE id=?')
        .run(now, project.groupRoomId);
      if (eventKey)
        this.db
          .prepare(
            'INSERT INTO social_project_publications(event_key,project_id,message_id) VALUES(?,?,?)',
          )
          .run(eventKey, projectId, messageId);
      const delivery = this.route({
        project,
        messageId,
        senderAgentId,
        route,
        rootId: rootId ?? messageId,
        depth,
        triggerKind,
        planItemId,
        planSubmissionRevision,
      });
      return {
        projectId,
        roomId: project.groupRoomId,
        messageId,
        turnId,
        queued: delivery.delivered > 0,
        ...delivery,
      };
    })();
  }

  route({
    project,
    messageId,
    senderAgentId,
    route = null,
    rootId = messageId,
    depth = 0,
    triggerKind = null,
    planItemId = null,
    planSubmissionRevision = null,
  }) {
    const message = this.social.getSocialMessage(messageId);
    if (
      !message ||
      message.status !== 'complete' ||
      message.roomId !== project.groupRoomId
    )
      throw new Error('只能投递本项目已保存的完整公开消息。');
    const members = this.social.getRoomSnapshot(project.groupRoomId).members;
    route ??= resolveGroupRecipients(message.content, members, {
      allowEveryone: !senderAgentId || senderAgentId === 'noema',
    });
    if (route.error) throw new Error(route.error);
    const targets = route.agents.filter(
      (m) => m.id !== senderAgentId && !m.archivedAt,
    );
    const now = new Date().toISOString();
    let delivered = 0,
      limited = false;
    for (const target of targets) {
      if (
        this.db
          .prepare(
            'SELECT 1 FROM social_project_dispatch_log WHERE source_message_id=? AND agent_id=?',
          )
          .get(messageId, target.id)
      )
        continue;
      const count = this.db
        .prepare(
          'SELECT COUNT(*) AS n FROM social_project_dispatch_log WHERE root_id=?',
        )
        .get(rootId).n;
      if (depth >= MAX_CHAIN_DEPTH || count >= MAX_CHAIN_DISPATCHES) {
        limited = true;
        continue;
      }
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO social_project_dispatch_log(id,project_id,source_message_id,agent_id,root_id,depth,trigger_kind,plan_item_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          project.id,
          messageId,
          target.id,
          rootId,
          depth,
          triggerKind ?? (route.everyone ? 'broadcast' : 'mention'),
          planItemId,
          now,
        );
      if (target.id === 'noema') {
        this.db
          .prepare(`INSERT OR IGNORE INTO social_project_reports
          (id, project_id, source_turn_id, source_user_message_id, source_group_assistant_message_id, agent_id, group_room_id, session_room_id, status, created_at, updated_at)
          VALUES(?,?,?,?,?,?,?,?,'pending',?,?)`)
          .run(
            id,
            project.id,
            id,
            messageId,
            messageId,
            senderAgentId ?? 'noema',
            project.groupRoomId,
            project.members.find((m) => m.agentId === senderAgentId)
              ?.sessionRoomId ?? project.groupRoomId,
            now,
            now,
          );
      } else {
        const session = this.projects.getProjectSession(project.id, target.id);
        this.db
          .prepare(`INSERT INTO social_project_group_inbox
          (turn_id,project_id,group_room_id,agent_id,session_room_id,group_user_message_id,queued_at,root_id,depth,trigger_kind,plan_item_id,plan_submission_revision)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(
            id,
            project.id,
            project.groupRoomId,
            target.id,
            session.room.room.id,
            messageId,
            now,
            rootId,
            depth,
            triggerKind ?? (route.everyone ? 'broadcast' : 'mention'),
            planItemId,
            planSubmissionRevision,
          );
      }
      delivered++;
    }
    if (limited) {
      const key = `limit:${rootId}`;
      if (
        !this.db
          .prepare(
            'SELECT 1 FROM social_project_publications WHERE event_key=?',
          )
          .get(key)
      ) {
        const id = randomUUID();
        this.db
          .prepare(
            `INSERT INTO social_messages(id,room_id,turn_id,role,content,status,runtime,created_at,updated_at) VALUES(?,?,?,'system',?,'complete','system',?,?)`,
          )
          .run(
            id,
            project.groupRoomId,
            id,
            '本轮自动协作已达到调用上限，新增交接暂未投递；已有成果保留。请明确继续或调整计划。',
            now,
            now,
          );
        this.db
          .prepare(
            'INSERT INTO social_project_publications(event_key,project_id,message_id) VALUES(?,?,?)',
          )
          .run(key, project.id, id);
      }
    }
    return { delivered, limited };
  }

  observeReply(run) {
    if (!run.projectContext || run.projectContext.groupRoomId !== run.roomId)
      return;
    const message = this.social.getSocialMessage(run.assistantMessageId);
    if (message?.status !== 'complete') return;
    const project = this.projects.getProject(run.projectContext.projectId);
    if (project.status !== 'active') return;
    return this.db.transaction(() =>
      this.route({
        project,
        messageId: message.id,
        senderAgentId: run.agentId,
        rootId: run.rootId ?? run.userMessageId,
        depth: (run.depth ?? 0) + 1,
      }),
    )();
  }

  planChanged(projectId, { rootId = null, depth = 0 } = {}) {
    const project = this.projects.getProject(projectId);
    if (project.status !== 'active') return;
    const plan = this.projects.plans.get(projectId);
    if (!plan.revision) return;
    const revisions = this.db
      .prepare(
        'SELECT revision, stage, objective, items_json FROM social_project_plan_revisions WHERE project_id=? ORDER BY revision DESC',
      )
      .all(projectId);
    const previous = revisions[1]
      ? parseProjectPlanRevision(revisions[1])
      : { objective: '', phases: [] };
    const previousItems = previous.phases.flatMap((phase) => phase.workItems);
    return this.db.transaction(() => {
      const scope = (snapshot) => ({
        objective: snapshot.objective,
        phases: snapshot.phases.map(
          ({
            id,
            title,
            outcome,
            exitCriteria,
            dependsOn,
            status,
            workItems,
          }) => ({
            id,
            title,
            outcome,
            exitCriteria,
            dependsOn,
            status,
            workItems: workItems.map(
              ({ id, title, ownerAgentId, acceptance, dependsOn }) => ({
                id,
                title,
                ownerAgentId,
                acceptance,
                dependsOn,
              }),
            ),
          }),
        ),
      });
      if (
        !revisions[1] ||
        JSON.stringify(scope(previous)) !== JSON.stringify(scope(plan))
      )
        this.publish({
          projectId,
          system: true,
          eventKey: `plan:${projectId}:${plan.revision}`,
          text: `项目目标：${plan.objective}\n${plan.phases.length} 个阶段、${plan.items.length} 项团队工作，阶段成果、退出条件、责任和依赖见共享计划。${plan.reason}`,
          rootId,
          depth,
        });
      for (const item of plan.items) {
        const old = previousItems.find((entry) => entry.id === item.id);
        if (item.ready) {
          let token = plan.revision;
          for (const row of revisions) {
            const prior = parseProjectPlanRevision(row)
              .phases.flatMap((phase) => phase.workItems)
              .find((entry) => entry.id === item.id);
            if (prior?.status !== 'pending') break;
            token = row.revision;
          }
          const member = project.members.find(
            (m) => m.agentId === item.ownerAgentId,
          );
          if (member)
            this.publish({
              projectId,
              system: true,
              eventKey: `ready:${projectId}:${item.id}:${item.ownerAgentId}:${token}`,
              text: `@${member.name} 「${item.phaseTitle}」阶段的工作项「${item.title}」已具备开始条件。请先读取最新计划，核对阶段成果、退出条件、职责和完成条件再推进；有问题可公开求助。`,
              rootId,
              depth,
              triggerKind: 'plan_ready',
              planItemId: item.id,
            });
        }
        if (
          ['submitted', 'blocked'].includes(item.status) &&
          (old?.status !== item.status ||
            old?.evidence !== item.evidence ||
            old?.blocker !== item.blocker)
        ) {
          this.publish({
            projectId,
            system: true,
            eventKey: `checkpoint:${projectId}:${plan.revision}:${item.id}`,
            text: `@Noema 「${item.title}」${item.status === 'submitted' ? '已提交，等待依据完成条件核验' : '受阻'}。\n${item.status === 'submitted' ? item.evidence : item.blocker}\n这不表示已经验收。`,
            rootId,
            depth,
            triggerKind: 'checkpoint',
          });
        }
        if (
          item.status === 'submitted' &&
          item.submissionRevision &&
          item.submissionRevision !== old?.submissionRevision
        ) {
          const reviewers = item.reviewerIds
            .filter((id) => !['user', 'noema'].includes(id))
            .map((id) =>
              project.members.find(
                (member) =>
                  member.agentId === id &&
                  member.status === 'active' &&
                  !member.agentArchivedAt,
              ),
            )
            .filter(Boolean);
          if (reviewers.length)
            this.publish({
              projectId,
              system: true,
              eventKey: `review:${projectId}:${item.id}:${item.submissionRevision}`,
              text: `${reviewers.map((member) => `@${member.name}`).join(' ')} 「${item.phaseTitle}」的工作项「${item.title}」（${item.id}）已提交，提交版本 ${item.submissionRevision}。请核对完成条件和来源，并在计划中记录本轮核验意见；要求修改时须说明理由。`,
              rootId,
              depth,
              triggerKind: 'plan_review',
              planItemId: item.id,
              planSubmissionRevision: item.submissionRevision,
            });
        }
      }
      for (const phase of plan.phases) {
        const old = previous.phases.find((entry) => entry.id === phase.id);
        if (phase.status === 'done' && old?.status !== 'done')
          this.publish({
            projectId,
            system: true,
            eventKey: `phase:${projectId}:${plan.revision}:${phase.id}`,
            text: `@Noema 阶段「${phase.title}」已完成验收。阶段成果：${phase.outcome}\n退出依据：${phase.evidence}\n请核对后续阶段是否具备开始条件，或是否需要用户判断。`,
            rootId,
            depth,
            triggerKind: 'checkpoint',
          });
      }
    })();
  }

  notifyUnread(run) {
    if (!run.projectContext || run.agentId === 'noema') return;
    const project = this.projects.getProject(run.projectContext.projectId);
    if (project.status !== 'active') return;
    if (
      this.db
        .prepare(
          'SELECT 1 FROM social_project_group_inbox WHERE project_id=? AND agent_id=? LIMIT 1',
        )
        .get(project.id, run.agentId)
    )
      return;
    const cursor =
      this.db
        .prepare(
          'SELECT last_seq AS seq FROM social_project_read_cursors WHERE project_id=? AND agent_id=?',
        )
        .get(project.id, run.agentId)?.seq ?? 0;
    const rows = this.db
      .prepare(
        `SELECT id,seq FROM social_messages WHERE room_id=? AND seq>? AND status='complete' AND role IN ('user','assistant') AND COALESCE(agent_id,sender_agent_id,'')<>? ORDER BY seq DESC LIMIT 30`,
      )
      .all(project.groupRoomId, cursor, run.agentId);
    if (!rows.length) return;
    const member = this.social.getAgent(run.agentId);
    return this.db.transaction(() =>
      this.route({
        project,
        messageId: rows[0].id,
        senderAgentId: null,
        route: { agents: [member], everyone: false, error: null },
        rootId: run.rootId ?? run.turnId,
        depth: (run.depth ?? 0) + 1,
        triggerKind: 'unread',
      }),
    )();
  }

  prepareDelivery(pending) {
    if (pending.triggerKind === 'plan_review') {
      const item = this.projects.plans
        .get(pending.projectId)
        .items.find((item) => item.id === pending.planItemId);
      const reviews = [
        ...(item?.evidenceReviews ?? []),
        ...(item?.evidenceReview ? [item.evidenceReview] : []),
      ];
      const reviewer = reviews.some(
        (review) =>
          review.actorId === pending.agentId &&
          review.submissionRevision === pending.planSubmissionRevision,
      );
      const member = this.projects
        .getProject(pending.projectId)
        .members.find((member) => member.agentId === pending.agentId);
      if (
        !item ||
        item.status !== 'submitted' ||
        !pending.planSubmissionRevision ||
        item.submissionRevision !== pending.planSubmissionRevision ||
        !item.reviewerIds.includes(pending.agentId) ||
        member?.status !== 'active' ||
        member.agentArchivedAt ||
        reviewer
      ) {
        this.db
          .prepare('DELETE FROM social_project_group_inbox WHERE turn_id=?')
          .run(pending.turnId);
        return false;
      }
      return true;
    }
    if (!pending.planItemId) return true;
    const plan = this.projects.plans.get(pending.projectId);
    const item = plan.items.find((item) => item.id === pending.planItemId);
    if (
      !item ||
      item.ownerAgentId !== pending.agentId ||
      !['pending', 'in_progress'].includes(item.status) ||
      (item.status === 'pending' && !item.ready)
    ) {
      this.db
        .prepare('DELETE FROM social_project_group_inbox WHERE turn_id=?')
        .run(pending.turnId);
      return false;
    }
    if (item.status === 'pending')
      this.projects.plans.updateItem({
        projectId: pending.projectId,
        expectedRevision: plan.revision,
        itemId: item.id,
        status: 'in_progress',
        actorAgentId: pending.agentId,
        sourceTurnId: pending.turnId,
        reason: '责任成员已领取本项就绪工作；尚未表示完成。',
      });
    return true;
  }

  finalizeDelivery(run) {
    if (!run.planItemId || !run.projectContext) return false;
    const project = this.projects.getProject(run.projectContext.projectId);
    if (project.status !== 'active') return false;
    const item = this.projects.plans
      .get(project.id)
      .items.find((item) => item.id === run.planItemId);
    if (item?.status !== 'in_progress' || item.ownerAgentId !== run.agentId)
      return false;
    const agent = this.social.getAgent(run.agentId);
    return (
      this.publish({
        projectId: project.id,
        system: true,
        text:
          run.triggerKind === 'finalize'
            ? `@Noema ${agent.name} 已完成一次状态补交提醒，但「${item.title}」仍在进行中，不能视作已提交或验收。请核对已有成果与实际计划，协调明确下一步。`
            : `@${agent.name} 本轮已结束，但「${item.title}」仍在进行中。请调用计划工具提交简短成果依据与公开消息引用，或记录具体阻塞；自然语言说“已提交”不会改变计划。`,
        eventKey: `finalize:${run.turnId}`,
        rootId: run.rootId ?? run.turnId,
        depth: (run.depth ?? 0) + 1,
        triggerKind: 'finalize',
        planItemId: item.id,
      }).delivered > 0
    );
  }
}
