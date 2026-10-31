import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractUserUrls,
  fetchWebSource,
} from '../../../src/main/tools/web-source.mjs';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('extracts only explicit HTTP links and caps the current-turn source list', () => {
  assert.deepEqual(
    extractUserUrls(
      '请读 https://example.com/a?x=1。 还有 http://example.org/b). javascript:alert(1) https://example.net/c https://fourth.example/d',
    ),
    [
      'https://example.com/a?x=1',
      'http://example.org/b',
      'https://example.net/c',
    ],
  );
});

test('fetches an explicitly supplied page, extracts readable text, and redacts secret query parameters in citations', async () => {
  let requested;
  const result = await fetchWebSource(
    'https://example.com/article?api_key=secret&lang=zh#section',
    {
      lookupImpl: publicLookup,
      requestImpl: async (url, addresses) => {
        requested = { url: url.href, addresses };
        return {
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: Buffer.from(
            '<html><head><title>页面标题</title></head><body><article><h1>正文标题</h1><p>这是可供模型核对的网页正文。</p></article></body></html>',
          ),
        };
      },
    },
  );

  assert.equal(
    requested.url,
    'https://example.com/article?api_key=secret&lang=zh',
  );
  assert.equal(requested.addresses[0].address, '93.184.216.34');
  assert.equal(result.source.title, '页面标题');
  assert.equal(result.source.url, 'https://example.com/article?lang=zh');
  assert.match(result.content, /可供模型核对/u);
  assert.equal(result.source.truncated, false);
});

test('rejects local addresses before making an HTTP request', async () => {
  let requestCount = 0;
  await assert.rejects(
    fetchWebSource('http://127.0.0.1/private', {
      requestImpl: async () => {
        requestCount += 1;
      },
    }),
    /非公开网络地址/u,
  );
  assert.equal(requestCount, 0);
});

test('web page fetching propagates caller cancellation through the safe reader', async () => {
  const controller = new AbortController();
  let requestSignal;
  const pending = fetchWebSource('https://example.com/docs', {
    signal: controller.signal,
    lookupImpl: publicLookup,
    requestImpl: async (_url, _addresses, { signal }) => {
      requestSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new DOMException('Stopped by user', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requestSignal.aborted, true);
});

test('cancelling during DNS resolution prevents the HTTP request', async () => {
  const controller = new AbortController();
  let requestCount = 0;
  const pending = fetchWebSource('https://example.com/docs', {
    signal: controller.signal,
    lookupImpl: async () => new Promise(() => {}),
    requestImpl: async () => {
      requestCount += 1;
      throw new Error('An aborted DNS lookup must not reach HTTP.');
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new DOMException('Stopped by user', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requestCount, 0);
});

test('web source applies one timeout across DNS resolution before opening HTTP', async () => {
  let requestCount = 0;
  await assert.rejects(
    fetchWebSource('https://example.com/docs', {
      timeoutMs: 20,
      lookupImpl: async () => new Promise(() => {}),
      requestImpl: async () => {
        requestCount += 1;
        throw new Error('HTTP must not start after the deadline.');
      },
    }),
    /网页读取超时/u,
  );
  assert.equal(requestCount, 0);
});

test('accepts only proxy-mapped addresses for explicitly supplied hosts', async () => {
  let requestCount = 0;
  const dependencies = {
    lookupImpl: async () => [{ address: '198.18.0.34', family: 4 }],
    requestImpl: async (_url, addresses) => {
      requestCount += 1;
      assert.equal(addresses[0].address, '198.18.0.34');
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: Buffer.from('代理映射后的正文。'),
      };
    },
    proxyConfiguredImpl: () => true,
  };

  await assert.rejects(
    fetchWebSource('https://example.com/docs', dependencies),
    /非公开网络地址/u,
  );
  assert.equal(requestCount, 0);

  const result = await fetchWebSource('https://example.com/docs', {
    ...dependencies,
    allowedRedirectHosts: ['example.com'],
  });
  assert.match(result.content, /代理映射后的正文/u);
  assert.equal(requestCount, 1);
});

test('proxy-mapped redirects must stay within a host supplied by the user', async () => {
  let requestCount = 0;
  await assert.rejects(
    fetchWebSource('https://example.com/redirect', {
      lookupImpl: async () => [{ address: '198.18.0.34', family: 4 }],
      proxyConfiguredImpl: () => true,
      allowedRedirectHosts: ['example.com'],
      requestImpl: async () => {
        requestCount += 1;
        return {
          statusCode: 302,
          headers: { location: 'https://other.example/private' },
          body: Buffer.alloc(0),
        };
      },
    }),
    /非公开网络地址/u,
  );
  assert.equal(requestCount, 1);
});

test('resolves IPv6 URL literals without sending bracket syntax to DNS', async () => {
  let resolvedHost;
  let requestedAddress;
  await fetchWebSource('https://[2606:4700:4700::1111]/', {
    lookupImpl: async (hostname) => {
      resolvedHost = hostname;
      return [];
    },
    requestImpl: async (_url, addresses) => {
      requestedAddress = addresses[0].address;
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: Buffer.from('可读取的公开页面内容。'),
      };
    },
  });
  assert.equal(resolvedHost, undefined);
  assert.equal(requestedAddress, '2606:4700:4700::1111');
});

test('revalidates redirect destinations before making another request', async () => {
  let requestCount = 0;
  await assert.rejects(
    fetchWebSource('https://example.com/redirect', {
      lookupImpl: async (hostname) =>
        hostname === 'example.com'
          ? [{ address: '93.184.216.34', family: 4 }]
          : [{ address: '127.0.0.1', family: 4 }],
      requestImpl: async () => {
        requestCount += 1;
        return {
          statusCode: 302,
          headers: { location: 'http://localhost/admin' },
          body: Buffer.alloc(0),
        };
      },
    }),
    /非公开网络地址/u,
  );
  assert.equal(requestCount, 1);
});

test('rejects unsupported MIME types and bounds the text sent to the model', async () => {
  await assert.rejects(
    fetchWebSource('https://example.com/archive.zip', {
      lookupImpl: publicLookup,
      requestImpl: async () => ({
        statusCode: 200,
        headers: { 'content-type': 'application/zip' },
        body: Buffer.from('not a web page'),
      }),
    }),
    /不是支持的网页文本类型/u,
  );

  const result = await fetchWebSource('https://example.com/long', {
    lookupImpl: publicLookup,
    requestImpl: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: Buffer.from(
        `<article><h1>长页面</h1><p>${'正文'.repeat(5_000)}</p></article>`,
      ),
    }),
  });
  assert.equal(result.content.length, 8_000);
  assert.equal(result.source.truncated, true);
});
