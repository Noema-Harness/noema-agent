export type NoemaRootMessage =
  import('../contracts/noema-bridge.d.ts').NoemaRootMessage;
export type NoemaCapture =
  import('../contracts/noema-bridge.d.ts').NoemaCapture;

import { redactSensitiveText } from '../text/sensitive-text.ts';
export { redactSensitiveText } from '../text/sensitive-text.ts';

const MAX_HISTORY_SEARCH_RESULTS = 4;
const MAX_HISTORY_EXCERPT_LENGTH = 320;
const PAST_CONTEXT_REFERENCE =
  /(?:(?:之前|以前|过去|曾经|先前|上次|上回|刚才|前面|上周|前几天).{0,20}(?:聊过|讨论过|说过|提过|提到过|问过|决定|选择|计划|做过)|(?:聊过|讨论过|说过|提过|提到过|问过).{0,20}(?:吗|什么|哪|我们|我|你|那)|(?:还)?记得.{0,16}(?:我们|我|你).{0,20}(?:说|聊|提|讨论|决定|选择|喜欢|偏好|计划|做|关注)|last\s+time|earlier|previously|before|remember\s+when|did\s+we\s+(?:discuss|talk))/iu;
const HISTORY_SEARCH_STOPWORDS = new Set([
  '之前',
  '前的',
  '上次',
  '我们',
  '你说',
  '说过',
  '记得',
  '讨论',
  '那个',
  '这个',
  '当时',
  '时候',
  '后来',
  '现在',
  '其实',
  '感觉',
  '觉得',
  '问题',
  '怎么',
  '什么',
  '为什么',
  '一下',
]);

export function userReferencesPastNoemaContext(text: unknown) {
  return typeof text === 'string' && PAST_CONTEXT_REFERENCE.test(text);
}

/**
 * Search all locally-owned items on the primary timeline. This is a local
 * lookup only; callers must not send its results to a model implicitly.
 */
export function findTranscriptMatches(
  messages: NoemaRootMessage[],
  query: string,
  captures: NoemaCapture[] = [],
): Array<{
  id: string;
  source: 'message' | 'capture';
  role?: NoemaRootMessage['role'];
  createdAt: string;
  snippet: string;
}> {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  const matches = [
    ...messages.flatMap((message) => {
      const index = message.content.toLocaleLowerCase().indexOf(needle);
      if (index < 0) return [];

      const start = Math.max(0, index - 28);
      const end = Math.min(message.content.length, index + needle.length + 48);
      const snippet = `${start > 0 ? '…' : ''}${message.content.slice(start, end)}${end < message.content.length ? '…' : ''}`;

      return [
        {
          id: message.id,
          source: 'message' as const,
          role: message.role,
          createdAt: message.createdAt,
          snippet,
        },
      ];
    }),
    ...captures.flatMap((capture) => {
      const index = capture.content.toLocaleLowerCase().indexOf(needle);
      if (index < 0) return [];

      const start = Math.max(0, index - 28);
      const end = Math.min(capture.content.length, index + needle.length + 48);
      const snippet = `${start > 0 ? '…' : ''}${capture.content.slice(start, end)}${end < capture.content.length ? '…' : ''}`;

      return [
        {
          id: capture.id,
          source: 'capture' as const,
          createdAt: capture.createdAt,
          snippet,
        },
      ];
    }),
  ];

  return matches.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function historySearchTerms(query: string) {
  const terms = new Set<string>();
  const tokens =
    query.toLocaleLowerCase().match(/[a-z0-9_]+|[\u3400-\u9fff]+/gu) ?? [];
  for (const token of tokens) {
    if (/^[a-z0-9_]+$/u.test(token)) {
      if (token.length >= 2) terms.add(token);
      continue;
    }
    if (token.length === 1) continue;
    for (let index = 0; index < token.length - 1; index += 1) {
      const term = token.slice(index, index + 2);
      if (!HISTORY_SEARCH_STOPWORDS.has(term)) terms.add(term);
    }
  }
  return [...terms];
}

function normalizeHistorySearchText(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9_\u3400-\u9fff]/gu, '');
}

function historyExcerpt(content: string, matchAt: number) {
  const start = Math.max(
    0,
    Math.min(matchAt - 100, content.length - MAX_HISTORY_EXCERPT_LENGTH),
  );
  const end = Math.min(content.length, start + MAX_HISTORY_EXCERPT_LENGTH);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

/**
 * Search only completed, visible root-dialogue messages. This is agent recall,
 * not transcript archival: callers decide when to invoke it and how to expose
 * the returned source IDs.
 */
export function searchTranscriptHistory(
  messages: NoemaRootMessage[],
  query: string,
  {
    currentTurnId,
    limit = MAX_HISTORY_SEARCH_RESULTS,
  }: { currentTurnId: string; limit?: number },
): Array<{
  id: string;
  role: NoemaRootMessage['role'];
  createdAt: string;
  snippet: string;
  redacted: boolean;
}> {
  const normalizedQuery = normalizeHistorySearchText(query.trim());
  const terms = historySearchTerms(query.trim());
  if (!normalizedQuery || terms.length === 0 || !currentTurnId) return [];

  const boundedLimit = Math.max(1, Math.min(MAX_HISTORY_SEARCH_RESULTS, limit));
  const candidates = [];
  for (const [position, message] of messages.entries()) {
    if (
      message.turnId === currentTurnId ||
      message.turnStatus !== 'completed' ||
      message.status !== 'complete' ||
      !['user', 'assistant'].includes(message.role)
    ) {
      continue;
    }

    const normalizedContent = normalizeHistorySearchText(message.content);
    const exact = normalizedContent.includes(normalizedQuery);
    const matchedTerms = terms.filter((term) =>
      normalizedContent.includes(term),
    );
    const minimumMatches = terms.length === 1 ? 1 : 2;
    if (!exact && matchedTerms.length < minimumMatches) continue;

    const firstMatch = exact
      ? message.content
          .toLocaleLowerCase()
          .indexOf(query.trim().toLocaleLowerCase())
      : Math.max(
          0,
          ...matchedTerms.map((term) =>
            message.content.toLocaleLowerCase().indexOf(term),
          ),
        );
    candidates.push({
      id: message.id,
      role: message.role,
      createdAt: message.createdAt,
      content: message.content,
      firstMatch,
      score:
        (exact ? 100 : 0) +
        (matchedTerms.length / terms.length) * 10 +
        position / Math.max(messages.length, 1),
      position,
    });
  }

  return candidates
    .sort(
      (left, right) =>
        right.score - left.score || right.position - left.position,
    )
    .slice(0, boundedLimit)
    .map(({ id, role, createdAt, content, firstMatch }) => {
      const { snippet: sanitizedContent, redacted } =
        redactSensitiveText(content);
      const sanitizedPrefix = redactSensitiveText(
        content.slice(0, firstMatch),
      ).snippet;
      return {
        id,
        role,
        createdAt,
        snippet: historyExcerpt(sanitizedContent, sanitizedPrefix.length),
        redacted,
      };
    });
}
