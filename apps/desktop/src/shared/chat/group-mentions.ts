export type GroupMember = {
  id?: string;
  name?: string;
  archivedAt?: string | null;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Public visibility is independent from explicit delivery targets. */
export function resolveGroupRecipients<M extends GroupMember>(
  text: string,
  members: Iterable<M>,
  { allowEveryone = false }: { allowEveryone?: boolean } = {},
): { agents: M[]; everyone: boolean; error: string | null } {
  const matches = new Map<string, M>();
  const candidates = [...members]
    .filter((member): member is M & { id: string; name: string } =>
      Boolean(member?.id && member?.name),
    )
    .sort((left, right) => right.name.length - left.name.length);

  for (const member of candidates) {
    const mention = new RegExp(
      `(^|[^\\p{L}\\p{N}_])@${escapeRegExp(member.name)}(?![\\p{L}\\p{N}_])`,
      'gu',
    );
    if (mention.test(text)) matches.set(member.id, member);
  }

  const everyone = /(^|[^\p{L}\p{N}_])@所有人(?![\p{L}\p{N}_])/u.test(text);
  if (everyone && !allowEveryone)
    return { agents: [], everyone, error: '只有用户或 Noema 可以 @所有人。' };
  return {
    agents: everyone
      ? candidates.filter((member) => !member.archivedAt)
      : [...matches.values()],
    everyone,
    error: null,
  };
}

/** Non-project groups retain their single responder convention. */
export function resolveGroupRecipient<M extends GroupMember>(
  text: string,
  members: M[],
  defaultAgentId: string | null | undefined,
) {
  const route = resolveGroupRecipients(text, members);
  if (route.error) return { agent: null, error: route.error };
  if (route.agents.length > 1) {
    return {
      agent: null,
      error: '一条群消息只能指定一位回应成员；请拆成多条消息。',
    };
  }
  return {
    agent:
      route.agents[0] ??
      members.find((member) => member.id === defaultAgentId) ??
      null,
    error: null,
  };
}
