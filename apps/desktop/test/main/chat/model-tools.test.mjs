import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeProjectTool,
  projectGroupTool,
  projectPlanTool,
  projectReviewTool,
  projectSourceReadTool,
  projectTeamTool,
  projectToolChoicesContext,
  projectWorkTool,
  specialistDelegationTool,
  personalMemoryTool,
  shouldExposePersonalMemoryTool,
} from '../../../src/main/chat/model-tools.mjs';

function fixture(suffix) {
  const agent = {
    id: `agent-${suffix}`,
    name: `Researcher ${suffix}`,
    headline: `Research scope ${suffix}`,
    kind: 'specialist',
    status: 'active',
    capabilities: ['project-work'],
  };
  const project = {
    id: `project-${suffix}`,
    title: `Project ${suffix}`,
    status: 'active',
    members: [
      {
        ...agent,
        agentId: agent.id,
        agentArchivedAt: null,
      },
    ],
  };
  const planItem = {
    id: `item-${suffix}`,
    projectId: project.id,
    title: `Work ${suffix}`,
    ownerAgentId: agent.id,
  };
  return { agent, project, planItem };
}

function toolSchemas(data) {
  return [
    projectWorkTool([data.agent]),
    specialistDelegationTool(),
    projectTeamTool({ projectWorkReady: true }),
    projectSourceReadTool([`https://example.com/${data.project.id}`]),
    projectReviewTool([data.project]),
    completeProjectTool([data.project]),
    projectPlanTool([data.project]),
    projectGroupTool([data.project]),
  ].map((tool) => tool.function);
}

test('project tool schemas stay stable when project, member, work-item, and URL values change', () => {
  assert.deepEqual(toolSchemas(fixture('one')), toolSchemas(fixture('two')));
});

test('personal memory tool is explicit, small, and only exposed for memory-relevant turns', () => {
  const tool = personalMemoryTool().function;
  assert.equal(tool.name, 'manage_personal_memory');
  assert.deepEqual(tool.parameters.properties.operation.enum, [
    'search',
    'save',
    'update',
    'forget',
  ]);
  assert.equal(
    shouldExposePersonalMemoryTool('帮我记住我通常先看结论。'),
    true,
  );
  assert.equal(
    shouldExposePersonalMemoryTool('你还记得我之前说过的偏好吗？'),
    true,
  );
  assert.equal(shouldExposePersonalMemoryTool('帮我解释一下 FTS5。'), false);
});

test('specialist project-plan schema omits coordinator-only structure controls', () => {
  const specialistTool = projectPlanTool([fixture('member').project], {
    coordinator: false,
    projectBound: true,
  });
  const { parameters, description } = specialistTool.function;
  const serializedLength = JSON.stringify(specialistTool).length;

  assert.deepEqual(parameters.properties.operation.enum, [
    'read',
    'history',
    'inspect_evidence',
    'read_sources',
    'update_item',
  ]);
  assert.equal('project_id' in parameters.properties, false);
  assert.equal('plan' in parameters.properties, false);
  assert.equal('item_patch' in parameters.properties, false);
  assert.equal('phase_status' in parameters.properties, false);
  assert.match(description, /only your assigned work package/u);
  assert.ok(serializedLength < JSON.stringify(projectPlanTool([{}])).length);
});

test('coordinator project-bound schema keeps plan controls without redundant project ID', () => {
  const coordinatorTool = projectPlanTool([fixture('lead').project], {
    coordinator: true,
    projectBound: true,
  });
  const { parameters } = coordinatorTool.function;

  assert.ok(parameters.properties.operation.enum.includes('replace'));
  assert.ok(parameters.properties.plan);
  assert.equal('project_id' in parameters.properties, false);
});

test('request context carries current selectable IDs and source URLs outside tool schemas', () => {
  const { agent, project, planItem } = fixture('live');
  const sourceUrl = 'https://example.com/current-pricing';
  const context = projectToolChoicesContext({
    agents: [agent],
    projects: [project],
    planItems: [planItem],
    sourceUrls: [sourceUrl],
  });

  for (const value of [agent.id, project.id, planItem.id, sourceUrl]) {
    assert.ok(context.includes(value));
  }
  assert.match(context, /运行时仍会验证权限与状态/u);
});
