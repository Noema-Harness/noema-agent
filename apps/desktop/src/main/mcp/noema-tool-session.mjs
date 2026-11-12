import { NoemaToolServer } from './noema-tool-server.mjs';

/**
 * Owns one loopback MCP server for one agent run. DSH receives only the
 * server descriptor; the bearer token stays in the main process.
 */
export class NoemaToolSession {
  #tools;
  #registry;
  #token;
  #server = null;
  #descriptor = null;

  /**
   * @param {{tools?:Array<object>,registry?:import('../runtime/noema-tool-registry.mjs').NoemaToolRegistry|null,token?:string}} [options]
   */
  constructor({ tools, registry = null, token } = {}) {
    if (tools !== undefined && registry !== null) {
      throw new TypeError(
        'NoemaToolSession accepts tools or registry, not both',
      );
    }
    this.#tools = tools;
    this.#registry = registry;
    this.#token = token;
  }

  #definitions() {
    return this.#registry ? this.#registry.list() : this.#tools;
  }

  get running() {
    return this.#server !== null;
  }

  get descriptor() {
    return this.#descriptor;
  }

  async start() {
    if (this.#server) return this.#descriptor;
    const server = new NoemaToolServer({
      tools: this.#definitions(),
      ...(this.#token ? { token: this.#token } : {}),
    });
    const url = await server.start();
    this.#server = server;
    this.#descriptor = Object.freeze({
      serverName: 'noema',
      url,
      headers: { Authorization: `Bearer ${server.token}` },
    });
    return this.#descriptor;
  }

  async close() {
    const server = this.#server;
    this.#server = null;
    this.#descriptor = null;
    if (server) await server.close();
  }
}

export function createNoemaToolSession(options) {
  return new NoemaToolSession(options);
}
