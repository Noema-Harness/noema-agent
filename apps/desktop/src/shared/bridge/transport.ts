/**
 * The bridge between the renderer-facing API and whatever process serves it.
 *
 * A transport only moves one request/response pair and one event payload at a
 * time; channel names, payload shapes and authorization stay in the bridge
 * contract and the host. The desktop host implements this over Electron IPC; a
 * remote or companion host can implement the same interface over its own
 * message channel without touching the bridge API or its callers.
 */
export type BridgeListener<T = unknown> = (payload: T) => void;

export interface BridgeTransport {
  /** One request round-trip. Arguments are forwarded positionally. */
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  /** Subscribe to a host-pushed event; returns the unsubscribe function. */
  on<T = unknown>(channel: string, listener: BridgeListener<T>): () => void;
}
