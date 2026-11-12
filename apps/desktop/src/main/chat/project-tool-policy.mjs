import {
  CALCULATE_EXPRESSION_TOOL,
  needsCalculationTool,
} from '../tools/decimal-calculator.mjs';
import {
  memberAssetsTool,
  projectGroupTool,
  projectPlanTool,
  projectResearchTool,
  projectSourceReadTool,
} from './model-tools.mjs';

export class ProjectToolPolicy {
  constructor({
    accessibleProjects,
    canResearchPublicSources,
    authorizedProjectSourceUrls,
    projectSourceReadBudget,
  }) {
    this.accessibleProjects = accessibleProjects;
    this.canResearchPublicSources = canResearchPublicSources;
    this.authorizedProjectSourceUrls = authorizedProjectSourceUrls;
    this.projectSourceReadBudget = projectSourceReadBudget;
  }

  projectTools(run) {
    const projects = this.accessibleProjects(run).filter(
      (project) => project.status !== 'awaiting_user',
    );
    return [
      ...(this.canResearchPublicSources(run) ? [projectResearchTool()] : []),
      ...(this.projectSourceReadBudget(run) > 0
        ? [
            projectSourceReadTool(
              this.authorizedProjectSourceUrls(run)
                .filter((url) => !run.projectResearchAttemptedUrls?.has(url))
                .slice(0, this.projectSourceReadBudget(run)),
            ),
          ]
        : []),
      ...(run.projectContext ||
      projects.some((project) => project.groupRoomId === run.roomId) ||
      (run.agentId === 'noema' && needsCalculationTool(run.text))
        ? [CALCULATE_EXPRESSION_TOOL]
        : []),
      projectPlanTool(projects, {
        coordinator: run.agentId === 'noema',
        projectBound: Boolean(run.projectContext),
      }),
      projectGroupTool(projects),
    ].filter(Boolean);
  }

  projectGrowthTools(run) {
    if (!run.isProjectGrowthTurn || !run.projectGrowthBatchId) return [];
    return [memberAssetsTool()];
  }
}
