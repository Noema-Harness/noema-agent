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
