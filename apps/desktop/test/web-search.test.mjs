import assert from 'node:assert/strict';
import test from 'node:test';
import { searchWeb, WEB_SEARCH_LIMITS } from '../src/web-search.mjs';

function response(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('Tavily uses one bounded basic search and returns only safe, short results', async () => {
  let request;
  const result = await searchWeb('最新 AI 新闻', 'secret-key', {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({
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
  });

  assert.equal(request.url, 'https://api.tavily.com/search');
  assert.equal(request.options.headers.authorization, 'Bearer secret-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    query: '最新 AI 新闻',
    search_depth: 'basic',
    max_results: 3,
    include_answer: false,
    include_raw_content: false,
  });
  assert.equal(result.results.length, WEB_SEARCH_LIMITS.maxResults);
  assert.equal(result.results[0].url, 'https://example.com/news');
  assert.deepEqual(Object.keys(result.results[0]).sort(), [
    'id',
    'title',
    'url',
  ]);
  assert.equal(WEB_SEARCH_LIMITS.maxResults, 3);
});

test('Tavily errors do not leak provider response bodies or credentials', async () => {
  await assert.rejects(
    searchWeb('当前资料', 'secret-key', {
      fetchImpl: async () =>
        new Response('secret-key provider details', { status: 429 }),
    }),
    (error) =>
      error.message === '网页搜索额度或频率限制已达到。' &&
      !error.message.includes('secret-key'),
  );
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
