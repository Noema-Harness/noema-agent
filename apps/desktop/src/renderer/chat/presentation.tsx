import React from 'react';
import { NoemaIcon } from '../ui/noema-icon';
export { NoemaIcon as Icon } from '../ui/noema-icon';
import type {
  NoemaSocialAgent,
  NoemaSocialProject,
} from '../../shared/contracts/noema-bridge.d.ts';

export function timeLabel(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat('zh-CN', {
    ...(sameDay ? {} : { month: 'numeric', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function dayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const today = new Date().toDateString() === date.toDateString();
  return `${today ? '今天 · ' : ''}${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export function projectHasFinalizationIssue(project: NoemaSocialProject) {
  return Boolean(
    project.status !== 'archived' &&
    project.growthBatch?.members.some((member) =>
      ['failed', 'interrupted'].includes(member.status),
    ),
  );
}

export function projectFinalizationIssueNames(project: NoemaSocialProject) {
  return (
    project.growthBatch?.members
      .filter((member) => ['failed', 'interrupted'].includes(member.status))
      .map((member) => member.agentName) ?? []
  );
}

export function projectStatusLabel(project: NoemaSocialProject) {
  if (project.status === 'awaiting_user') return '等待你的评审';
  if (project.status === 'archived') return '已归档';
  if (projectHasFinalizationIssue(project)) return '归档暂缓';
  if (project.growthBatch?.status === 'running') return '正在收尾';
  return '进行中';
}

export function AgentMark({
  agent,
  small = false,
}: {
  agent: Pick<NoemaSocialAgent, 'id' | 'name' | 'kind'>;
  small?: boolean;
}) {
  return (
    <span
      className={`portrait agent-mark ${agent.kind === 'core' ? 'core' : 'specialist'} ${small ? 'agent-mark-small' : ''}`}
      aria-hidden="true"
    >
      {agent.kind === 'core' ? (
        <NoemaIcon name="noema" />
      ) : (
        agent.name.trim().slice(0, 1)
      )}
    </span>
  );
}
