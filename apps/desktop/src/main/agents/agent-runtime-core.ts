/**
 * Immutable execution identity for every Noema agent.
 *
 * Product roles (Noema, executor, specialist, management) are templates above
 * this core. The core owns only what must never be silently replaced: identity,
 * private environment, grants, runtime adapter and an append-only event log.
 * It deliberately knows nothing about jobs, teams, projects or the renderer.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export const AGENT_RUNTIME_CORE_VERSION = 1;

const AGENT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u;

// Method syntax keeps the parameter bivariant: backends declare their own
// option shape, and the core only adds its identity fields on top.
type AgentRuntimeBackend = {
  kind: string;
  streamChat(options: object): AsyncIterable<string>;
};

export type AgentCore = Readonly<{
  version: number;
  agentId: string;
  role: string;
  name: string;
  lifecycle: string;
  homePath: string;
  workspacePath: string | null;
  memoryNamespace: string;
  sessionNamespace: string;
  runtime: Readonly<{ kind: string }>;
  grants: Readonly<Record<string, boolean>>;
  eventLogPath: string;
}>;

export type AgentEvent = {
  seq: number;
  at: string;
  type: string;
  payload: object;
};

function assertString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function assertAbsolutePath(value: string, label: string) {
  assertString(value, label);
  if (!isAbsolute(value)) throw new TypeError(`${label} must be absolute`);
  return value;
}

function normalizeGrants(grants: unknown): Readonly<Record<string, boolean>> {
  if (grants == null) return Object.freeze({});
  if (typeof grants !== 'object' || Array.isArray(grants)) {
    throw new TypeError('grants must be an object');
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(grants).map(([key, value]) => {
        assertString(key, 'grant name');
        if (typeof value !== 'boolean') {
          throw new TypeError(`grant "${key}" must be boolean`);
        }
        return [key, value];
      }),
    ),
  );
}

function normalizeEventPayload(payload: unknown): object {
  if (payload == null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('event payload must be an object');
  }
  // JSON.Text is the durable event format; fail now instead of writing a
  // partial line when the payload is not serializable.
  JSON.stringify(payload);
  return payload;
}

function parseEventLines(raw: string, eventLogPath: string) {
  const events: AgentEvent[] = [];
  for (const [index, line] of raw.split(/\r?\n/u).entries()) {
    if (line.trim() === '') continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(
        `invalid agent event log at ${eventLogPath}:${index + 1}`,
      );
    }
    if (
      !Number.isSafeInteger(event?.seq) ||
      event.seq < 1 ||
      typeof event?.type !== 'string' ||
      typeof event?.at !== 'string' ||
      typeof event?.payload !== 'object' ||
      event.payload === null ||
      Array.isArray(event.payload)
    ) {
      throw new Error(
        `invalid agent event entry at ${eventLogPath}:${index + 1}`,
      );
    }
    events.push(event);
  }
  return events;
}

export class AgentRuntimeCore {
  #core: AgentCore;
  #runtime: AgentRuntimeBackend;
  #eventLogPath: string;
  #sequence: number;
  #now: () => Date;
  #appendQueue = Promise.resolve();

  /**
   */
  constructor({
    core,
    runtime,
    eventLogPath,
    sequence,
    now,
  }: {
    core: AgentCore;
    runtime: AgentRuntimeBackend;
    eventLogPath: string;
    sequence: number;
    now: () => Date;
  }) {
    this.#core = core;
    this.#runtime = runtime;
    this.#eventLogPath = eventLogPath;
    this.#sequence = sequence;
    this.#now = now;
  }

  get core() {
    return this.#core;
  }

  snapshot() {
    return {
      core: this.#core,
      eventCount: this.#sequence,
      eventLogPath: this.#eventLogPath,
    };
  }

  /**
   * Append one durable event. There is intentionally no update or delete API.
   */
  async appendEvent(
    { type, payload = {} }: { type: string; payload?: object } = {} as {
      type: string;
    },
  ) {
    assertString(type, 'event type');
    if (!EVENT_TYPE_PATTERN.test(type)) {
      throw new TypeError(`invalid event type "${type}"`);
    }
    const event = {
      seq: this.#sequence + 1,
      at: this.#now().toISOString(),
      type,
      payload: normalizeEventPayload(payload),
    };
    const line = `${JSON.stringify(event)}\n`;
    this.#sequence = event.seq;
    this.#appendQueue = this.#appendQueue.then(() =>
      appendFile(this.#eventLogPath, line, 'utf8'),
    );
    await this.#appendQueue;
    return structuredClone(event);
  }

  /**
   * Read events in append order. `after` is an exclusive sequence cursor.
   */
  async readEvents({
    after = 0,
    limit = Number.MAX_SAFE_INTEGER,
  }: { after?: number; limit?: number } = {}) {
    if (!Number.isSafeInteger(after) || after < 0) {
      throw new TypeError('after must be a non-negative integer');
    }
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new TypeError('limit must be a non-negative integer');
    }
    await this.#appendQueue;
    let raw;
    try {
      raw = await readFile(this.#eventLogPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
      throw error;
    }
    return parseEventLines(raw, this.#eventLogPath)
      .filter((event) => event.seq > after)
      .slice(0, limit);
  }

  /**
   * Delegate to the configured execution backend with this agent's immutable
   * environment attached. The backend may be native or DSH; the core does not
   * branch on either.
   */
  streamChat(options: object = {}) {
    return this.#runtime.streamChat({
      ...options,
      agentId: this.#core.agentId,
      memoryNamespace: this.#core.memoryNamespace,
      workspacePath: this.#core.workspacePath,
    });
  }
}

/**
 * Create one agent's immutable core. The caller supplies paths so the core has
 * no dependency on Electron, userData layout, projects or the job library.
 */
export async function createAgentRuntimeCore({
  agentId,
  role,
  name,
  homePath,
  workspacePath = null,
  memoryNamespace = null,
  grants = {},
  runtime,
  now = () => new Date(),
}: {
  agentId: string;
  role: string;
  name: string;
  homePath: string;
  workspacePath?: string | null;
  memoryNamespace?: string | null;
  grants?: Record<string, boolean> | null;
  runtime: AgentRuntimeBackend;
  now?: () => Date;
}) {
  assertString(agentId, 'agentId');
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new TypeError(`invalid agentId "${agentId}"`);
  }
  assertString(role, 'role');
  assertString(name, 'name');
  assertAbsolutePath(homePath, 'homePath');
  if (workspacePath !== null) {
    assertAbsolutePath(workspacePath, 'workspacePath');
  }
  if (!runtime || typeof runtime.streamChat !== 'function') {
    throw new TypeError('runtime must expose streamChat');
  }
  if (typeof runtime.kind !== 'string' || runtime.kind === '') {
    throw new TypeError('runtime must expose a kind');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  const namespace =
    memoryNamespace === null ? `agent:${agentId}` : memoryNamespace;
  assertString(namespace, 'memoryNamespace');

  await mkdir(homePath, { recursive: true });
  const eventLogPath = join(homePath, 'events.jsonl');

  let sequence = 0;
  try {
    const raw = await readFile(eventLogPath, 'utf8');
    const events = parseEventLines(raw, eventLogPath);
    sequence = events.at(-1)?.seq ?? 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }

  const core = Object.freeze({
    version: AGENT_RUNTIME_CORE_VERSION,
    agentId,
    role,
    name,
    lifecycle: 'active',
    homePath,
    workspacePath,
    memoryNamespace: namespace,
    sessionNamespace: `agent:${agentId}`,
    runtime: Object.freeze({ kind: runtime.kind }),
    grants: normalizeGrants(grants),
    eventLogPath,
  });

  return new AgentRuntimeCore({
    core,
    runtime,
    eventLogPath,
    sequence,
    now,
  });
}

/**
 * Create Noema and one executor as separate agents. They share no home,
 * workspace, memory namespace or event log; only the backend runtime may be
 * shared. This is the stage-1 proof that role is not identity.
 */
export async function createAgentRuntimePair({
  userDataPath,
  noemaRuntime,
  executorRuntime,
}: {
  userDataPath: string;
  noemaRuntime: AgentRuntimeBackend;
  executorRuntime: AgentRuntimeBackend;
}) {
  assertAbsolutePath(userDataPath, 'userDataPath');
  const homeRoot = join(userDataPath, 'agents');
  const executorHome = join(homeRoot, 'noema-executor');
  const executorWorkspace = join(executorHome, 'workspace');
  await mkdir(executorWorkspace, { recursive: true });

  const noema = await createAgentRuntimeCore({
    agentId: 'noema',
    role: 'personal',
    name: 'Noema',
    homePath: join(homeRoot, 'noema'),
    workspacePath: null,
    memoryNamespace: 'agent:noema',
    grants: { projectWork: true, externalFiles: false, network: false },
    runtime: noemaRuntime,
  });
  const executor = await createAgentRuntimeCore({
    agentId: 'noema-executor',
    role: 'executor',
    name: '执行者',
    homePath: executorHome,
    workspacePath: executorWorkspace,
    memoryNamespace: 'agent:noema-executor',
    grants: { projectWork: true, externalFiles: true, network: false },
    runtime: executorRuntime,
  });

  return Object.freeze({ noema, executor });
}
