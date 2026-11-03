/** Move each work package through the same submit/review state machine as the app. */
export function acceptAllProjectWorkItems(plans, projectId) {
  let plan = plans.get(projectId);
  const project = plans.db
    .prepare(
      'SELECT group_room_id AS groupRoomId FROM social_projects WHERE id = ?',
    )
    .get(projectId);
  for (const item of plan.items) {
    if (item.kind !== 'work_package' || item.status !== 'pending') continue;
    const messageId = `fixture-plan-evidence-${projectId}-${item.id}`;
    const now = new Date().toISOString();
    plans.db
      .prepare(`INSERT INTO social_messages
      (id,room_id,turn_id,role,agent_id,content,status,runtime,created_at,updated_at)
      VALUES (?,?,?,'assistant',?,?,'complete','local',?,?)`)
      .run(
        messageId,
        project.groupRoomId,
        messageId,
        item.ownerAgentId,
        '测试夹具提供了可核验的成果依据。',
        now,
        now,
      );
    const update = (status, actorAgentId, extra = {}) => {
      plan = plans.updateItem({
        projectId,
        expectedRevision: plan.revision,
        itemId: item.id,
        status,
        actorAgentId,
        reason: '测试夹具按真实提交与验收流程推进。',
        ...extra,
      });
    };
    update('in_progress', item.ownerAgentId);
    update('submitted', item.ownerAgentId, {
      evidence: '测试夹具提供了可核验的成果依据。',
      evidenceSources: [{ kind: 'message', messageId }],
    });
    update('done', 'noema');
  }
  return plan;
}
