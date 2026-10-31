import React, { type SVGProps } from 'react';
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

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & {
  name:
    | 'plus'
    | 'users'
    | 'user-add'
    | 'search'
    | 'send'
    | 'settings'
    | 'noema'
    | 'project'
    | 'archive'
    | 'attach'
    | 'arrow'
    | 'back'
    | 'menu'
    | 'close'
    | 'stop';
}) {
  const paths: Record<typeof name, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    users: (
      <>
        <path d="M16 20v-1.3a3.7 3.7 0 0 0-3.7-3.7H6.7A3.7 3.7 0 0 0 3 18.7V20" />
        <circle cx="9.5" cy="7.5" r="3.5" />
        <path d="M17 11a3.5 3.5 0 1 0-1-6.8M17 15h4m-2-2v4" />
      </>
    ),
    'user-add': (
      <>
        <circle cx="9" cy="7.5" r="3.5" />
        <path d="M2.5 20v-1.3A3.7 3.7 0 0 1 6.2 15h5.6a3.7 3.7 0 0 1 3.7 3.7V20M19 7v6m-3-3h6" />
      </>
    ),
    search: (
      <>
        <circle cx="10.8" cy="10.8" r="6.3" />
        <path d="m15.4 15.4 4.1 4.1" />
      </>
    ),
    send: <path d="M12 5v14M6 11l6-6 6 6" />,
    noema: <path d="M5 18V9a5 5 0 0 1 10 0v9M9 18V9m10 9V6" />,
    project: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4m8-4v4M4 11h16m-11 4h6" />
      </>
    ),
    archive: (
      <>
        <rect x="3" y="4" width="18" height="4" rx="1" />
        <path d="M5 8v12h14V8m-10 5h6" />
      </>
    ),
    attach: (
      <path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8m-3 9 6-6" />
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 0 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 0 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z" />
      </>
    ),
    back: <path d="m15 18-6-6 6-6M9 12h11" />,
    menu: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
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
        <Icon name="noema" />
      ) : (
        agent.name.trim().slice(0, 1)
      )}
    </span>
  );
}
