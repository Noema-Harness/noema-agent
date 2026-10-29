import { randomUUID } from 'node:crypto';
import {
  fetchWebSource,
  MAX_EXTERNAL_SOURCES_PER_MESSAGE,
} from './web-source.mjs';

const SEARCH_ENDPOINT = 'https://api.tavily.com/search';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_RESULTS = 3;
const MAX_QUERY_LENGTH = 500;

export const WEB_SEARCH_INTENT =
  /(?:搜索|查找|查一下|搜一下|联网|外部(?:资料|来源|研究|调查|调研)|公开(?:资料|来源|信息)|查找(?:资料|来源)|来源|出处|核实|查证|验证事实|文献|论文|行业报告|最新|今天|本周|本月|今年|新闻|价格|汇率|天气|政策|法规|官方资料|实时|最近(?:的)?(?:新闻|变化|进展|动态|版本|价格|政策)|当前(?:的)?(?:价格|政策|版本|行情|汇率|天气|信息|新闻|进展))/u;

export function needsWebSearch(text) {
  return WEB_SEARCH_INTENT.test(text);
}

export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .toLocaleLowerCase();
}

export function searchQueryBelongsToText(text, query) {
  const normalizedText = normalizeSearchText(text);
  const normalizedQuery = normalizeSearchText(query);
  return Boolean(normalizedQuery && normalizedText.includes(normalizedQuery));
}

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

export async function searchWeb(
  query,
  apiKey,
  { fetchImpl = fetch, signal, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
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
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
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
      signal: requestSignal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      timeoutSignal.aborted || error?.name === 'TimeoutError'
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
    if (signal?.aborted) throw error;
    if (timeoutSignal.aborted) throw new Error('网页搜索超时。');
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

/**
 * @param {string} query
 * @param {string} apiKey
 * @param {{searchImpl?:typeof searchWeb,fetchSourceImpl?:typeof fetchWebSource,signal?:AbortSignal,maxSources?:number}} options
 */
export async function searchAndReadWeb(
  query,
  apiKey,
  {
    searchImpl = searchWeb,
    fetchSourceImpl = fetchWebSource,
    signal,
    maxSources = MAX_EXTERNAL_SOURCES_PER_MESSAGE,
  } = {},
) {
  const discovery = await searchImpl(query, apiKey, { signal });
  const allowedRedirectHosts = discovery.results.flatMap((item) => {
    try {
      return [new URL(item.url).hostname];
    } catch {
      return [];
    }
  });
  const limit = Math.max(
    0,
    Math.min(MAX_EXTERNAL_SOURCES_PER_MESSAGE, Number(maxSources) || 0),
  );
  const readable = discovery.results.slice(0, limit);
  const readResults = await Promise.all(
    readable.map(async (candidate) => {
      try {
        const fetched = await fetchSourceImpl(candidate.url, {
          allowedRedirectHosts,
          signal,
        });
        return { candidate, status: 'read', ...fetched };
      } catch (error) {
        if (signal?.aborted) throw error;
        return {
          candidate,
          status: 'unreadable',
          error: error instanceof Error ? error.message : '网页正文读取失败。',
        };
      }
    }),
  );
  return {
    fetchedAt: discovery.fetchedAt,
    totalCandidates: discovery.results.length,
    results: [
      ...readResults,
      ...discovery.results.slice(limit).map((candidate) => ({
        candidate,
        status: 'not_read',
        error: '本轮来源上限已达到。',
      })),
    ],
  };
}

export const WEB_SEARCH_LIMITS = Object.freeze({
  maxQueryLength: MAX_QUERY_LENGTH,
  maxResults: MAX_RESULTS,
  maxResponseBytes: MAX_RESPONSE_BYTES,
});
