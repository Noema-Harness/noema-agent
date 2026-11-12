import { randomUUID, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';

const MAX_BODY_BYTES = 1_000_000;

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('MCP request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('MCP request body is not valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function textContent(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value, null, 2);
}

/**
 * An authenticated, loopback-only MCP server that exposes Noema product tools
 * to one DSH session. The server never exposes the gateway itself: DSH sees
 * only the declared tools and their JSON schemas.
 */
export class NoemaToolServer {
  #tools;
  #token;
  #server = null;
  #sessions = new Map();

  constructor({ tools, token = randomUUID() } = {}) {
    if (!Array.isArray(tools) || tools.length === 0)
      throw new TypeError('At least one Noema tool is required.');
    const names = new Set();
    for (const tool of tools) {
      if (!tool?.name || !tool?.description || !tool?.inputSchema)
        throw new TypeError(
          'Each Noema tool needs name, description and inputSchema.',
        );
      if (names.has(tool.name))
        throw new TypeError(`Duplicate Noema tool: ${tool.name}`);
      if (typeof tool.handler !== 'function')
        throw new TypeError(`Noema tool ${tool.name} needs a handler.`);
      names.add(tool.name);
    }
    this.#tools = Object.freeze([...tools]);
    this.#token = token;
  }

  get token() {
    return this.#token;
  }

  get url() {
    const address = this.#server?.address();
    if (!address || typeof address === 'string') return null;
    return `http://127.0.0.1:${address.port}/mcp`;
  }

  async start() {
    if (this.#server) return this.url;
    this.#server = http.createServer((request, response) => {
      this.#handleRequest(request, response).catch((error) => {
        if (!response.headersSent) {
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: error.message },
              id: null,
            }),
          );
        } else {
          response.end();
        }
      });
    });
    await new Promise((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(0, '127.0.0.1', resolve);
    });
    return this.url;
  }

  async close() {
    for (const session of this.#sessions.values()) {
      await session.transport.close().catch(() => {});
    }
    this.#sessions.clear();
    await new Promise((resolve) => {
      if (!this.#server) return resolve();
      this.#server.close(() => resolve());
      this.#server = null;
    });
  }

  #authorized(request) {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer '))
      return false;
    const supplied = Buffer.from(header.slice(7));
    const expected = Buffer.from(this.#token);
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  }

  #createServer() {
    const server = new Server(
      { name: 'noema', version: '0.5.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.#tools.map(
        ({ name, description, inputSchema, annotations }) => ({
          name,
          description,
          inputSchema,
          ...(annotations ? { annotations } : {}),
        }),
      ),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = this.#tools.find(
        (candidate) => candidate.name === request.params.name,
      );
      if (!tool)
        return {
          content: [
            {
              type: 'text',
              text: `Unknown Noema tool: ${request.params.name}`,
            },
          ],
          isError: true,
        };
      try {
        const result = await tool.handler(request.params.arguments ?? {});
        return {
          content: [{ type: 'text', text: textContent(result) }],
          ...(result && typeof result === 'object' && result.isError
            ? { isError: true }
            : {}),
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        };
      }
    });
    return server;
  }

  async #handleRequest(request, response) {
    if (!this.#authorized(request)) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized' },
          id: null,
        }),
      );
      return;
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/mcp') {
      response.writeHead(404);
      response.end();
      return;
    }

    const sessionId = request.headers['mcp-session-id'];
    const existing =
      typeof sessionId === 'string' ? this.#sessions.get(sessionId) : null;
    if (existing) {
      const body =
        request.method === 'POST' ? await readBody(request) : undefined;
      await existing.transport.handleRequest(request, response, body);
      return;
    }

    if (request.method !== 'POST') {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Missing MCP session' },
          id: null,
        }),
      );
      return;
    }

    const body = await readBody(request);
    if (typeof sessionId === 'string' || !isInitializeRequest(body)) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Invalid MCP initialize request' },
          id: null,
        }),
      );
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        this.#sessions.set(newSessionId, { transport });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) this.#sessions.delete(transport.sessionId);
    };
    const server = this.#createServer();
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  }
}
