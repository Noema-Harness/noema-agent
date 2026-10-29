/** Move each work package through the same submit/review state machine as the app. */
export function acceptAllProjectWorkItems(plans, projectId) {
  let plan = plans.get(projectId);
  for (const item of plan.items) {
    if (item.kind !== 'work_package' || item.status !== 'pending') continue;
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
    });
    update('done', 'noema');
  }
  return plan;
}
