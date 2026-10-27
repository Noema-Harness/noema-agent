import { randomUUID } from 'node:crypto';

const SEARCH_ENDPOINT = 'https://api.tavily.com/search';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_RESULTS = 3;
const MAX_QUERY_LENGTH = 500;

function safeResultUrl(value) {
  if (typeof value !== 'string' || value.length > 4_000) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !url.hostname ||
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname.endsWith('.local')
    ) {
      return null;
    }
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (
        /(?:token|secret|password|auth|signature|^sig$|api[-_]?key|access[-_]?key)/iu.test(
          key,
        )
      ) {
        url.searchParams.delete(key);
      }
    }
    return url.href;
  } catch {
    return null;
  }
}

function sanitizeResults(payload) {
  if (!Array.isArray(payload?.results)) return [];
  const seen = new Set();
  return payload.results
    .flatMap((item) => {
      const url = safeResultUrl(item?.url);
      const title = typeof item?.title === 'string' ? item.title.trim() : '';
      if (!url || !title || seen.has(url)) return [];
      seen.add(url);
      return [{ title: title.slice(0, 500), url }];
    })
    .slice(0, MAX_RESULTS);
}

async function readLimitedBody(response) {
  if (!response.body) return '';
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_RESPONSE_BYTES) {
      await response.body.cancel().catch(() => {});
      throw new Error('网页搜索响应超过大小限制。');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function searchWeb(query, apiKey, { fetchImpl = fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('网页搜索服务尚未配置。');
  }
  if (
    typeof query !== 'string' ||
    !query.trim() ||
    query.trim().length > MAX_QUERY_LENGTH
  ) {
    throw new Error('搜索词无效或超过 500 个字符。');
  }

  let response;
  try {
    response = await fetchImpl(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey.trim()}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        query: query.trim(),
        search_depth: 'basic',
        max_results: MAX_RESULTS,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      error?.name === 'TimeoutError'
        ? '网页搜索超时。'
        : '网页搜索服务暂时不可用。',
    );
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('网页搜索响应超过大小限制。');
  }
  let text;
  try {
    text = await readLimitedBody(response);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === '网页搜索响应超过大小限制。'
    )
      throw error;
    throw new Error('网页搜索响应无法读取。');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('网页搜索凭据无效或服务尚未启用。');
    }
    if (response.status === 429) {
      throw new Error('网页搜索额度或频率限制已达到。');
    }
    throw new Error(`网页搜索服务返回 HTTP ${response.status}。`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('网页搜索服务返回了无法读取的内容。');
  }
  const results = sanitizeResults(payload);
  return {
    fetchedAt: new Date().toISOString(),
    results: results.map((result) => ({
      id: randomUUID(),
      title: result.title,
      url: result.url,
    })),
  };
}

export const WEB_SEARCH_LIMITS = Object.freeze({
  maxQueryLength: MAX_QUERY_LENGTH,
  maxResults: MAX_RESULTS,
  maxResponseBytes: MAX_RESPONSE_BYTES,
});
