import type { ChatRun } from './chat-run.ts';

type ProjectCollaborationStore =
  import('../projects/project-collaboration-store.mjs').ProjectCollaborationStore;
/** Plan item fields this module matches on (ProjectPlanStore.get().items). */
type PlanItem = { id: string; ownerAgentId: string | null; status: string };

/** Row selected by syncProjectWorkResults. */
type PendingWorkResult = {
  id: string;
  status: string;
  verificationStatus: string;
  planItemId: string | null;
  completedAt: string | null;
  updatedAt: string;
  projectId: string;
  memberName: string;
};

export class ProjectWorkResults {
  declare store: import('./social-chat-store.mjs').SocialChatStore;
  declare projectStore:
    | import('../projects/social-project-store.mjs').SocialProjectStore
    | null;
  /**
   * The untyped store declares `eventKey = null` etc., which TS infers as
   * `null`; publish accepts strings for them.
   */
  declare collaboration:
    | (Omit<ProjectCollaborationStore, 'publish'> & {
        publish: (input: {
          projectId: string;
          system: boolean;
          eventKey: string;
          triggerKind: string;
          planItemId: string | null;
          text: string;
        }) => ReturnType<ProjectCollaborationStore['publish']>;
      })
    | null;
  declare isShuttingDown: () => boolean;
  declare schedulePending: () => void;
  declare emit: (event: object) => void;

  constructor({
    store,
    projectStore,
    collaboration,
    isShuttingDown,
    schedulePending,
    emit,
  }: {
    store: ProjectWorkResults['store'];
    projectStore: ProjectWorkResults['projectStore'];
    collaboration: ProjectWorkResults['collaboration'];
    isShuttingDown: ProjectWorkResults['isShuttingDown'];
    schedulePending: ProjectWorkResults['schedulePending'];
    emit: ProjectWorkResults['emit'];
  }) {
    this.store = store;
    this.projectStore = projectStore;
    this.collaboration = collaboration;
    this.isShuttingDown = isShuttingDown;
    this.schedulePending = schedulePending;
    this.emit = emit;
  }

  trackProjectWorkResult(
    run: ChatRun,
    taskId: string,
    {
      projectId,
      executorAgentId,
      planItemId,
    }: {
      projectId?: string;
      executorAgentId?: string;
      planItemId?: string | null;
    } = {},
  ) {
    const resolvedProjectId = projectId ?? run.projectContext?.projectId;
    const resolvedAgentId = executorAgentId ?? run.agentId;
    if (!resolvedProjectId || !taskId || !this.projectStore) return;
    const projectSession = this.projectStore.getProjectSession(
      resolvedProjectId,
      resolvedAgentId,
    );
    const matchingItems = this.projectStore.plans
      .get(resolvedProjectId)
      .items.filter(
        (entry: PlanItem) =>
          entry.ownerAgentId === resolvedAgentId &&
          entry.status === 'in_progress' &&
          (!(planItemId ?? run.planItemId) ||
            entry.id === (planItemId ?? run.planItemId)),
      );
    const item = matchingItems.length === 1 ? matchingItems[0] : null;
    this.store.trackSocialWorkProjectResult({
      taskId,
      roomId: projectSession.room.room.id,
      agentId: resolvedAgentId,
      planItemId: item?.id ?? null,
    });
  }

  onProjectWorkUpdated(task: { id: string; status: string } | null) {
    if (this.isShuttingDown() || !task) return;
    if (!['completed', 'failed', 'interrupted'].includes(task.status)) return;
    if (task.status !== 'interrupted')
      this.store.markSocialWorkProjectResultPending(task.id);
    this.schedulePending();
  }

  syncProjectWorkResults() {
    if (!this.projectStore || !this.collaboration) return;
    this.store.clearInterruptedSocialWorkProjectResults();
    const pending = this.store.db
      .prepare(`SELECT t.id,t.status,t.verification_status AS verificationStatus,
        t.project_plan_item_id AS planItemId,t.completed_at AS completedAt,t.updated_at AS updatedAt,
        s.project_id AS projectId,a.name AS memberName
      FROM social_work_tasks t JOIN social_project_sessions s ON s.room_id=t.room_id AND s.agent_id=t.agent_id
      JOIN social_projects p ON p.id=s.project_id JOIN social_agents a ON a.id=s.agent_id
      WHERE t.project_result_pending=1 AND t.status IN ('completed','failed') AND p.status='active'
        AND s.status='active' AND a.archived_at IS NULL ORDER BY t.updated_at LIMIT 50`)
      .all() as PendingWorkResult[];
    for (const task of pending) {
      this.store.db.transaction(() => {
        const completed = task.status === 'completed';
        // Guarded non-null at the top of syncProjectWorkResults.
        const result = this.collaboration!.publish({
          projectId: task.projectId,
          system: true,
          eventKey: `work-result:${task.id}:${task.status}:${task.completedAt ?? task.updatedAt}`,
          triggerKind: completed ? 'work_result' : 'work_failure',
          planItemId: task.planItemId,
          text: completed
            ? `@Noema @${task.memberName} 项目执行任务 ${task.id} 已结束；文件条件核验状态：${task.verificationStatus}。${task.planItemId ? `关联工作包：${task.planItemId}。` : ''}请项目负责人核对计划状态；原成员在本项目会话中使用 manage_project_plan 读取实际结果：operation="read_sources", evidence_sources=[{"kind":"execution","taskId":"${task.id}"}], reason="核查执行结果"，核对后提交成果及 evidence_sources。任务结束本身不代表工作包通过验收。`
            : `@Noema 项目执行任务 ${task.id} 失败；文件条件核验状态：${task.verificationStatus}。${task.planItemId ? `关联工作包：${task.planItemId}。` : ''}在项目群聊中使用 manage_project_plan 读取实际结果：operation="read_sources", project_id="${task.projectId}", evidence_sources=[{"kind":"execution","taskId":"${task.id}"}], reason="核查执行结果"。请核查具体错误再协调，不能盲目自动重试或声称已完成。`,
        });
        this.store.clearSocialWorkProjectResultPending(task.id);
        if (!result.duplicate)
          this.emit({ type: 'chat-state-updated', roomId: result.roomId });
      })();
    }
  }
}
