/**
 * Transport-neutral registry of bridge channels.
 *
 * The Electron host binds this router to `ipcMain`; a remote or companion host
 * binds the same router to its own message transport. Handlers and their
 * arguments stay identical either way, so the Desktop path is not special.
 */
export type BridgeChannelHandler = (...args: unknown[]) => unknown;

export interface BridgeRouter {
  /** Registers one channel; duplicate registration is a wiring bug. */
  handle(channel: string, handler: BridgeChannelHandler): void;
  has(channel: string): boolean;
  /** Channels in registration order; hosts bind exactly these. */
  readonly channels: string[];
  /** One request round-trip; arguments are forwarded positionally. */
  dispatch(channel: string, args?: unknown[]): Promise<unknown>;
}

export function createBridgeRouter(): BridgeRouter {
  const handlers = new Map<string, BridgeChannelHandler>();
  return {
    handle(channel, handler) {
      if (handlers.has(channel))
        throw new Error(`bridge channel already registered: ${channel}`);
      handlers.set(channel, handler);
    },
    has: (channel) => handlers.has(channel),
    get channels() {
      return [...handlers.keys()];
    },
    async dispatch(channel, args = []) {
      const handler = handlers.get(channel);
      if (handler === undefined)
        throw new Error(`unknown bridge channel: ${channel}`);
      return handler(...args);
    },
  };
}
