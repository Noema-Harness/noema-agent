type ExportMember = { id: string; name: string };
type ExportMessage = {
  role?: string;
  senderAgentId?: string | null;
  agentId?: string | null;
  createdAt?: string | number | Date;
  status?: string;
  errorMessage?: string | null;
  content?: unknown;
};

function timeLabel(value: string | number | Date | undefined) {
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function safeFilePart(value: unknown, fallback: string) {
  const text = String(value ?? '')
    .replace(/[\\/:*?"<>|]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[-.\s]+$/u, '')
    .slice(0, 60);
  return text || fallback;
}

export function conversationExportFileName(
  room: { title?: unknown } | null | undefined,
  date = new Date(),
) {
  const stamp = date.toISOString().slice(0, 10);
  return `Noema-${safeFilePart(room?.title, '对话')}-${stamp}.md`;
}

export function formatConversationMarkdown({
  room,
  members,
  messages,
  exportedAt = new Date(),
}: {
  room: { title?: string | null } | null | undefined;
  members: ExportMember[] | null | undefined;
  messages: ExportMessage[] | null | undefined;
  exportedAt?: Date;
}) {
  const names = new Map(
    (members ?? []).map((member) => [member.id, member.name]),
  );
  const title = room?.title || 'Noema 对话';
  const lines = [`# ${title}`, '', `导出时间：${timeLabel(exportedAt)}`, ''];

  if (members?.length) {
    lines.push(`成员：${members.map((member) => member.name).join('、')}`, '');
  }

  for (const message of messages ?? []) {
    const role =
      message.role === 'user'
        ? '你'
        : names.get(message.senderAgentId ?? message.agentId ?? '') || 'Noema';
    const time = timeLabel(message.createdAt);
    lines.push(`## ${role}${time ? ` · ${time}` : ''}`, '');
    if (message.status === 'failed') {
      lines.push(
        `> 这条回复失败${message.errorMessage ? `：${message.errorMessage}` : '。'}`,
        '',
      );
    }
    if (message.status === 'interrupted') {
      lines.push('> 这条回复被中断。', '');
    }
    const content = String(message.content ?? '').trim();
    lines.push(content || '（空消息）', '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
