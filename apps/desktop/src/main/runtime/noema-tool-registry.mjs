const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Product-owned tool registry. It defines what Noema can do, independent of
 * the transport that exposes those tools to an agent runtime. MCP is one
 * binding; the native loop can call the same registry directly.
 */
export class NoemaToolRegistry {
  #tools = new Map();

  constructor(definitions = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition) {
    if (!definition || typeof definition !== 'object') {
      throw new TypeError('tool definition must be an object');
    }
    const { name, description, inputSchema, handler } = definition;
    if (typeof name !== 'string' || !TOOL_NAME.test(name)) {
      throw new TypeError('tool name is invalid');
    }
    if (typeof description !== 'string' || !description.trim()) {
      throw new TypeError(`tool ${name} requires a description`);
    }
    if (!inputSchema || typeof inputSchema !== 'object') {
      throw new TypeError(`tool ${name} requires an input schema`);
    }
    if (typeof handler !== 'function') {
      throw new TypeError(`tool ${name} requires a handler`);
    }
    if (this.#tools.has(name)) {
      throw new Error(`tool ${name} is already registered`);
    }
    this.#tools.set(
      name,
      Object.freeze({ ...definition, name, description, inputSchema, handler }),
    );
    return this;
  }

  get(name) {
    return this.#tools.get(name) ?? null;
  }

  list() {
    return [...this.#tools.values()];
  }

  async execute(name, args) {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);
    return tool.handler(args);
  }
}

export function createNoemaToolRegistry(definitions = []) {
  return new NoemaToolRegistry(definitions);
}
