const DEFAULT_BASE_URL = 'http://127.0.0.1:3001/v1';

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

export class FreeLLMAPIError extends Error {
  /** @param {string} code @param {string} message @param {number|null} [status] */
  constructor(code, message, status = null) {
    super(message);
    this.name = 'FreeLLMAPIError';
    this.code = code;
    this.status = status;
  }
}

/** @param {string} value */
export function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new FreeLLMAPIError(
      'invalid_base_url',
      'FreeLLMAPI 地址格式不正确。',
    );
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new FreeLLMAPIError(
      'invalid_base_url',
      'FreeLLMAPI 地址必须使用 HTTP 或 HTTPS。',
    );
  }
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) {
    throw new FreeLLMAPIError(
      'non_local_base_url',
      'Noema 目前只接受本机 FreeLLMAPI 地址，避免把 API Key 发往外部服务器。',
    );
  }
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = basePath.endsWith('/v1') ? basePath : `${basePath}/v1`;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export class FreeLLMAPIClient {
  /** @param {{baseUrl?:string,getApiKey:()=>string|null,fetchImpl?:typeof fetch}} options */
  constructor({ baseUrl = DEFAULT_BASE_URL, getApiKey, fetchImpl = fetch }) {
    if (typeof getApiKey !== 'function') {
      throw new TypeError('FreeLLMAPI requires an API key provider');
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
      response = await this.fetch(`${this.baseUrl}/models?available=true`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError') {
        throw new FreeLLMAPIError(
          'gateway_timeout',
          '连接 FreeLLMAPI 超时。请确认桌面应用已启动。',
        );
      }
      throw new FreeLLMAPIError(
        'gateway_unavailable',
        '无法连接本机 FreeLLMAPI。请启动 FreeLLMAPI 后重试。',
      );
    }
    if (!response.ok) throw await mapHttpError(response);

    let body;
    try {
      body = await response.json();
    } catch {
      throw new FreeLLMAPIError(
        'invalid_response',
        'FreeLLMAPI 返回的模型列表无法读取。',
      );
    }
    if (!Array.isArray(body?.data)) {
      throw new FreeLLMAPIError(
        'invalid_response',
        'FreeLLMAPI 返回的模型列表格式不正确。',
      );
    }

    const available = new Map(
      body.data
        .filter(
          (model) => typeof model?.id === 'string' && model.available !== false,
        )
        .map((model) => [model.id, model]),
    );
    return [...VERIFIED_FREE_MODELS.entries()]
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
  }

  /**
   * Streams text deltas from FreeLLMAPI's OpenAI-compatible chat endpoint.
   * @param {{model:string,messages:Array<object>,signal:AbortSignal,maxTokens?:number,tools?:Array<object>,onToolCalls?:(calls:Array<object>)=>void,onRouteMetadata?:(route:string|null)=>void}} input
   * @returns {AsyncGenerator<string,void,void>}
   */
  async *streamChat({
    model,
    messages,
    signal,
    maxTokens = 4096,
    tools,
    onToolCalls = () => {},
    onRouteMetadata = () => {},
  }) {
    const key = this.requireApiKey();
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
          stream: true,
          max_tokens: maxTokens,
          ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') throw error;
      if (error?.name === 'TimeoutError') {
        throw new FreeLLMAPIError(
          'request_timeout',
          'FreeLLMAPI 请求超时。消息已保留，可以重试。',
        );
      }
      throw new FreeLLMAPIError(
        'gateway_unavailable',
        '无法连接本机 FreeLLMAPI。消息已保留，可以重试。',
      );
    }
    if (!response.ok) throw await mapHttpError(response);
    if (!response.body) {
      throw new FreeLLMAPIError(
        'invalid_response',
        'FreeLLMAPI 没有返回可读取的回复流。',
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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const toolCalls = new Map();
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const payload = parseSseDataLine(line);
          if (!payload) continue;
          const text = extractTextDelta(payload);
          if (text) yield text;
          collectToolCallDeltas(payload, toolCalls);
        }
        if (done) break;
      }
      const finalLine = pending.trim();
      if (finalLine) {
        const payload = parseSseDataLine(finalLine);
        if (payload) {
          const text = extractTextDelta(payload);
          if (text) yield text;
          collectToolCallDeltas(payload, toolCalls);
        }
      }
      if (toolCalls.size) onToolCalls(finalizeToolCalls(toolCalls));
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') throw error;
      throw error;
    } finally {
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
      throw new FreeLLMAPIError(
        'credentials_missing',
        '还没有连接 FreeLLMAPI。打开模型设置并保存统一 API Key。',
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
    throw new FreeLLMAPIError(
      'invalid_stream',
      'FreeLLMAPI 返回了无法解析的回复片段。',
    );
  }
  if (payload?.error) {
    throw new FreeLLMAPIError(
      'provider_error',
      'FreeLLMAPI 当前免费模型路由未能完成请求。可以稍后重试或切换免费模型。',
    );
  }
  return payload;
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
        throw new FreeLLMAPIError(
          'invalid_tool_call',
          '免费模型返回了不完整的工具调用。消息已保留，可以重试。',
        );
      }
      try {
        JSON.parse(call.function.arguments);
      } catch {
        throw new FreeLLMAPIError(
          'invalid_tool_call',
          '免费模型返回了无法解析的工具参数。消息已保留，可以重试。',
        );
      }
      return call;
    });
}

/** @param {Response} response */
async function mapHttpError(response) {
  switch (response.status) {
    case 401:
    case 403:
      return new FreeLLMAPIError(
        'invalid_api_key',
        'FreeLLMAPI API Key 无效或已撤销。请在模型设置中更新。',
        response.status,
      );
    case 404:
      return new FreeLLMAPIError(
        'model_unavailable',
        '所选免费模型当前不可用。刷新模型列表并选择其他免费模型。',
        response.status,
      );
    case 429:
      return new FreeLLMAPIError(
        'rate_limited',
        'FreeLLMAPI 免费模型额度暂时受限。稍后重试，或切换到其他免费模型。',
        response.status,
      );
    case 502:
    case 503:
      return new FreeLLMAPIError(
        'provider_unavailable',
        'FreeLLMAPI 已收到请求，但当前免费模型供应商没有返回结果。稍后重试或切换免费模型。',
        response.status,
      );
    default:
      return new FreeLLMAPIError(
        'gateway_http_error',
        `FreeLLMAPI 返回 HTTP ${response.status}。消息已保留，可以重试。`,
        response.status,
      );
  }
}

export { DEFAULT_BASE_URL, VERIFIED_FREE_MODELS };
