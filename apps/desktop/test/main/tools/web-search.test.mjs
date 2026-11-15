import assert from 'node:assert/strict';
import test from 'node:test';
import {
  needsWebSearch,
  searchAndReadWeb,
  searchQueryBelongsToText,
  searchWeb,
  WEB_SEARCH_LIMITS,
} from '../../../src/main/tools/web-search.ts';

function response(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('Tavily uses one bounded basic search and returns only safe, short results', async () => {
  let request;
  const usage = [];
  const result = await searchWeb('最新 AI 新闻', 'secret-key', {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({
        usage: { credits: 1 },
        request_id: 'tavily-request-1',
        results: [
          {
            title: '可信网页',
            url: 'https://example.com/news?api_key=private#fragment',
          },
          {
            title: '本地地址不得展示',
            url: 'https://localhost/private',
          },
          {
            title: '重复地址',
            url: 'https://example.com/news',
          },
          ...Array.from({ length: 5 }, (_, index) => ({
            title: `结果 ${index}`,
            url: `https://example.com/${index}`,
          })),
        ],
      });
    },
    onUsage: (record) => usage.push(record),
  });

  assert.equal(request.url, 'https://api.tavily.com/search');
  assert.equal(request.options.headers.authorization, 'Bearer secret-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    query: '最新 AI 新闻',
    search_depth: 'basic',
    max_results: 3,
    include_answer: false,
    include_raw_content: false,
    include_usage: true,
  });
  assert.equal(result.results.length, WEB_SEARCH_LIMITS.maxResults);
  assert.equal(result.results[0].url, 'https://example.com/news');
  assert.deepEqual(usage, [
    {
      requestStatus: 'completed',
      usageUnits: 1,
      usageUnit: 'credits',
      providerRequestId: 'tavily-request-1',
    },
  ]);
  assert.deepEqual(Object.keys(result.results[0]).sort(), [
    'id',
    'title',
    'url',
  ]);
  assert.equal(WEB_SEARCH_LIMITS.maxResults, 3);
});

test('Tavily errors do not leak provider response bodies or credentials', async () => {
  const usage = [];
  await assert.rejects(
    searchWeb('当前资料', 'secret-key', {
      fetchImpl: async () =>
        new Response('secret-key provider details', { status: 429 }),
      onUsage: (record) => usage.push(record),
    }),
    (error) =>
      error.message === '网页搜索额度或频率限制已达到。' &&
      !error.message.includes('secret-key'),
  );
  assert.deepEqual(usage, [
    {
      requestStatus: 'failed',
      usageUnits: undefined,
      usageUnit: 'credits',
      providerRequestId: undefined,
    },
  ]);
});

test('Tavily search rejects invalid queries before making a request', async () => {
  let called = false;
  await assert.rejects(
    searchWeb('x'.repeat(WEB_SEARCH_LIMITS.maxQueryLength + 1), 'key', {
      fetchImpl: async () => {
        called = true;
        return response({ results: [] });
      },
    }),
    /搜索词无效/u,
  );
  assert.equal(called, false);
});

test('Tavily search propagates the caller abort signal to the network request', async () => {
  const controller = new AbortController();
  let requestSignal;
  const pending = searchWeb('当前资料', 'key', {
    signal: controller.signal,
    fetchImpl: async (_url, options) => {
      requestSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(options.signal.reason),
          { once: true },
        );
      });
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new DOMException('Stopped by user', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requestSignal.aborted, true);
});

test('Tavily search deadline reports timeouts while waiting for headers or response body', async () => {
  await assert.rejects(
    searchWeb('当前资料', 'key', {
      timeoutMs: 20,
      fetchImpl: async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    }),
    /网页搜索超时/u,
  );

  let requestSignal;
  await assert.rejects(
    searchWeb('当前资料', 'key', {
      timeoutMs: 20,
      fetchImpl: async (_url, { signal }) => {
        requestSignal = signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              signal.addEventListener(
                'abort',
                () => controller.error(signal.reason),
                { once: true },
              );
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      },
    }),
    /网页搜索超时/u,
  );
  assert.equal(requestSignal.aborted, true);
});

test('project research reads bounded candidates and distinguishes readable pages', async () => {
  const redirectHosts = [];
  const signal = new AbortController().signal;
  const result = await searchAndReadWeb('公开资料研究 Noema', 'key', {
    searchImpl: async (_query, _key, { signal }) => {
      assert.ok(signal);
      return {
        fetchedAt: '2026-10-30T00:00:00.000Z',
        results: [
          { id: '1', title: '可读页面', url: 'https://one.example/a' },
          { id: '2', title: '不可读页面', url: 'https://two.example/b' },
          { id: '3', title: '未读取页面', url: 'https://three.example/c' },
        ],
      };
    },
    signal,
    fetchSourceImpl: async (url, { allowedRedirectHosts, signal }) => {
      redirectHosts.push(...allowedRedirectHosts);
      assert.ok(signal);
      if (url.endsWith('/b')) throw new Error('正文不可读');
      return {
        source: {
          id: 'source-1',
          title: '可读页面正文',
          url,
          fetchedAt: '2026-10-30T00:00:01.000Z',
        },
        content: '实际读取到的正文',
      };
    },
    maxSources: 2,
  });

  assert.deepEqual(
    result.results.map(({ status }) => status),
    ['read', 'unreadable', 'not_read'],
  );
  assert.equal(result.results[0].content, '实际读取到的正文');
  assert.equal(result.results[1].error, '正文不可读');
  assert.equal(result.results[2].error, '本轮来源上限已达到。');
  assert.deepEqual([...new Set(redirectHosts)].sort(), [
    'one.example',
    'three.example',
    'two.example',
  ]);
});

test('project research propagates cancellation and bounds source count', async () => {
  let readCount = 0;
  const controller = new AbortController();
  const noReads = await searchAndReadWeb('sources', 'key', {
    searchImpl: async () => ({
      fetchedAt: 'now',
      results: [{ title: '候选', url: 'https://example.com/a' }],
    }),
    fetchSourceImpl: async () => {
      readCount += 1;
      return { source: {}, content: 'text' };
    },
    signal: controller.signal,
    maxSources: WEB_SEARCH_LIMITS.maxResults + 20,
  });
  assert.equal(readCount, 1);
  assert.equal(noReads.results[0].status, 'read');

  controller.abort(new DOMException('Stopped', 'AbortError'));
  await assert.rejects(
    searchAndReadWeb('sources', 'key', {
      searchImpl: async (_query, _key, { signal }) => {
        signal.throwIfAborted();
        return { fetchedAt: 'now', results: [] };
      },
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
});

test('public research intent and query checks stay tied to supplied user text', () => {
  assert.equal(needsWebSearch('请用公开资料做外部研究'), true);
  assert.equal(needsWebSearch('帮我把这段话改得自然一些'), false);
  assert.equal(
    searchQueryBelongsToText(
      '请核查 OpenAI Agents 的公开资料',
      'OpenAI Agents',
    ),
    true,
  );
  assert.equal(
    searchQueryBelongsToText(
      '请核查 OpenAI Agents 的公开资料',
      'private history',
    ),
    false,
  );
});
