const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

export class OllamaError extends Error {
  /** @param {string} code @param {string} message @param {number | null} [status] */
  constructor(code, message, status = null) {
    super(message);
    this.name = 'OllamaError';
    this.code = code;
    this.status = status;
  }
}

/** @param {string} message @returns {OllamaError} */
function unavailable(
  message = '无法连接本机 Ollama。请确认 Ollama 已启动后重试。',
) {
  return new OllamaError('ollama_unavailable', message);
}

/** @param {string} input */
function normalizeBaseUrl(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new TypeError('Ollama URL must use HTTP or HTTPS');
  return url.toString().replace(/\/$/, '');
}

export class OllamaClient {
  /** @param {{baseUrl?: string, fetchImpl?: typeof fetch}} [options] */
  constructor({ baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetch = fetchImpl;
  }

  async listModels() {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError')
        throw unavailable('连接本机 Ollama 超时。请检查服务是否正常运行。');
      throw unavailable();
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new OllamaError(
        'ollama_http_error',
        `Ollama 返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 300)}` : ''}`,
        response.status,
      );
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new OllamaError(
        'ollama_invalid_response',
        'Ollama 返回的模型列表无法读取。',
      );
    }
    if (!body || !Array.isArray(body.models)) {
      throw new OllamaError(
        'ollama_invalid_response',
        'Ollama 返回的模型列表格式不正确。',
      );
    }
    return body.models
      .filter(
        (model) => typeof model?.name === 'string' && model.name.length > 0,
      )
      .map((model) => ({
        name: model.name,
        size: Number.isFinite(model.size) ? model.size : null,
        modifiedAt:
          typeof model.modified_at === 'string' ? model.modified_at : null,
      }));
  }

  /**
   * Streams text deltas from Ollama's newline-delimited /api/chat response.
   * @param {{model: string, messages: Array<{role: 'system'|'user'|'assistant', content: string}>, signal: AbortSignal}} input
   * @returns {AsyncGenerator<string, void, void>}
   */
  async *streamChat({ model, messages, signal, numCtx = 16_384 }) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          accept: 'application/x-ndjson',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          options: { num_ctx: numCtx },
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') throw error;
      if (error?.name === 'TimeoutError')
        throw unavailable('连接本机 Ollama 超时。');
      throw unavailable();
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 404 && /model/i.test(detail)) {
        throw new OllamaError(
          'model_missing',
          '所选模型已不在本机。请刷新模型列表并选择已安装的模型。',
          404,
        );
      }
      throw new OllamaError(
        'ollama_http_error',
        `Ollama 返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 300)}` : ''}`,
        response.status,
      );
    }
    if (!response.body)
      throw new OllamaError(
        'ollama_invalid_response',
        'Ollama 没有返回可读取的响应流。',
      );

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const delta = parseChatLine(line);
          if (delta !== null) yield delta;
        }
        if (done) break;
      }
      const finalLine = pending.trim();
      if (finalLine) {
        const delta = parseChatLine(finalLine);
        if (delta !== null) yield delta;
      }
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
}

/** @param {string} line */
function parseChatLine(line) {
  const text = line.trim();
  if (!text) return null;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new OllamaError(
      'ollama_invalid_response',
      'Ollama 返回了无法解析的流数据。',
    );
  }
  if (typeof payload.error === 'string') {
    if (/model.*not found|model.*does not exist/i.test(payload.error)) {
      throw new OllamaError(
        'model_missing',
        '所选模型不在本机。请刷新模型列表并选择已安装的模型。',
      );
    }
    throw new OllamaError(
      'ollama_model_error',
      `本机模型无法完成回复：${payload.error.slice(0, 300)}`,
    );
  }
  const content = payload.message?.content;
  if (content !== undefined && typeof content !== 'string') {
    throw new OllamaError(
      'ollama_invalid_response',
      'Ollama 返回了不正确的消息内容。',
    );
  }
  return content || null;
}

export { DEFAULT_BASE_URL };
