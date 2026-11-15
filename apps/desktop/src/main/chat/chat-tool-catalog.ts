import {
  completeProjectTool,
  memberAssetsTool,
  personalMemoryTool,
  projectGroupTool,
  projectPlanTool,
  projectResearchTool,
  projectReviewTool,
  projectSourceReadTool,
  projectTeamTool,
  projectWorkTool,
  specialistDelegationTool,
  userFollowupTool,
  workTicketTool,
} from './model-tools.mjs';

/**
 * Converts Noema's existing function-call tools into MCP tool definitions.
 * Execution stays behind the supplied callback so the model never receives
 * filesystem, shell or database access directly.
 */
export function createChatToolDefinitions({
  agents = [],
  projects = [],
  projectWorkReady = false,
  projectSourceUrls = [],
  executeTool,
}: {
  agents?: any[];
  projects?: any[];
  projectWorkReady?: boolean;
  projectSourceUrls?: string[];
  executeTool?: (name: string, args: unknown) => unknown;
} = {}) {
  if (typeof executeTool !== 'function')
    throw new TypeError('executeTool must be a function.');

  const specs = [
    projectWorkTool(agents),
    workTicketTool(),
    specialistDelegationTool(),
    projectTeamTool({ projectWorkReady }),
    projectResearchTool(),
    personalMemoryTool(),
    userFollowupTool(),
    projectSourceReadTool(projectSourceUrls),
    projectReviewTool(projects),
    completeProjectTool(projects),
    memberAssetsTool(),
    projectPlanTool(projects),
    projectGroupTool(projects),
  ].filter((spec): spec is NonNullable<typeof spec> => Boolean(spec));

  return specs.map((spec) => ({
    name: spec.function.name,
    description: spec.function.description,
    inputSchema: spec.function.parameters,
    handler: (args: unknown) => executeTool(spec.function.name, args),
  }));
}
