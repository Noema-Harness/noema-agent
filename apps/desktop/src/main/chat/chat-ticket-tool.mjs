import { workTicketTool } from './model-tools.mjs';

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/**
 * Adapts the existing start_work_ticket contract to an MCP tool. The callback
 * is the production ticket owner; this module only validates and normalizes.
 * @param {{
 *   startTicket: (input: {
 *     prompt: string;
 *     workspacePath?: string | null;
 *     sessionId?: string | null;
 *     agentId?: string;
 *   }) => Promise<{ accepted?: boolean; reason?: string | null }>,
 *   resolveAssignee?: ((name: string) => string | null) | null,
 *   availableAssignees?: string[],
 * }} options
 */
export function createChatTicketTool({
  startTicket,
  resolveAssignee = null,
  availableAssignees = [],
}) {
  if (typeof startTicket !== 'function') {
    throw new TypeError('chat ticket tool requires startTicket');
  }
  const spec = workTicketTool().function;
  const assigneeNames = Array.from(
    new Set(
      (Array.isArray(availableAssignees) ? availableAssignees : [])
        .map((name) => (typeof name === 'string' ? name.trim() : ''))
        .filter(Boolean),
    ),
  );
  const assigneeHint =
    assigneeNames.length > 0
      ? `可用成员：${assigneeNames.join('、')}。`
      : '当前没有可承接任务的成员。';
  return {
    name: spec.name,
    description: `${spec.description}\n\n必须先指定承接成员。${assigneeHint}`,
    inputSchema: {
      ...spec.parameters,
      required: ['task', 'assignee'],
    },
    async handler(input) {
      const task = typeof input?.task === 'string' ? input.task.trim() : '';
      if (!task || task.length > 40_000) {
        throw new Error('工作内容无效；没有启动任务。');
      }
      const sessionId =
        typeof input?.session_id === 'string' && input.session_id.trim()
          ? input.session_id.trim()
          : null;
      const workspacePath =
        typeof input?.workspace_path === 'string' && input.workspace_path.trim()
          ? input.workspace_path.trim()
          : null;
      if (sessionId && !SESSION_ID_PATTERN.test(sessionId)) {
        throw new Error('会话标识无效；没有启动任务。');
      }
      if (sessionId && !workspacePath) {
        throw new Error('继续已有会话需要工作文件夹；没有启动任务。');
      }
      const assignee =
        typeof input?.assignee === 'string' ? input.assignee.trim() : '';
      if (!assignee) {
        throw new Error(`请指定承接成员；没有启动任务。${assigneeHint}`);
      }
      if (typeof resolveAssignee !== 'function') {
        throw new Error('无法确认承接成员；没有启动任务。');
      }
      const agentId = resolveAssignee(assignee);
      if (!agentId) {
        throw new Error(
          `没有找到成员“${assignee}”；没有启动任务。${assigneeHint}`,
        );
      }
      const result = await startTicket({
        prompt: task,
        // A new ticket gets the assignee's own workspace. Only an existing
        // ticket session may carry a caller-supplied workspace.
        workspacePath: sessionId ? workspacePath : null,
        sessionId,
        agentId,
      });
      return {
        accepted: Boolean(result?.accepted),
        reason: result?.reason ?? null,
      };
    },
  };
}
