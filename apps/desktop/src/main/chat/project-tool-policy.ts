import type { ChatRun } from './chat-run.ts';
import {
  CALCULATE_EXPRESSION_TOOL,
  needsCalculationTool,
} from '../tools/decimal-calculator.ts';
import {
  memberAssetsTool,
  projectGroupTool,
  projectPlanTool,
  projectResearchTool,
  projectSourceReadTool,
} from './model-tools.mjs';

export class ProjectToolPolicy {
  declare accessibleProjects: (run: ChatRun) => any[];
  declare canResearchPublicSources: (run: ChatRun) => boolean;
  declare authorizedProjectSourceUrls: (run: ChatRun) => string[];
  declare projectSourceReadBudget: (run: ChatRun) => any;

  constructor({
    accessibleProjects,
    canResearchPublicSources,
    authorizedProjectSourceUrls,
    projectSourceReadBudget,
  }: {
    accessibleProjects: ProjectToolPolicy['accessibleProjects'];
    canResearchPublicSources: ProjectToolPolicy['canResearchPublicSources'];
    authorizedProjectSourceUrls: ProjectToolPolicy['authorizedProjectSourceUrls'];
    projectSourceReadBudget: ProjectToolPolicy['projectSourceReadBudget'];
  }) {
    this.accessibleProjects = accessibleProjects;
    this.canResearchPublicSources = canResearchPublicSources;
    this.authorizedProjectSourceUrls = authorizedProjectSourceUrls;
    this.projectSourceReadBudget = projectSourceReadBudget;
  }

  projectTools(run: ChatRun) {
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

  projectGrowthTools(run: ChatRun) {
    if (!run.isProjectGrowthTurn || !run.projectGrowthBatchId) return [];
    return [memberAssetsTool()];
  }
}
