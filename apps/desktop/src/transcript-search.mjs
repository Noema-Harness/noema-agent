/** @typedef {import('./noema-bridge.d.ts').NoemaRootMessage} NoemaRootMessage */
/** @typedef {import('./noema-bridge.d.ts').NoemaCapture} NoemaCapture */

const MAX_HISTORY_SEARCH_RESULTS = 4;
const MAX_HISTORY_EXCERPT_LENGTH = 320;
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
const HISTORY_CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|$)/giu,
  /\bsk-(?:ant-)?[a-z0-9_-]{16,}\b/giu,
  /\bAIza[a-z0-9_-]{30,}\b/giu,
  /\bgh[pousr]_[a-z0-9_]{20,}\b/giu,
  /\bgithub_pat_[a-z0-9_]{20,}\b/giu,
  /\bxox[baprs]-[a-z0-9-]{16,}\b/giu,
  /\bfla_[a-z0-9]{16,}\b/giu,
  /\bBearer\s+[a-z0-9._~+/-]{16,}=*/giu,
  /\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/giu,
  /((?:api[\s_-]?key|access[\s_-]?token|secret|password|passwd|密钥|密码|口令)\s*(?::|：|=|\bis\b|为|是)\s*["'`]?)[^\s,，。;；"'`]{6,}/giu,
];

/**
 * Search all locally-owned items on the primary timeline. This is a local
 * lookup only; callers must not send its results to a model implicitly.
 * @param {NoemaRootMessage[]} messages
 * @param {string} query
 * @param {NoemaCapture[]} [captures]
 * @returns {Array<{id:string,source:'message'|'capture',role?:NoemaRootMessage['role'],createdAt:string,snippet:string}>}
 */
export function findTranscriptMatches(messages, query, captures = []) {
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
          source: 'message',
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
          source: 'capture',
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

function historySearchTerms(query) {
  const terms = new Set();
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

function normalizeHistorySearchText(value) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9_\u3400-\u9fff]/gu, '');
}

function historyExcerpt(content, matchAt) {
  const start = Math.max(
    0,
    Math.min(matchAt - 100, content.length - MAX_HISTORY_EXCERPT_LENGTH),
  );
  const end = Math.min(content.length, start + MAX_HISTORY_EXCERPT_LENGTH);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

export function redactSensitiveText(excerpt) {
  let redacted = false;
  const sanitized = HISTORY_CREDENTIAL_PATTERNS.reduce(
    (content, pattern) =>
      content.replace(pattern, (...args) => {
        if (args[0].includes('[已隐藏疑似凭据]')) return args[0];
        redacted = true;
        if (typeof args[1] === 'string') {
          return `${args[1]}[已隐藏疑似凭据]`;
        }
        return '[已隐藏疑似凭据]';
      }),
    excerpt,
  );
  return { snippet: sanitized, redacted };
}

/**
 * Search only completed, visible root-dialogue messages. This is agent recall,
 * not transcript archival: callers decide when to invoke it and how to expose
 * the returned source IDs.
 *
 * @param {NoemaRootMessage[]} messages
 * @param {string} query
 * @param {{currentTurnId:string, limit?:number}} options
 * @returns {Array<{id:string,role:NoemaRootMessage['role'],createdAt:string,snippet:string,redacted:boolean}>}
 */
export function searchTranscriptHistory(
  messages,
  query,
  { currentTurnId, limit = MAX_HISTORY_SEARCH_RESULTS },
) {
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
