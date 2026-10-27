import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export const MAX_EXTERNAL_SOURCES_PER_MESSAGE = 3;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_EXCERPT_LENGTH = 8_000;
const REQUEST_TIMEOUT_MS = 12_000;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/markdown',
]);

function hasConfiguredProxy(protocol) {
  const names =
    protocol === 'https:'
      ? [
          'HTTPS_PROXY',
          'https_proxy',
          'HTTP_PROXY',
          'http_proxy',
          'ALL_PROXY',
          'all_proxy',
        ]
      : ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

function isProxyMappedAddress(value) {
  try {
    const address = ipaddr.parse(value);
    return (
      address.kind() === 'ipv4' && address.match(ipaddr.parse('198.18.0.0'), 15)
    );
  } catch {
    return false;
  }
}

function isPublicAddress(value) {
  try {
    const address = ipaddr.parse(value);
    if (address.kind() === 'ipv6' && address.isIPv4MappedAddress()) {
      return address.toIPv4Address().range() === 'unicast';
    }
    return address.range() === 'unicast';
  } catch {
    return false;
  }
}

async function resolvePublicAddresses(
  hostname,
  lookupImpl = lookup,
  { allowProxyMapped = false } = {},
) {
  const address =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
  const records = ipaddr.isValid(address)
    ? [
        {
          address,
          family: ipaddr.parse(address).kind() === 'ipv4' ? 4 : 6,
        },
      ]
    : await lookupImpl(address, { all: true, verbatim: true });
  if (!records.length) {
    throw new Error('该链接解析到非公开网络地址，已拒绝读取。');
  }
  if (records.every(({ address: value }) => isPublicAddress(value))) {
    return { records, proxyMapped: false };
  }
  if (
    allowProxyMapped &&
    records.every(({ address: value }) => isProxyMappedAddress(value))
  ) {
    return { records, proxyMapped: true };
  }
  throw new Error('该链接解析到非公开网络地址，已拒绝读取。');
}

function validateUrl(value) {
  if (typeof value !== 'string' || value.length > 4_000) {
    throw new Error('网页链接无效或过长。');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('网页链接无法解析。');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port)) ||
    /[\\\t\r\n]/u.test(value)
  ) {
    throw new Error('只支持公开 HTTP/HTTPS 网页链接。');
  }
  url.hash = '';
  return url;
}

function requestOnce(url, addresses, { signal } = {}) {
  const transport = url.protocol === 'https:' ? https : http;
  if (signal?.aborted) signal.throwIfAborted();
  const agent = new transport.Agent({
    keepAlive: false,
    lookup(hostname, options, callback) {
      const result = addresses[0];
      if (options?.all) callback(null, addresses);
      else callback(null, result.address, result.family);
    },
  });
  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        agent,
        method: 'GET',
        headers: {
          accept:
            'text/html, application/xhtml+xml, text/plain, text/markdown;q=0.9',
          'accept-encoding': 'identity',
          'user-agent': 'Noema/0.1 (user-requested page reader)',
        },
      },
      (response) => {
        const chunks = [];
        let byteLength = 0;
        response.on('data', (chunk) => {
          byteLength += chunk.length;
          if (byteLength > MAX_RESPONSE_BYTES) {
            response.destroy(new Error('网页超过 2 MB 读取上限。'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on('error', reject);
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () =>
      request.destroy(new Error('读取网页超时。')),
    );
    const abortRequest = () =>
      request.destroy(
        signal.reason ??
          new DOMException('The operation was aborted', 'AbortError'),
      );
    signal?.addEventListener('abort', abortRequest, { once: true });
    request.on('error', reject);
    request.on('close', () => {
      signal?.removeEventListener('abort', abortRequest);
      agent.destroy();
    });
    request.end();
  });
}

async function fetchResponse(
  url,
  redirectsLeft = MAX_REDIRECTS,
  {
    lookupImpl = lookup,
    requestImpl = requestOnce,
    proxyConfiguredImpl = hasConfiguredProxy,
    allowedRedirectHosts = [],
    signal,
  } = {},
) {
  signal?.throwIfAborted();
  const hostname =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname;
  const proxyMappedAllowed =
    !ipaddr.isValid(hostname) &&
    allowedRedirectHosts.includes(url.hostname) &&
    proxyConfiguredImpl(url.protocol);
  const resolution = await resolvePublicAddresses(url.hostname, lookupImpl, {
    allowProxyMapped: proxyMappedAllowed,
  });
  signal?.throwIfAborted();
  const response = await requestImpl(url, resolution.records, { signal });
  signal?.throwIfAborted();
  if (REDIRECT_CODES.has(response.statusCode)) {
    if (redirectsLeft <= 0 || typeof response.headers.location !== 'string') {
      throw new Error('网页重定向过多或缺少目标地址。');
    }
    const next = validateUrl(new URL(response.headers.location, url).href);
    return fetchResponse(next, redirectsLeft - 1, {
      lookupImpl,
      requestImpl,
      proxyConfiguredImpl,
      allowedRedirectHosts,
      signal,
    });
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`网页返回 HTTP ${response.statusCode}。`);
  }
  const contentType = String(response.headers['content-type'] ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error('该链接不是支持的网页文本类型。');
  }
  return { ...response, contentType, finalUrl: url.href };
}

function decodeBody(body, contentTypeHeader) {
  const charset = /charset\s*=\s*["']?([^;"'\s]+)/iu.exec(
    contentTypeHeader ?? '',
  )?.[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

function extractPage(html, finalUrl, contentType) {
  if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
    const text = html.replace(/\s+/gu, ' ').trim();
    return { title: finalUrl, text };
  }
  const document = new JSDOM(html, { url: finalUrl }).window.document;
  const article = new Readability(document, {
    maxElemsToParse: 50_000,
    charThreshold: 200,
  }).parse();
  const title = article?.title?.trim() || document.title.trim() || finalUrl;
  const text = (article?.textContent || document.body?.textContent || '')
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return { title, text };
}

function citationUrl(value) {
  const url = new URL(value);
  for (const key of Array.from(url.searchParams.keys())) {
    if (
      /(?:token|secret|password|auth|signature|^sig$|api[-_]?key|access[-_]?key)/iu.test(
        key,
      )
    ) {
      url.searchParams.delete(key);
    }
  }
  url.hash = '';
  return url.href;
}

export function extractUserUrls(text) {
  const matches = String(text ?? '').match(/https?:\/\/[^\s<>"']+/giu) ?? [];
  const urls = matches
    .map((match) => match.replace(/[),.!?，。！？；;】}]+$/u, ''))
    .filter(Boolean);
  return [...new Set(urls)].slice(0, 3);
}
export async function fetchWebSource(value, dependencies = {}) {
  const requestedUrl = validateUrl(value);
  const response = await fetchResponse(
    requestedUrl,
    MAX_REDIRECTS,
    dependencies,
  );
  const html = decodeBody(response.body, response.headers['content-type']);
  const page = extractPage(html, response.finalUrl, response.contentType);
  if (!page.text) throw new Error('网页中没有可读取的正文。');
  const excerpt = page.text.slice(0, MAX_EXCERPT_LENGTH);
  return {
    source: {
      id: randomUUID(),
      title: page.title.slice(0, 500),
      url: citationUrl(response.finalUrl),
      fetchedAt: new Date().toISOString(),
      excerpt,
      truncated: page.text.length > excerpt.length,
    },
    content: excerpt,
  };
}
