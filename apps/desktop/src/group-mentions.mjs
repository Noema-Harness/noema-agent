function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Route a public group message to its sole explicitly mentioned member. */
export function resolveGroupRecipient(text, members, defaultAgentId) {
  const matches = new Map();
  const candidates = [...members]
    .filter((member) => member?.id && member?.name)
    .sort((left, right) => right.name.length - left.name.length);

  for (const member of candidates) {
    const mention = new RegExp(
      `(^|[^\\p{L}\\p{N}_])@${escapeRegExp(member.name)}(?![\\p{L}\\p{N}_])`,
      'gu',
    );
    if (mention.test(text)) matches.set(member.id, member);
  }

  if (matches.size > 1) {
    return {
      agent: null,
      error: '一条群消息只能指定一位回应成员；请拆成多条消息。',
    };
  }
  return {
    agent:
      matches.values().next().value ??
      members.find((member) => member.id === defaultAgentId) ??
      null,
    error: null,
  };
}
