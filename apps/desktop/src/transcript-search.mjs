/** @typedef {import('./noema-bridge.d.ts').NoemaRootMessage} NoemaRootMessage */

/**
 * @param {NoemaRootMessage[]} messages
 * @param {string} query
 * @returns {Array<{id: string, role: NoemaRootMessage['role'], createdAt: string, snippet: string}>}
 */
export function findTranscriptMatches(messages, query) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  return messages.flatMap((message) => {
    const index = message.content.toLocaleLowerCase().indexOf(needle);
    if (index < 0) return [];

    const start = Math.max(0, index - 28);
    const end = Math.min(message.content.length, index + needle.length + 48);
    const snippet = `${start > 0 ? '…' : ''}${message.content.slice(start, end)}${end < message.content.length ? '…' : ''}`;

    return [
      {
        id: message.id,
        role: message.role,
        createdAt: message.createdAt,
        snippet,
      },
    ];
  });
}
