import {
  projectTeamApprovalTool,
  projectTeamProposalTool,
} from './model-tools.mjs';

/**
 * Exposes project-team proposal/approval to the DSH runtime as MCP tools.
 * DSH cannot receive dynamic action tools, so these callbacks are the only
 * path for the main chat to create or decide a team proposal.
 *
 * @param {{
 *   propose: (input: object) => Promise<object> | object,
 *   decide: (input: object) => Promise<object> | object,
 * }} options
 */
export function createProjectTeamTools({ propose, decide }) {
  const proposal = projectTeamProposalTool({
    projectWorkReady: true,
  }).function;
  const approval = projectTeamApprovalTool().function;
  return [
    {
      name: proposal.name,
      description: `${proposal.description}\n\n当一项工作确实需要两个以上不同专业角色共同交付时，先调用本工具保存待确认方案；不要先开始单个执行者任务。`,
      inputSchema: proposal.parameters,
      async handler(input) {
        return propose(input ?? {});
      },
    },
    {
      name: approval.name,
      description: approval.description,
      inputSchema: approval.parameters,
      async handler(input) {
        return decide(input ?? {});
      },
    },
  ];
}
