const DEFAULT_MODEL_BASE_URL = 'http://127.0.0.1:3001/v1';
// Keep routine turns within a modest free-route output budget; callers may
// explicitly raise it for work that needs a longer response.
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
// Bound both streamed deltas and buffered router replies if a gateway ignores
// max_tokens or never sends the terminal SSE marker.
const MAX_MODEL_RESPONSE_BYTES = 1_000_000;

/** @param {string} baseUrl */
export function getProviderName(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname;
    if (hostname === 'api.deepseek.com') return 'DeepSeek';
    if (['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)) {
      return '本机模型服务';
    }
  } catch {
    // The configured endpoint will be reported as unavailable by the client.
  }
  return 'OpenAI 兼容服务';
}

const VERIFIED_FREE_MODELS = new Map([
  [
    'auto:noema-free',
    {
      name: 'auto:noema-free',
      label: 'Noema 免费模型链 · 自动路由',
      routeKind: 'router',
    },
  ],
  [
    'free-router',
    {
      name: 'free-router',
      label: 'FreeLLMAPI 免费路由 · 自动',
      routeKind: 'router',
    },
  ],
  [
    'kilo-auto/free',
    {
      name: 'kilo-auto/free',
      label: 'Kilo 免费自动路由',
      routeKind: 'router',
    },
  ],
  [
    'nemotron-3-super-120b',
    {
      name: 'nvidia/nemotron-3-super-120b-a12b:free',
      label: 'Nemotron 3 Super 120B · 免费',
      routeKind: 'direct',
    },
  ],
  [
    'nvidia/nemotron-3.5-lightning',
    {
      name: 'nvidia/nemotron-3.5-lightning',
      label: 'Nemotron 3.5 Lightning · 免费',
      routeKind: 'direct',
    },
  ],
  [
    'cohere/north-mini-code',
    {
      name: 'cohere/north-mini-code',
      label: 'Cohere North Mini Code · 免费',
      routeKind: 'direct',
    },
  ],
  [
    'nvidia/llama-3.2-11b-vision',
    {
      name: 'nvidia/llama-3.2-11b-vision',
      label: 'NVIDIA Llama 3.2 11B · 免费',
      routeKind: 'direct',
    },
  ],
]);

export class ModelProviderError extends Error {
  /** @param {string} code @param {string} message @param {number|null} [status] @param {number|null} [retryAfterSeconds] @param {string|null} [transportCode] */
  constructor(
    code,
    message,
    status = null,
    retryAfterSeconds = null,
    transportCode = null,
  ) {
    super(message);
    this.name = 'ModelProviderError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.transportCode = transportCode;
  }
}

/** @param {string} value */
export function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ModelProviderError(
      'invalid_base_url',
      '模型服务地址格式不正确。',
    );
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ModelProviderError(
      'invalid_base_url',
      '模型服务地址必须使用 HTTP 或 HTTPS。',
    );
  }
  if (url.username || url.password) {
    throw new ModelProviderError(
      'invalid_base_url',
      '请勿将凭据写入模型服务地址。',
    );
  }
  const localHost = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(
    url.hostname,
  );
  if (url.protocol === 'http:' && !localHost) {
    throw new ModelProviderError(
      'insecure_transport',
      '远程模型服务必须使用 HTTPS；HTTP 仅允许本机服务。',
    );
  }
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = basePath.endsWith('/v1') ? basePath : `${basePath}/v1`;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export class OpenAICompatibleClient {
  /** @param {{baseUrl?:string,getApiKey:()=>string|null,fetchImpl?:typeof fetch}} options */
  constructor({
    baseUrl = DEFAULT_MODEL_BASE_URL,
    getApiKey,
    fetchImpl = fetch,
  }) {
    if (typeof getApiKey !== 'function') {
      throw new TypeError('The model provider requires an API key provider');
    }
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.getApiKey = getApiKey;
    this.fetch = fetchImpl;
  }

  setBaseUrl(baseUrl) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    return this.baseUrl;
  }

  /**
   * @returns {Promise<Array<{
   *   name:string,
   *   label:string,
   *   routeKind:'router'|'direct',
   *   executionStatus:'ready'|'needsKey'|'exhausted'|null
   * }>>}
   */
  async listModels() {
    const key = this.requireApiKey();
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError') {
        throw new ModelProviderError(
          'gateway_timeout',
          '连接模型服务超时。请确认服务正在运行。',
        );
      }
      const failure = describeTransportFailure(error);
      throw new ModelProviderError(
        'gateway_unavailable',
        `无法连接模型服务${failure.suffix}。请检查地址和网络后重试。`,
        null,
        null,
        failure.code,
      );
    }
    if (!response.ok) throw await mapHttpError(response);

    let body;
    try {
      body = await response.json();
    } catch {
      throw new ModelProviderError(
        'invalid_response',
        '模型服务返回的模型列表无法读取。',
      );
    }
    if (!Array.isArray(body?.data)) {
      throw new ModelProviderError(
        'invalid_response',
        '模型服务返回的模型列表格式不正确。',
      );
    }

    const available = new Map(
      body.data
        .filter(
          (model) => typeof model?.id === 'string' && model.available !== false,
        )
        .map((model) => [model.id, model]),
    );
    const verifiedFreeModels = [...VERIFIED_FREE_MODELS.entries()]
      .filter(([catalogId]) => available.has(catalogId))
      .map(([catalogId, model]) => {
        const status = available.get(catalogId)?.execution_status;
        const executionStatus = ['ready', 'needsKey', 'exhausted'].includes(
          status,
        )
          ? status
          : null;
        return { ...model, executionStatus };
      });
    if (
      verifiedFreeModels.length > 0 ||
      body.data.some(
        (model) =>
          model?.available === false ||
          typeof model?.execution_status === 'string',
      )
    ) {
      return verifiedFreeModels;
    }

    // A standard OpenAI-compatible provider exposes its own model catalog.
    // Preserve those provider IDs instead of filtering them through Noema's
    // FreeLLMAPI-specific free-route allowlist.
    return [...available.values()].map((model) => ({
      name: model.id,
      label: model.id,
      routeKind: 'direct',
      executionStatus: 'ready',
    }));
  }

  /**
   * Streams text deltas from an OpenAI-compatible chat endpoint.
   * @param {{model:string,messages:Array<object>,signal:AbortSignal,maxTokens?:number,tools?:Array<object>,onToolCalls?:(calls:Array<object>)=>void,onRouteMetadata?:(route:string|null)=>void}} input
   * @returns {AsyncGenerator<string,void,void>}
   */
  async *streamChat({
    model,
    messages,
    signal,
    maxTokens = DEFAULT_MAX_OUTPUT_TOKENS,
    tools,
    onToolCalls = () => {},
    onRouteMetadata = () => {},
  }) {
    const key = this.requireApiKey();
    // FreeLLMAPI can fail over while a routed response is still buffered, but
    // cannot replace a provider after streamed text has been committed. Router
    // aliases therefore use a complete response; pinned direct models still
    // stream normally.
    const useBufferedRouterResponse =
      VERIFIED_FREE_MODELS.get(model)?.routeKind === 'router';
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          accept: 'text/event-stream',
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          stream: !useBufferedRouterResponse,
          max_tokens: maxTokens,
          ...(new URL(this.baseUrl).hostname === 'api.deepseek.com'
            ? { thinking: { type: 'disabled' } }
            : {}),
          ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') throw error;
      if (error?.name === 'TimeoutError') {
        throw new ModelProviderError(
          'request_timeout',
          '模型服务请求超时。消息已保留，可以重试。',
        );
      }
      const failure = describeTransportFailure(error);
      throw new ModelProviderError(
        'gateway_unavailable',
        `无法连接模型服务${failure.suffix}。消息已保留，请检查网络后重试。`,
        null,
        null,
        failure.code,
      );
    }
    if (!response.ok) throw await mapHttpError(response);
    if (!response.body) {
      throw new ModelProviderError(
        'invalid_response',
        '模型服务没有返回可读取的回复流。',
      );
    }

    const routeHeader = response.headers.get('x-routed-via')?.trim();
    let routedVia = routeHeader || null;
    if (routedVia) {
      try {
        routedVia = decodeURIComponent(routedVia);
      } catch {
        // Keep the gateway's literal value if its percent-encoding is malformed.
      }
    }
    onRouteMetadata(routedVia);

    if (useBufferedRouterResponse) {
      let body;
      try {
        body = JSON.parse(await readBoundedResponseText(response));
      } catch (error) {
        if (error instanceof ModelProviderError) throw error;
        throw new ModelProviderError(
          'invalid_response',
          '模型服务返回了无法读取的完整回复。消息已保留，可以重试。',
        );
      }
      if (body?.error) {
        throw new ModelProviderError(
          'provider_error',
          '模型服务未能完成请求。可以稍后重试或切换模型。',
        );
      }
      const choice = body?.choices?.[0];
      const text = extractMessageText(choice?.message);
      const calls = choice?.message?.tool_calls;
      if (Array.isArray(calls) && calls.length) {
        onToolCalls(
          finalizeToolCalls(new Map(calls.map((call, index) => [index, call]))),
        );
      }
      if (text) yield text;
      if (!text && (!Array.isArray(calls) || calls.length === 0)) {
        throw new ModelProviderError(
          'empty_reply',
          '模型没有返回文字或工具调用。消息已保留，可以重试。',
        );
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let sawDone = false;
    let totalBytes = 0;
    const toolCalls = new Map();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > MAX_MODEL_RESPONSE_BYTES) {
            throw new ModelProviderError(
              'response_too_large',
              '模型回复超过安全读取上限；没有执行其中的工具调用。',
            );
          }
        }
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          if (isSseDone(line)) {
            sawDone = true;
            break;
          }
          const payload = parseSseDataLine(line);
          if (!payload) continue;
          const text = extractTextDelta(payload);
          if (text) yield text;
          collectToolCallDeltas(payload, toolCalls);
        }
        if (sawDone) break;
        if (done) break;
      }
      const finalLine = pending.trim();
      if (!sawDone && isSseDone(finalLine)) {
        sawDone = true;
      } else if (!sawDone && finalLine) {
        const payload = parseSseDataLine(finalLine);
        if (payload) {
          const text = extractTextDelta(payload);
          if (text) yield text;
          collectToolCallDeltas(payload, toolCalls);
        }
      }
      if (!sawDone) {
        throw new ModelProviderError(
          'incomplete_stream',
          '模型回复流意外中断，未收到完整结束标记。消息已保留，可以重试。',
        );
      }
      if (toolCalls.size) onToolCalls(finalizeToolCalls(toolCalls));
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') throw error;
      if (error instanceof ModelProviderError) throw error;
      const failure = describeTransportFailure(error);
      if (
        error instanceof TypeError ||
        error?.name === 'NetworkError' ||
        failure.code?.startsWith('ERR_')
      ) {
        throw new ModelProviderError(
          'provider_unavailable',
          '模型回复流连接中断。已收到的内容会保留；是否安全重试由当前会话决定。',
          null,
          null,
          failure.code,
        );
      }
      throw error;
    } finally {
      if (!sawDone) {
        try {
          await reader.cancel();
        } catch {
          /* the transport may already be closed */
        }
      }
      try {
        reader.releaseLock();
      } catch {
        /* the stream may already have released its lock */
      }
    }
  }

  requireApiKey() {
    const key = this.getApiKey();
    if (typeof key !== 'string' || !key.trim()) {
      throw new ModelProviderError(
        'credentials_missing',
        '还没有连接模型服务。打开模型设置并保存 API Key。',
      );
    }
    return key;
  }
}

/** @param {string} line */
function parseSseDataLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === '[DONE]') return null;

  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    throw new ModelProviderError(
      'invalid_stream',
      '模型服务返回了无法解析的回复片段。',
    );
  }
  if (payload?.error) {
    throw new ModelProviderError(
      'provider_error',
      '模型服务未能完成请求。可以稍后重试或切换模型。',
    );
  }
  return payload;
}

function isSseDone(line) {
  return line.trim() === 'data: [DONE]';
}

function extractTextDelta(payload) {
  const content = payload?.choices?.[0]?.delta?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }
  return '';
}

function extractMessageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }
  return '';
}

function collectToolCallDeltas(payload, toolCalls) {
  const deltas = payload?.choices?.[0]?.delta?.tool_calls;
  if (!Array.isArray(deltas)) return;
  for (const delta of deltas) {
    const index = Number.isInteger(delta?.index) ? delta.index : 0;
    let call = toolCalls.get(index);
    if (!call) {
      call = {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      };
      toolCalls.set(index, call);
    }
    if (typeof delta.id === 'string') call.id += delta.id;
    if (typeof delta.function?.name === 'string') {
      call.function.name += delta.function.name;
    }
    if (typeof delta.function?.arguments === 'string') {
      call.function.arguments += delta.function.arguments;
    }
  }
}

function finalizeToolCalls(toolCalls) {
  return [...toolCalls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, call]) => {
      if (!call.id || !call.function.name) {
        throw new ModelProviderError(
          'invalid_tool_call',
          '模型服务返回了不完整的工具调用。消息已保留，可以重试。',
        );
      }
      try {
        JSON.parse(call.function.arguments);
      } catch {
        throw new ModelProviderError(
          'invalid_tool_call',
          '模型服务返回了无法解析的工具参数。消息已保留，可以重试。',
        );
      }
      return call;
    });
}

async function readBoundedResponseText(response) {
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_MODEL_RESPONSE_BYTES) {
        throw new ModelProviderError(
          'response_too_large',
          '模型回复超过安全读取上限；没有执行其中的工具调用。',
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      /* the transport may already be closed */
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* the stream may already have released its lock */
    }
  }
}

/** @param {Response} response */
async function mapHttpError(response) {
  switch (response.status) {
    case 401:
    case 403:
      return new ModelProviderError(
        'invalid_api_key',
        '模型服务 API Key 无效或已撤销。请在模型设置中更新。',
        response.status,
      );
    case 404:
      return new ModelProviderError(
        'model_unavailable',
        '所选模型当前不可用。刷新模型列表并选择其他模型。',
        response.status,
      );
    case 429:
      return new ModelProviderError(
        'rate_limited',
        '模型服务额度暂时受限。稍后重试，或切换其他模型。',
        response.status,
        parseRetryAfterSeconds(response.headers.get('retry-after')),
      );
    case 413:
      return new ModelProviderError(
        'request_too_large',
        '模型服务拒绝了过大的请求（例如上下文或速率预算超限）。请缩小委托内容，或等待额度恢复后再试；已完成的工作仍会保留。',
        response.status,
      );
    case 502:
    case 503:
      return new ModelProviderError(
        'provider_unavailable',
        '模型服务已收到请求，但没有返回结果。稍后重试或切换模型。',
        response.status,
      );
    default:
      return new ModelProviderError(
        'gateway_http_error',
        `模型服务返回 HTTP ${response.status}。消息已保留，可以重试。`,
        response.status,
      );
  }
}

function parseRetryAfterSeconds(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const seconds = /^\d+$/u.test(value.trim())
    ? Number(value.trim())
    : Math.ceil((Date.parse(value) - now) / 1_000);
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 120
    ? seconds
    : null;
}

function describeTransportFailure(error) {
  const code =
    [error?.cause?.code, error?.code].find(
      (candidate) =>
        typeof candidate === 'string' &&
        /^[A-Z][A-Z0-9_]{1,47}$/u.test(candidate),
    ) ??
    (typeof error?.message === 'string'
      ? error.message.match(/(?:net::)?(ERR_[A-Z0-9_]{1,47})/u)?.[1]
      : null) ??
    null;
  const description = {
    ECONNRESET: '（连接被对端重置，ECONNRESET）',
    ECONNREFUSED: '（目标服务拒绝连接，ECONNREFUSED）',
    ENOTFOUND: '（域名解析失败，ENOTFOUND）',
    EAI_AGAIN: '（域名解析暂时失败，EAI_AGAIN）',
    ETIMEDOUT: '（网络连接超时，ETIMEDOUT）',
    CERT_HAS_EXPIRED: '（TLS 证书已过期，CERT_HAS_EXPIRED）',
    ERR_TLS_CERT_ALTNAME_INVALID:
      '（TLS 证书名称不匹配，ERR_TLS_CERT_ALTNAME_INVALID）',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE:
      '（TLS 证书验证失败，UNABLE_TO_VERIFY_LEAF_SIGNATURE）',
  }[code];
  return {
    code,
    suffix: description ?? (code ? `（网络错误：${code}）` : ''),
  };
}

export { DEFAULT_MODEL_BASE_URL, VERIFIED_FREE_MODELS };
